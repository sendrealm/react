import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SendrealmWebClient, Sendrealm } from '../src';

const publicKey =
  'BEl6D8NwCLoQ1Jz3wJJOvVDMsORxmrIDkJSIRfEVpZWKSwxY0fo3f1T22aYQZc0sUQfzYJoGypL2au6kAv5w7iE';

function jsonResponse(data: unknown) {
  return Promise.resolve(
    new Response(JSON.stringify({ data }), {
      status: 200,
      headers: {
        'content-type': 'application/json'
      }
    })
  );
}

function createSubscription(endpoint = 'https://push.example.test/sub-1') {
  return {
    endpoint,
    toJSON: () => ({
      endpoint,
      expirationTime: null,
      keys: {
        p256dh: 'p256dh-key',
        auth: 'auth-secret'
      }
    }),
    unsubscribe: vi.fn(async () => true)
  } as unknown as PushSubscription;
}

function installServiceWorkerMock(subscription: PushSubscription | null = null) {
  const postMessage = vi.fn();
  const registration = {
    active: {
      postMessage
    },
    waiting: null,
    installing: null,
    update: vi.fn(async () => registration),
    unregister: vi.fn(async () => true),
    pushManager: {
      getSubscription: vi.fn(async () => subscription),
      subscribe: vi.fn(async () => createSubscription())
    }
  };

  Object.defineProperty(navigator, 'serviceWorker', {
    value: {
      getRegistration: vi.fn(async () => registration),
      register: vi.fn(async () => registration),
      addEventListener: vi.fn(),
      ready: Promise.resolve(registration)
    },
    configurable: true
  });

  return registration;
}

describe('@sendrealm/react client', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (Notification as any).permission = 'default';
    installServiceWorkerMock();
    vi.mocked(fetch).mockImplementation((_url, init) => {
      const body = JSON.parse(String(init?.body || '{}'));

      if (String(_url).endsWith('/v1/init')) {
        return jsonResponse({
          app_id: body.app_id,
          device_id: body.device_id,
          platform: 'web',
          initialized_at: new Date().toISOString(),
          web_push: {
            public_key: publicKey,
            service_worker_path: '/sendrealm-service-worker.js',
            service_worker_scope: '/'
          }
        });
      }

      return jsonResponse({
        ok: true
      });
    });
  });

  it('is safe to import without starting browser work', () => {
    expect(Sendrealm).toBeDefined();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('deduplicates concurrent initialization', async () => {
    const client = new SendrealmWebClient();

    await Promise.all([
      client.initialize({ appId: 'app_123' }),
      client.initialize({ appId: 'app_123' })
    ]);

    const initCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/v1/init'));

    expect(initCalls).toHaveLength(1);
  });

  it('subscribes and registers a browser PushSubscription', async () => {
    const registration = installServiceWorkerMock();
    const client = new SendrealmWebClient();

    await client.initialize({ appId: 'app_123' });
    await client.requestPermission();

    const registerCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/v1/register'));
    const body = JSON.parse(String(registerCall?.[1]?.body || '{}'));
    const subscriptionCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/v1/subscription'));
    const subscriptionBody = JSON.parse(
      String(subscriptionCall?.[1]?.body || '{}')
    );

    expect(registration.pushManager.subscribe).toHaveBeenCalledWith(
      expect.objectContaining({
        userVisibleOnly: true,
        applicationServerKey: expect.any(ArrayBuffer)
      })
    );
    expect(body).toMatchObject({
      app_id: 'app_123',
      platform: 'web',
      web_push_subscription: {
        endpoint: 'https://push.example.test/sub-1',
        keys: {
          p256dh: 'p256dh-key',
          auth: 'auth-secret'
        }
      }
    });
    expect(subscriptionBody).toMatchObject({
      app_id: 'app_123',
      platform: 'web',
      subscribed: true,
      web_push_subscription: {
        endpoint: 'https://push.example.test/sub-1'
      }
    });
  });

  it('tracks permission changes when requesting permission', async () => {
    const client = new SendrealmWebClient();

    await client.initialize({ appId: 'app_123' });
    await client.requestPermission();

    const trackCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).endsWith('/v1/track'));
    const body = JSON.parse(String(trackCall?.[1]?.body || '{}'));

    expect(body).toMatchObject({
      app_id: 'app_123',
      platform: 'web',
      event_type: 'permission_granted',
      properties: {
        previous_status: 'not_determined',
        permission_status: 'authorized'
      }
    });
  });

  it('retries browser subscription after a retryable push service failure', async () => {
    const registration = installServiceWorkerMock();
    const client = new SendrealmWebClient();

    vi.mocked(registration.pushManager.subscribe)
      .mockRejectedValueOnce(
        Object.assign(new Error('Registration failed - push service error'), {
          name: 'AbortError'
        })
      )
      .mockResolvedValueOnce(createSubscription());

    await client.initialize({ appId: 'app_123' });
    await client.requestPermission();

    expect(registration.update).toHaveBeenCalled();
    expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(2);
  });

  it('records diagnostics when browser subscription cannot be created', async () => {
    const registration = installServiceWorkerMock();
    const client = new SendrealmWebClient();

    vi.mocked(registration.pushManager.subscribe).mockRejectedValue(
      Object.assign(new Error('Registration failed - push service error'), {
        name: 'AbortError'
      })
    );

    await client.initialize({ appId: 'app_123' });

    await expect(client.refreshRegistrationToken()).rejects.toThrow(
      'browser push service could not create a subscription'
    );
    await expect(client.getDiagnostics()).resolves.toMatchObject({
      lastSdkError: {
        code: 'RefreshRegistrationFailed'
      }
    });
  });

  it('re-registers the service worker before the final push service retry', async () => {
    const registration = installServiceWorkerMock();
    const client = new SendrealmWebClient();
    const pushServiceError = Object.assign(
      new Error('Registration failed - push service error'),
      {
        name: 'AbortError'
      }
    );

    vi.mocked(registration.pushManager.subscribe)
      .mockRejectedValueOnce(pushServiceError)
      .mockRejectedValueOnce(pushServiceError)
      .mockResolvedValueOnce(createSubscription());

    await client.initialize({ appId: 'app_123' });
    await client.requestPermission();

    expect(registration.unregister).toHaveBeenCalled();
    expect(navigator.serviceWorker.register).toHaveBeenCalledWith(
      '/sendrealm-service-worker.js',
      {
        scope: '/'
      }
    );
    expect(registration.pushManager.subscribe).toHaveBeenCalledTimes(3);
  });

  it('notifies subscription observers on opt out', async () => {
    const subscription = createSubscription();
    installServiceWorkerMock(subscription);
    const client = new SendrealmWebClient();
    const listener = vi.fn();

    client.addSubscriptionObserver(listener);
    await client.initialize({ appId: 'app_123' });
    await client.optOut();

    expect(subscription.unsubscribe).toHaveBeenCalled();
    expect(listener).toHaveBeenLastCalledWith({
      subscribed: false,
      token: null
    });
  });
});
