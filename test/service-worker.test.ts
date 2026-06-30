/// <reference types="vite/client" />

import { describe, expect, it, vi } from 'vitest';
import workerSource from '../sendrealm-service-worker.js?raw';

type WorkerListener = (event: any) => void;

function createWorkerHarness() {
  const listeners = new Map<string, WorkerListener[]>();
  const showNotification = vi.fn(
    async (_title: string, _options?: NotificationOptions) => undefined
  );
  const matchAll = vi.fn(async (): Promise<any[]> => []);
  const openWindow = vi.fn(async (_url?: string | URL) => undefined);
  const skipWaiting = vi.fn(async () => undefined);
  const claim = vi.fn(async () => undefined);
  const fetchMock = vi.fn(
    async (_input: RequestInfo | URL, _init?: RequestInit) => new Response('{}')
  );

  const workerSelf = {
    registration: {
      showNotification
    },
    clients: {
      matchAll,
      openWindow,
      claim
    },
    skipWaiting,
    addEventListener(type: string, listener: WorkerListener) {
      const existing = listeners.get(type) || [];
      existing.push(listener);
      listeners.set(type, existing);
    }
  };

  const executeWorker = new Function('self', 'fetch', workerSource);
  executeWorker(workerSelf, fetchMock);

  async function dispatchEvent(type: string, event: any) {
    for (const listener of listeners.get(type) || []) {
      listener(event);
    }

    if (event.pending) {
      await event.pending;
    }
  }

  async function dispatchPush(payload: unknown, hasData = true) {
    const event = {
      data: hasData
        ? {
            json: () => payload,
            text: () => JSON.stringify(payload)
          }
        : null,
      pending: null as Promise<unknown> | null,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        event.pending = Promise.resolve(promise);
      })
    };

    await dispatchEvent('push', event);
  }

  async function dispatchTextPush(text: string) {
    const event = {
      data: {
        json: () => {
          throw new Error('Invalid JSON');
        },
        text: () => text
      },
      pending: null as Promise<unknown> | null,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        event.pending = Promise.resolve(promise);
      })
    };

    await dispatchEvent('push', event);
  }

  async function dispatchMessage(data: unknown, extra: Record<string, unknown> = {}) {
    const event = {
      data,
      pending: null as Promise<unknown> | null,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        event.pending = Promise.resolve(promise);
      }),
      ...extra
    };

    await dispatchEvent('message', event);
  }

  async function dispatchNotificationClick(options: NotificationOptions, action = '') {
    const notification = {
      data: options.data,
      close: vi.fn()
    };
    const event = {
      action,
      notification,
      pending: null as Promise<unknown> | null,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        event.pending = Promise.resolve(promise);
      })
    };

    await dispatchEvent('notificationclick', event);

    return notification;
  }

  async function dispatchNotificationClose(options: NotificationOptions) {
    const event = {
      notification: {
        data: options.data
      },
      pending: null as Promise<unknown> | null,
      waitUntil: vi.fn((promise: Promise<unknown>) => {
        event.pending = Promise.resolve(promise);
      })
    };

    await dispatchEvent('notificationclose', event);
  }

  return {
    dispatchMessage,
    dispatchPush,
    dispatchNotificationClick,
    dispatchNotificationClose,
    fetchMock,
    claim,
    skipWaiting,
    openWindow,
    showNotification,
    matchAll,
    dispatchTextPush
  };
}

