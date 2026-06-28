import { vi } from 'vitest';

class MockNotification {
  static permission: NotificationPermission = 'default';

  static async requestPermission() {
    MockNotification.permission = 'granted';
    return MockNotification.permission;
  }
}

Object.defineProperty(window, 'Notification', {
  value: MockNotification,
  writable: true
});

Object.defineProperty(window, 'PushManager', {
  value: class PushManager {},
  writable: true
});

Object.defineProperty(globalThis, 'Notification', {
  value: MockNotification,
  writable: true
});

Object.defineProperty(globalThis, 'PushManager', {
  value: window.PushManager,
  writable: true
});

Object.defineProperty(globalThis.crypto, 'randomUUID', {
  value: () => 'device-test-id',
  configurable: true
});

Object.defineProperty(window, 'fetch', {
  value: vi.fn(),
  writable: true
});

Object.defineProperty(globalThis, 'fetch', {
  value: window.fetch,
  writable: true
});
