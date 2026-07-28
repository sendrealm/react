import React, { useEffect } from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { init, useSendrealm } from '../src';

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

function installServiceWorkerMock() {
  const registration = {
    active: {
      postMessage: vi.fn()
    },
    waiting: null,
    installing: null,
    update: vi.fn(async () => registration),
    unregister: vi.fn(async () => true),
    pushManager: {
      getSubscription: vi.fn(async () => null),
      subscribe: vi.fn()
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

function Demo() {
  const { state } = useSendrealm();

  useEffect(() => {
    void init({
      appId: 'app_123',
      autoRequestPermission: false
    });
  }, []);

  return (
    <output data-testid="state">
      {JSON.stringify({
        deviceId: state.deviceId,
        initialized: state.initialized
      })}
    </output>
  );
}

describe('@sendrealm/react hooks', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    (Notification as any).permission = 'default';
    installServiceWorkerMock();
    vi.mocked(fetch).mockImplementation((_url, initRequest) => {
      if (String(_url).endsWith('/sendrealm-service-worker.js')) {
        return Promise.resolve(
          new Response("const SENDREALM_WORKER_VERSION = '0.1.3';", {
            status: 200,
            headers: {
              'content-type': 'application/javascript'
            }
          })
        );
      }

      const body = JSON.parse(String(initRequest?.body || '{}'));

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

  it('initializes from a client effect without requiring a provider', async () => {
    render(
      <React.StrictMode>
        <Demo />
      </React.StrictMode>
    );

    await waitFor(() => {
      expect(JSON.parse(screen.getByTestId('state').textContent || '{}')).toMatchObject({
        deviceId: 'device-test-id',
        initialized: true
      });
    });

    const initCalls = vi
      .mocked(fetch)
      .mock.calls.filter(([url]) => String(url).endsWith('/v1/init'));

    expect(initCalls).toHaveLength(1);
  });
});