describe('Sendrealm service worker', () => {
  function configureTracking(harness: ReturnType<typeof createWorkerHarness>) {
    return harness.dispatchMessage({
      type: 'SENDREALM_CONFIG',
      appId: 'app_123',
      deviceId: 'device_123',
      baseUrl: 'https://push-api.example.test',
      environment: 'production',
      sdkVersion: '0.1.1'
    });
  }

  function getTrackedEventTypes(harness: ReturnType<typeof createWorkerHarness>) {
    return harness.fetchMock.mock.calls.map(call => {
      const init = call[1];
      const body = JSON.parse(String(init?.body || '{}'));

      return {
        eventType: body.event_type,
        notificationId: body.notification_id,
        properties: body.properties
      };
    });
  }

  function getFirstNotificationOptions(
    harness: ReturnType<typeof createWorkerHarness>
  ) {
    const options = harness.showNotification.mock.calls[0]?.[1];

    if (!options) {
      throw new Error('Expected the service worker to show a notification');
    }

    return options;
  }

  it.each([
    [
      'top-level notification.image',
      {
        notification: {
          title: 'Image notification',
          body: 'Has a hero image',
          image: 'https://cdn.example.test/top-level.png'
        },
        sendrealm_v1: {
          metadata: {
            notification_id: 'notif_top_level'
          }
        }
      },
      'https://cdn.example.test/top-level.png'
    ],
    [
      'sendrealm notification.imageUrl',
      {
        sendrealm_v1: {
          notification: {
            title: 'Image notification',
            body: 'Has a hero image',
            imageUrl: 'https://cdn.example.test/camel.png'
          },
          metadata: {
            notification_id: 'notif_camel'
          }
        }
      },
      'https://cdn.example.test/camel.png'
    ],
    [
      'sendrealm notification.web.image',
      {
        sendrealm_v1: {
          notification: {
            title: 'Image notification',
            body: 'Has a hero image',
            web: {
              image: 'https://cdn.example.test/web.png'
            }
          },
          metadata: {
            notification_id: 'notif_web'
          }
        }
      },
      'https://cdn.example.test/web.png'
    ],
    [
      'metadata.image_url',
      {
        sendrealm_v1: {
          notification: {
            title: 'Image notification',
            body: 'Has a hero image'
          },
          metadata: {
            notification_id: 'notif_metadata',
            image_url: 'https://cdn.example.test/metadata.png'
          }
        }
      },
      'https://cdn.example.test/metadata.png'
    ]
  ])('passes %s to showNotification image', async (_label, payload, imageUrl) => {
    const harness = createWorkerHarness();

    await harness.dispatchPush(payload);

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Image notification',
      expect.objectContaining({
        body: 'Has a hero image',
        image: imageUrl
      })
    );
  });

  it('shows a visible notification for empty DevTools push test payloads', async () => {
    const harness = createWorkerHarness();

    await harness.dispatchPush(null, false);

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Notification',
      expect.objectContaining({
        body: ''
      })
    );
  });

  it('responds to version probes', async () => {
    const harness = createWorkerHarness();
    const port = {
      postMessage: vi.fn()
    };

    await harness.dispatchMessage(
      {
        type: 'SENDREALM_GET_VERSION'
      },
      {
        ports: [port]
      }
    );

    expect(port.postMessage).toHaveBeenCalledWith({
      type: 'SENDREALM_WORKER_VERSION',
      version: '0.1.1'
    });
  });

  it('parses sendrealm_v1 when it arrives as a JSON string', async () => {
    const harness = createWorkerHarness();

    await harness.dispatchPush({
      sendrealm_v1: JSON.stringify({
        notification: {
          title: 'String envelope',
          body: 'Parsed by the worker'
        },
        metadata: {
          notification_id: 'notif_string'
        }
      })
    });

    expect(harness.showNotification).toHaveBeenCalledWith(
      'String envelope',
      expect.objectContaining({
        body: 'Parsed by the worker',
        tag: 'notif_string'
      })
    );
  });

  it('falls back to a minimal notification if rich options are rejected', async () => {
    const harness = createWorkerHarness();

    harness.showNotification
      .mockRejectedValueOnce(new TypeError('Unsupported rich option'))
      .mockResolvedValueOnce(undefined);

    await harness.dispatchPush({
      sendrealm_v1: {
        notification: {
          title: 'Rich notification',
          body: 'Fallback should still show',
          image: 'https://cdn.example.test/rich.png'
        },
        metadata: {
          notification_id: 'notif_rich'
        }
      }
    });

    expect(harness.showNotification).toHaveBeenCalledTimes(2);
    expect(harness.showNotification).toHaveBeenNthCalledWith(
      2,
      'Rich notification',
      expect.objectContaining({
        body: 'Fallback should still show',
        tag: 'notif_rich',
        data: expect.any(Object)
      })
    );
    expect(harness.showNotification.mock.calls[1]?.[1]).not.toHaveProperty(
      'image'
    );
  });

  it('still displays when a matched client cannot receive messages', async () => {
    const harness = createWorkerHarness();

    harness.matchAll.mockResolvedValue([
      {
        focused: true,
        visibilityState: 'visible',
        postMessage: vi.fn(() => {
          throw new Error('client is gone');
        })
      }
    ]);

    await harness.dispatchPush({
      sendrealm_v1: {
        notification: {
          title: 'Client failure',
          body: 'Display still wins'
        },
        metadata: {
          notification_id: 'notif_client_failure'
        }
      }
    });

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Client failure',
      expect.objectContaining({
        body: 'Display still wins'
      })
    );
  });

  it('falls back to a generic notification for non-JSON text payloads', async () => {
    const harness = createWorkerHarness();

    await harness.dispatchTextPush('not json');

    expect(harness.showNotification).toHaveBeenCalledWith(
      'Notification',
      expect.objectContaining({
        body: ''
      })
    );
  });

  it('tracks delivery and opens launch_url on notification click', async () => {
    const harness = createWorkerHarness();
    const payload = {
      sendrealm_v1: {
        notification: {
          title: 'Launch notification',
          body: 'Open the launch URL'
        },
        metadata: {
          notification_id: 'notif_launch',
          launch_url: 'https://example.test/orders/123'
        }
      }
    };

    await configureTracking(harness);
    await harness.dispatchPush(payload);

    const options = getFirstNotificationOptions(harness);
    await harness.dispatchNotificationClick(options);

    expect(harness.openWindow).toHaveBeenCalledWith(
      'https://example.test/orders/123'
    );
    expect(getTrackedEventTypes(harness)).toEqual([
      {
        eventType: 'delivery',
        notificationId: 'notif_launch',
        properties: undefined
      },
      {
        eventType: 'background_notification_received',
        notificationId: 'notif_launch',
        properties: {
          has_clients: false,
          notification_id: 'notif_launch',
          silent: false
        }
      },
      {
        eventType: 'open',
        notificationId: 'notif_launch',
        properties: undefined
      },
      {
        eventType: 'click',
        notificationId: 'notif_launch',
        properties: {}
      }
    ]);
  });

  it('tracks action button clicks with action id and action launch URL', async () => {
    const harness = createWorkerHarness();
    const payload = {
      sendrealm_v1: {
        notification: {
          title: 'Action notification',
          body: 'Open an action URL'
        },
        metadata: {
          notification_id: 'notif_action',
          launch_url: 'https://example.test/fallback'
        },
        actions: [
          {
            id: 'track',
            title: 'Track',
            launch_url: 'https://example.test/orders/123/track'
          }
        ]
      }
    };

    await configureTracking(harness);
    await harness.dispatchPush(payload);

    const options = getFirstNotificationOptions(harness);
    await harness.dispatchNotificationClick(options, 'track');

    expect(harness.openWindow).toHaveBeenCalledWith(
      'https://example.test/orders/123/track'
    );
    expect(getTrackedEventTypes(harness).slice(-3)).toEqual([
      {
        eventType: 'open',
        notificationId: 'notif_action',
        properties: undefined
      },
      {
        eventType: 'click',
        notificationId: 'notif_action',
        properties: {
          action_id: 'track'
        }
      },
      {
        eventType: 'notification_action',
        notificationId: 'notif_action',
        properties: {
          action_id: 'track',
          notification_id: 'notif_action'
        }
      }
    ]);
  });

  it('tracks notification dismiss events', async () => {
    const harness = createWorkerHarness();
    const payload = {
      sendrealm_v1: {
        notification: {
          title: 'Dismiss notification',
          body: 'Close me'
        },
        metadata: {
          notification_id: 'notif_dismiss'
        }
      }
    };

    await configureTracking(harness);
    await harness.dispatchPush(payload);

    const options = getFirstNotificationOptions(harness);
    await harness.dispatchNotificationClose(options);

    const events = getTrackedEventTypes(harness);
    expect(events[events.length - 1]).toEqual({
      eventType: 'dismiss',
      notificationId: 'notif_dismiss',
      properties: undefined
    });
  });

  it('tracks foreground display when a visible client exists', async () => {
    const harness = createWorkerHarness();

    harness.matchAll.mockResolvedValue([
      {
        focused: true,
        visibilityState: 'visible',
        postMessage: vi.fn()
      }
    ]);

    await configureTracking(harness);
    await harness.dispatchPush({
      sendrealm_v1: {
        notification: {
          title: 'Foreground notification',
          body: 'Visible page'
        },
        metadata: {
          notification_id: 'notif_foreground'
        }
      }
    });

    expect(getTrackedEventTypes(harness)).toEqual([
      {
        eventType: 'delivery',
        notificationId: 'notif_foreground',
        properties: undefined
      },
      {
        eventType: 'foreground_display',
        notificationId: 'notif_foreground',
        properties: undefined
      }
    ]);
  });

  it('tracks silent/background payloads and notifies silent listeners', async () => {
    const harness = createWorkerHarness();
    const postMessage = vi.fn();

    harness.matchAll.mockResolvedValue([
      {
        focused: false,
        visibilityState: 'hidden',
        postMessage
      }
    ]);

    await configureTracking(harness);
    await harness.dispatchPush({
      sendrealm_v1: {
        silent: true,
        metadata: {
          notification_id: 'notif_silent'
        },
        data: {
          sync: true
        }
      }
    });

    expect(getTrackedEventTypes(harness)).toEqual([
      {
        eventType: 'delivery',
        notificationId: 'notif_silent',
        properties: undefined
      },
      {
        eventType: 'background_notification_received',
        notificationId: 'notif_silent',
        properties: {
          has_clients: true,
          notification_id: 'notif_silent',
          silent: true
        }
      }
    ]);
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'SENDREALM_SILENT_NOTIFICATION',
        notificationId: 'notif_silent'
      })
    );
  });
});
