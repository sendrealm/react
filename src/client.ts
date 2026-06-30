import type {
  SendrealmDiagnostics,
  SendrealmEnvironment,
  SendrealmEventPropertyValue,
  SendrealmForegroundNotificationEvent,
  SendrealmInitializeOptions,
  SendrealmInitializeResult,
  SendrealmListenerSubscription,
  SendrealmNotificationActionEvent,
  SendrealmNotificationOpenResult,
  SendrealmPermissionChangedEvent,
  SendrealmPermissionStatus,
  SendrealmServiceWorkerCheck,
  SendrealmSilentNotificationEvent,
  SendrealmState,
  SendrealmSubscriptionChangedEvent,
  SendrealmSupportDiagnostics,
  SendrealmSupportDiagnosticsOptions,
  SendrealmTagValue,
  SendrealmWebPushConfig
} from './types';

export const VERSION = '0.1.1';

const DEFAULT_BASE_URL = 'https://sdk-api.sendrealm.com';
const DEFAULT_SERVICE_WORKER_PATH = '/sendrealm-service-worker.js';
const DEFAULT_SERVICE_WORKER_SCOPE = '/';
const DEVICE_STORAGE_PREFIX = 'sendrealm:web:device:';
const INITIAL_OPEN_STORAGE_KEY = 'sendrealm:web:last-open';
const SERVICE_WORKER_READY_TIMEOUT_MS = 5000;
const SERVICE_WORKER_VERSION_PATTERN =
  /SENDREALM_WORKER_VERSION\s*=\s*['"]([^'"]+)['"]/;

export const SendrealmEvents = {
  notificationClicked: 'Sendrealm:notification_clicked',
  foregroundNotification: 'Sendrealm:foreground_notification',
  notificationAction: 'Sendrealm:notification_action',
  silentNotification: 'Sendrealm:silent_notification',
  permissionChanged: 'Sendrealm:permission_changed',
  subscriptionChanged: 'Sendrealm:subscription_changed'
} as const;

type ListenerMap = {
  [SendrealmEvents.notificationClicked]: SendrealmNotificationOpenResult;
  [SendrealmEvents.foregroundNotification]: SendrealmForegroundNotificationEvent;
  [SendrealmEvents.notificationAction]: SendrealmNotificationActionEvent;
  [SendrealmEvents.silentNotification]: SendrealmSilentNotificationEvent;
  [SendrealmEvents.permissionChanged]: SendrealmPermissionChangedEvent;
  [SendrealmEvents.subscriptionChanged]: SendrealmSubscriptionChangedEvent;
};

type Listener<T> = (event: T) => void;

interface InitResponse {
  app_id: string;
  device_id: string;
  platform: string;
  initialized_at: string;
  web_push?: SendrealmWebPushConfig | null;
}

function hasBrowserApis() {
  return (
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof document !== 'undefined'
  );
}

function browserSupported() {
  return (
    hasBrowserApis() &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function normalizeBaseUrl(value?: string | null) {
  return (value || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function createServiceWorkerCheck(
  value: Partial<SendrealmServiceWorkerCheck>
): SendrealmServiceWorkerCheck {
  return {
    ok: false,
    status: value.status || 'unchecked',
    path: value.path ?? null,
    expectedVersion: VERSION,
    detectedVersion: value.detectedVersion ?? null,
    message: value.message ?? null,
    ...value
  };
}

function getServiceWorkerVersion(source: string) {
  return source.match(SERVICE_WORKER_VERSION_PATTERN)?.[1] || null;
}

function looksLikeHtml(response: Response, source: string) {
  const contentType = response.headers.get('content-type') || '';
  const trimmed = source.trimStart().toLowerCase();

  return (
    contentType.toLowerCase().includes('text/html') ||
    trimmed.startsWith('<!doctype html') ||
    trimmed.startsWith('<html')
  );
}

function getPermissionStatus(): SendrealmPermissionStatus {
  if (!hasBrowserApis() || !('Notification' in window)) {
    return 'unsupported';
  }

  if (Notification.permission === 'granted') {
    return 'authorized';
  }

  if (Notification.permission === 'denied') {
    return 'denied';
  }

  return 'not_determined';
}

function permissionGranted() {
  return getPermissionStatus() === 'authorized';
}

function generateDeviceId() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `web_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function getStoredDeviceId(appId: string) {
  try {
    return window.localStorage.getItem(`${DEVICE_STORAGE_PREFIX}${appId}`);
  } catch {
    return null;
  }
}

function storeDeviceId(appId: string, deviceId: string) {
  try {
    window.localStorage.setItem(`${DEVICE_STORAGE_PREFIX}${appId}`, deviceId);
  } catch {
    // Storage can be unavailable in private browsing; runtime state still works.
  }
}

function urlBase64ToArrayBuffer(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = `${base64String}${padding}`
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);

  for (let index = 0; index < rawData.length; index += 1) {
    outputArray[index] = rawData.charCodeAt(index);
  }

  if (outputArray.byteLength !== 65 || outputArray[0] !== 4) {
    throw new Error(
      'Sendrealm Web Push public key is invalid. Expected a 65-byte uncompressed P-256 VAPID public key.'
    );
  }

  return outputArray.buffer.slice(
    outputArray.byteOffset,
    outputArray.byteOffset + outputArray.byteLength
  );
}

function delay(milliseconds: number) {
  return new Promise(resolve => {
    window.setTimeout(resolve, milliseconds);
  });
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T | null> {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => null)
  ]);
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function isRetryablePushSubscribeError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }

  const message = error.message.toLowerCase();

  return (
    error.name === 'AbortError' ||
    error.name === 'InvalidStateError' ||
    message.includes('push service error') ||
    message.includes('no active service worker') ||
    message.includes('registration failed')
  );
}

function enhancePushSubscribeError(error: unknown) {
  const message = getErrorMessage(error);

  if (!isRetryablePushSubscribeError(error)) {
    return error instanceof Error ? error : new Error(message);
  }

  return new Error(
    `${message}. The browser push service could not create a subscription after the service worker became ready and was re-registered. Open the demo in a full Chrome, Edge, or Safari browser with push messaging enabled; embedded Chromium browsers can expose PushManager without a working push service.`
  );
}

function readLocale() {
  return hasBrowserApis() ? navigator.language || null : null;
}

function readTimezone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

function subscriptionToJSON(subscription: PushSubscription) {
  const json = subscription.toJSON();

  return {
    endpoint: subscription.endpoint,
    expirationTime: json.expirationTime ?? null,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || ''
    }
  };
}

function redactDiagnostics(
  diagnostics: SendrealmDiagnostics,
  options?: SendrealmSupportDiagnosticsOptions
): SendrealmSupportDiagnostics {
  if (options?.includePayloads) {
    return diagnostics;
  }

  return {
    ...diagnostics,
    lastNotificationPayload: null,
    lastOpenPayload: null
  };
}

export class SendrealmWebClient {
  private options: Required<
    Pick<
      SendrealmInitializeOptions,
      'appId' | 'baseUrl' | 'environment' | 'serviceWorkerPath' | 'serviceWorkerScope'
    >
  > &
    Omit<
      SendrealmInitializeOptions,
      'appId' | 'baseUrl' | 'environment' | 'serviceWorkerPath' | 'serviceWorkerScope'
    > | null = null;
  private state: SendrealmState = {
    initialized: false,
    registered: false,
    permissionGranted: false,
    subscribed: false,
    deviceId: null,
    registrationToken: null,
    tokenStatus: 'missing',
    externalUserId: null,
    userEmail: null,
    platform: 'web',
    environment: 'production',
    sdkVersion: VERSION
  };
  private webPush: SendrealmWebPushConfig | null = null;
  private initializePromise: Promise<SendrealmInitializeResult> | null = null;
  private listeners = new Map<string, Set<Listener<unknown>>>();
  private lastInitResult: SendrealmDiagnostics['lastInitResult'] = null;
  private lastRegisterResult: SendrealmDiagnostics['lastRegisterResult'] = null;
  private lastSdkError: SendrealmDiagnostics['lastSdkError'] = null;
  private lastServiceWorkerCheck: SendrealmServiceWorkerCheck | null = null;
  private lastNotificationPayload: unknown | null = null;
  private lastOpenPayload: unknown | null = null;
  private serviceWorkerMessageBound = false;
  private pageLifecycleBound = false;
  private permissionStatus: SendrealmPermissionStatus | null = null;

  initialize(options: SendrealmInitializeOptions): Promise<SendrealmInitializeResult> {
    if (this.initializePromise) {
      return this.initializePromise;
    }

    this.initializePromise = this.performInitialize(options).catch(error => {
      this.initializePromise = null;
      this.recordError('InitializeFailed', error);
      throw error;
    });

    return this.initializePromise;
  }

  init(options: SendrealmInitializeOptions) {
    return this.initialize(options);
  }

  async login(userId: string, email?: string | null) {
    this.requireInitialized();
    this.state.externalUserId = userId;
    this.state.userEmail = email || null;

    const subscription = await this.getExistingSubscription();

    if (subscription) {
      await this.registerSubscription(subscription);
    }
  }

  async logout() {
    this.requireInitialized();
    this.state.externalUserId = null;
    this.state.userEmail = null;

    const subscription = await this.getExistingSubscription();

    if (subscription) {
      await this.registerSubscription(subscription);
    }
  }

  async requestPermission() {
    this.requireBrowserSupport();

    const previousStatus = this.permissionStatus || getPermissionStatus();
    const result = await Notification.requestPermission();
    const granted = result === 'granted';

    await this.applyPermissionStatus(getPermissionStatus(), {
      previousStatus,
      forceEmit: true,
      trackServerEvent: true
    });

    if (granted) {
      await this.optIn();
    }

    return granted;
  }

  async hasNotificationPermission() {
    return permissionGranted();
  }

  async getPermissionStatus() {
    return getPermissionStatus();
  }

  async openNotificationSettings() {
    return false;
  }

  async setBadgeCount() {
    return false;
  }

  async clearBadge() {
    return false;
  }

  async setForegroundPresentation() {
    return true;
  }

  async getDeviceId() {
    return this.state.deviceId;
  }

  async isSubscribed() {
    return this.state.subscribed;
  }

  async getState() {
    return { ...this.state };
  }

  async getDiagnostics(): Promise<SendrealmDiagnostics> {
    const serviceWorkerRegistration = await this.getServiceWorkerRegistration(
      false
    ).catch(() => null);

    return {
      appId: this.options?.appId || null,
      apiUrl: this.options?.baseUrl || null,
      apiUrlSource: this.options?.baseUrl === DEFAULT_BASE_URL ? 'default' : 'option',
      sdkVersion: VERSION,
      platform: 'web',
      environment: this.state.environment,
      deviceId: this.state.deviceId,
      registrationTokenPresent: !!this.state.registrationToken,
      permissionStatus: getPermissionStatus(),
      subscribed: this.state.subscribed,
      serviceWorkerPath: this.options?.serviceWorkerPath || null,
      serviceWorkerScope: this.options?.serviceWorkerScope || null,
      activeServiceWorkerScriptURL:
        serviceWorkerRegistration?.active?.scriptURL || null,
      serviceWorkerCheck: this.lastServiceWorkerCheck,
      browserSupported: browserSupported(),
      userAgent: hasBrowserApis() ? navigator.userAgent : null,
      locale: readLocale(),
      timezone: readTimezone(),
      lastInitResult: this.lastInitResult,
      lastRegisterResult: this.lastRegisterResult,
      lastSdkError: this.lastSdkError,
      lastNotificationPayload: this.lastNotificationPayload,
      lastOpenPayload: this.lastOpenPayload
    };
  }

  async getSupportDiagnostics(options?: SendrealmSupportDiagnosticsOptions) {
    return redactDiagnostics(await this.getDiagnostics(), options);
  }

  async refreshRegistrationToken(forceRefresh = false) {
    try {
      this.requireInitialized();

      if (forceRefresh) {
        const existing = await this.getExistingSubscription();
        await existing?.unsubscribe();
      }

      const subscription = await this.subscribeBrowser();
      await this.registerSubscription(subscription);

      return subscription.endpoint;
    } catch (error) {
      this.recordError('RefreshRegistrationFailed', error);
      throw error;
    }
  }

  async setAPNSToken() {
    throw new Error('setAPNSToken is only available in the React Native SDK.');
  }

  async createNotificationChannel() {
    return false;
  }

  async deleteNotificationChannel() {
    return false;
  }

  async getNotificationChannels() {
    return [];
  }

  async syncNotificationChannels() {
    return true;
  }

  async registerLiveActivityToken() {
    return false;
  }

  async registerLiveActivityPushToStartToken() {
    return false;
  }

  async deleteLiveActivityToken() {
    return false;
  }

  async syncLiveActivityTokens() {
    return true;
  }

  async trackLiveActivityEvent(
    activityId: string,
    eventType: string,
    properties: Record<string, SendrealmEventPropertyValue> = {}
  ) {
    return this.trackEvent(`live_activity_${eventType}`, {
      ...properties,
      activity_id: activityId
    });
  }

  async optIn() {
    try {
      this.requireInitialized();
      this.requireBrowserSupport();

      if (!permissionGranted()) {
        const granted = await this.requestPermission();

        return granted && this.state.subscribed;
      }

      const wasSubscribed = this.state.subscribed;
      const subscription = await this.subscribeBrowser();
      await this.registerSubscription(subscription);

      if (!wasSubscribed) {
        await this.updateSubscriptionState(true, subscription);
      }

      return true;
    } catch (error) {
      this.recordError('OptInFailed', error);
      throw error;
    }
  }

  async optOut() {
    this.requireInitialized();

    const wasSubscribed = this.state.subscribed;
    const subscription = await this.getExistingSubscription();
    await subscription?.unsubscribe();

    await this.updateSubscriptionState(false);

    this.state.subscribed = false;
    this.state.registered = false;
    this.state.registrationToken = null;
    this.state.tokenStatus = 'unsubscribed';

    if (wasSubscribed) {
      this.emit(SendrealmEvents.subscriptionChanged, {
        subscribed: false,
        token: null
      });
    }

    return true;
  }

  async addTag(key: string, value: SendrealmTagValue) {
    return this.addTags({ [key]: value });
  }

  async addTags(tags: Record<string, SendrealmTagValue>) {
    this.requireInitialized();

    await this.requestApi('/v1/tags', {
      app_id: this.options?.appId,
      device_id: this.state.deviceId,
      platform: 'web',
      tags
    });

    return true;
  }

  async removeTag(key: string) {
    return this.addTag(key, null);
  }

  async trackEvent(
    eventType: string,
    properties: Record<string, SendrealmEventPropertyValue> | null = null
  ) {
    this.requireInitialized();

    await this.requestApi('/v1/track', {
      app_id: this.options?.appId,
      device_id: this.state.deviceId,
      platform: 'web',
      event_type: eventType,
      notification_id:
        typeof properties?.notification_id === 'string'
          ? properties.notification_id
          : undefined,
      properties: properties || undefined,
      environment: this.state.environment,
      sdk_version: VERSION,
      permission_status: getPermissionStatus(),
      subscribed: this.state.subscribed,
      device_locale: readLocale(),
      timezone: readTimezone()
    });

    return true;
  }

  async getInitialNotification() {
    if (this.lastOpenPayload) {
      return this.parseOpenEvent(this.lastOpenPayload);
    }

    if (!hasBrowserApis()) {
      return null;
    }

    try {
      const stored = window.localStorage.getItem(INITIAL_OPEN_STORAGE_KEY);

      if (!stored) {
        return null;
      }

      window.localStorage.removeItem(INITIAL_OPEN_STORAGE_KEY);
      const parsed = JSON.parse(stored);
      return this.parseOpenEvent(parsed);
    } catch {
      return null;
    }
  }

  addNotificationClickListener(
    listener: Listener<SendrealmNotificationOpenResult>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.notificationClicked, listener);
  }

  addForegroundNotificationListener(
    listener: Listener<SendrealmForegroundNotificationEvent>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.foregroundNotification, listener);
  }

  addNotificationActionListener(
    listener: Listener<SendrealmNotificationActionEvent>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.notificationAction, listener);
  }

  addSilentNotificationListener(
    listener: Listener<SendrealmSilentNotificationEvent>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.silentNotification, listener);
  }

  addPermissionObserver(
    listener: Listener<SendrealmPermissionChangedEvent>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.permissionChanged, listener);
  }

  addSubscriptionObserver(
    listener: Listener<SendrealmSubscriptionChangedEvent>
  ): SendrealmListenerSubscription {
    return this.addListener(SendrealmEvents.subscriptionChanged, listener);
  }

  private async performInitialize(
    input: SendrealmInitializeOptions
  ): Promise<SendrealmInitializeResult> {
    if (!input.appId?.trim()) {
      throw new Error('Sendrealm appId is required.');
    }

    this.requireBrowserSupport();

    const options = {
      ...input,
      appId: input.appId.trim(),
      baseUrl: normalizeBaseUrl(input.baseUrl),
      environment: input.environment || 'production',
      serviceWorkerPath: input.serviceWorkerPath || DEFAULT_SERVICE_WORKER_PATH,
      serviceWorkerScope: input.serviceWorkerScope || DEFAULT_SERVICE_WORKER_SCOPE
    };
    const deviceId =
      input.deviceId || getStoredDeviceId(options.appId) || generateDeviceId();

    storeDeviceId(options.appId, deviceId);
    this.options = options;
    this.state = {
      ...this.state,
      initialized: true,
      deviceId,
      externalUserId: input.externalUserId || null,
      userEmail: input.userEmail || null,
      environment: options.environment,
      permissionGranted: permissionGranted()
    };
    this.permissionStatus = getPermissionStatus();
    this.bindServiceWorkerMessages();
    this.bindPageLifecycleObservers();

    const existingSubscription = await this.getExistingSubscription();
    const init = await this.requestApi<InitResponse>('/v1/init', {
      app_id: options.appId,
      device_id: deviceId,
      platform: 'web',
      environment: options.environment,
      sdk_version: VERSION,
      os_version: navigator.userAgent,
      device_model: 'browser',
      api_url_source: input.baseUrl ? 'option' : 'default',
      permission_status: getPermissionStatus(),
      subscribed: !!existingSubscription,
      device_locale: readLocale(),
      timezone: readTimezone()
    });

    this.webPush = init.web_push || null;

    if (this.webPush) {
      await this.ensureServiceWorkerFile();
      await this.configureServiceWorker();
    }

    if (existingSubscription) {
      await this.registerSubscription(existingSubscription);
    }

    if (options.autoRequestPermission && !permissionGranted()) {
      await this.requestPermission();
    }

    this.lastInitResult = {
      success: true,
      message: null,
      at: Date.now()
    };

    return {
      token: this.state.registrationToken,
      deviceId: this.state.deviceId,
      environment: this.state.environment,
      subscribed: this.state.subscribed,
      permissionGranted: this.state.permissionGranted
    };
  }

  private async checkServiceWorkerFile(): Promise<SendrealmServiceWorkerCheck> {
    if (!this.options || !hasBrowserApis()) {
      return createServiceWorkerCheck({
        ok: false,
        status: 'unchecked',
        path: this.options?.serviceWorkerPath || null,
        message: 'Service worker preflight is only available in a browser.'
      });
    }

    const serviceWorkerPath = this.options.serviceWorkerPath;

    try {
      const url = new URL(serviceWorkerPath, window.location.href);

      if (url.origin !== window.location.origin) {
        return createServiceWorkerCheck({
          ok: false,
          status: 'cross_origin',
          path: serviceWorkerPath,
          message:
            'Sendrealm Web Push service worker must be served from the same origin as your app. Copy it into your public directory with `npx @sendrealm/react setup`.'
        });
      }

      const response = await fetch(url.href, {
        cache: 'no-store',
        credentials: 'same-origin'
      });
      const source = await response.text().catch(() => '');

      if (!response.ok) {
        return createServiceWorkerCheck({
          ok: false,
          status: response.status === 404 ? 'missing' : 'unreachable',
          path: serviceWorkerPath,
          message: `Sendrealm service worker was not found at ${serviceWorkerPath}. Run \`npx @sendrealm/react setup\` and deploy the generated public file.`
        });
      }

      if (looksLikeHtml(response, source)) {
        return createServiceWorkerCheck({
          ok: false,
          status: 'html',
          path: serviceWorkerPath,
          message: `Sendrealm service worker path ${serviceWorkerPath} returned HTML. Run \`npx @sendrealm/react setup\` and make sure your app serves the worker file from its public root.`
        });
      }

      const detectedVersion = getServiceWorkerVersion(source);

      if (!detectedVersion && serviceWorkerPath === DEFAULT_SERVICE_WORKER_PATH) {
        return createServiceWorkerCheck({
          ok: false,
          status: 'invalid',
          path: serviceWorkerPath,
          message: `Sendrealm service worker path ${serviceWorkerPath} does not look like the bundled worker. Run \`npx @sendrealm/react setup\` to install the current worker.`
        });
      }

      if (!detectedVersion) {
        return createServiceWorkerCheck({
          ok: true,
          status: 'custom',
          path: serviceWorkerPath,
          message:
            'Custom service worker detected. Ensure it imports or implements the Sendrealm push handlers.'
        });
      }

      if (detectedVersion !== VERSION) {
        return createServiceWorkerCheck({
          ok: true,
          status: 'version_mismatch',
          path: serviceWorkerPath,
          detectedVersion,
          message: `Sendrealm service worker version ${detectedVersion} does not match SDK version ${VERSION}. Run \`npx @sendrealm/react setup\` after upgrading the SDK.`
        });
      }

      return createServiceWorkerCheck({
        ok: true,
        status: 'ok',
        path: serviceWorkerPath,
        detectedVersion,
        message: null
      });
    } catch (error) {
      return createServiceWorkerCheck({
        ok: false,
        status: 'unreachable',
        path: serviceWorkerPath,
        message: `Could not verify Sendrealm service worker at ${serviceWorkerPath}: ${getErrorMessage(error)}`
      });
    }
  }

  private async ensureServiceWorkerFile() {
    const check = await this.checkServiceWorkerFile();
    this.lastServiceWorkerCheck = check;

    if (!check.ok) {
      throw new Error(check.message || 'Sendrealm service worker is not ready.');
    }
  }

  private async configureServiceWorker() {
    const registration = await this.getReadyServiceWorkerRegistration();
    const configMessage = {
      type: 'SENDREALM_CONFIG',
      appId: this.options?.appId,
      deviceId: this.state.deviceId,
      baseUrl: this.options?.baseUrl,
      environment: this.state.environment,
      sdkVersion: VERSION
    };
    const workers = [
      registration.active,
      registration.waiting,
      registration.installing
    ].filter((worker): worker is ServiceWorker => Boolean(worker));

    for (const worker of workers) {
      try {
        worker.postMessage(configMessage);
      } catch {
        // The next initialization or worker activation will receive config again.
      }
    }
  }

  private async updateSubscriptionState(
    subscribed: boolean,
    subscription?: PushSubscription | null
  ) {
    await this.requestApi('/v1/subscription', {
      app_id: this.options?.appId,
      device_id: this.state.deviceId,
      platform: 'web',
      subscribed,
      ...(subscription
        ? { web_push_subscription: subscriptionToJSON(subscription) }
        : {}),
      environment: this.state.environment,
      sdk_version: VERSION,
      permission_status: getPermissionStatus(),
      device_locale: readLocale(),
      timezone: readTimezone()
    });
  }

  private async subscribeBrowser() {
    if (!this.webPush?.public_key) {
      throw new Error('Sendrealm Web Push public key is unavailable.');
    }

    const registration = await this.getReadyServiceWorkerRegistration();
    const existing = await registration.pushManager.getSubscription();

    if (existing) {
      return existing;
    }

    const createSubscribeOptions = (): PushSubscriptionOptionsInit => ({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToArrayBuffer(this.webPush?.public_key || '')
    });

    try {
      return await registration.pushManager.subscribe(createSubscribeOptions());
    } catch (error) {
      if (!isRetryablePushSubscribeError(error)) {
        throw error;
      }

      await registration.update().catch(() => undefined);

      const refreshedRegistration =
        await this.getReadyServiceWorkerRegistration(registration);
      const refreshedExisting =
        await refreshedRegistration.pushManager.getSubscription();

      if (refreshedExisting) {
        return refreshedExisting;
      }

      try {
        return await refreshedRegistration.pushManager.subscribe(
          createSubscribeOptions()
        );
      } catch (nextError) {
        if (!isRetryablePushSubscribeError(nextError)) {
          throw nextError;
        }

        const cleanRegistration = await this.resetServiceWorkerRegistration(
          refreshedRegistration
        );
        const cleanExisting =
          await cleanRegistration.pushManager.getSubscription();

        if (cleanExisting) {
          return cleanExisting;
        }

        try {
          return await cleanRegistration.pushManager.subscribe(
            createSubscribeOptions()
          );
        } catch (finalError) {
          throw enhancePushSubscribeError(finalError);
        }
      }
    }
  }

  private async registerSubscription(subscription: PushSubscription) {
    this.requireInitialized();

    const subscriptionJson = subscriptionToJSON(subscription);
    const previousSubscribed = this.state.subscribed;
    const previousToken = this.state.registrationToken;

    await this.requestApi('/v1/register', {
      app_id: this.options?.appId,
      device_id: this.state.deviceId,
      platform: 'web',
      web_push_subscription: subscriptionJson,
      environment: this.state.environment,
      user_external_id: this.state.externalUserId || undefined,
      user_email: this.state.userEmail || undefined,
      sdk_version: VERSION,
      os_version: navigator.userAgent,
      device_model: 'browser',
      api_url_source: this.options?.baseUrl === DEFAULT_BASE_URL ? 'default' : 'option',
      permission_status: getPermissionStatus(),
      subscribed: true,
      device_locale: readLocale(),
      timezone: readTimezone()
    });

    this.state.subscribed = true;
    this.state.registered = true;
    this.state.registrationToken = subscription.endpoint;
    this.state.tokenStatus = 'registered';
    this.state.permissionGranted = permissionGranted();
    this.lastRegisterResult = {
      success: true,
      message: null,
      at: Date.now()
    };
    if (!previousSubscribed || previousToken !== subscription.endpoint) {
      this.emit(SendrealmEvents.subscriptionChanged, {
        subscribed: true,
        token: subscription.endpoint
      });
    }
  }

  private async getExistingSubscription() {
    if (!browserSupported()) {
      return null;
    }

    const registration = await this.getServiceWorkerRegistration(false);

    return registration?.pushManager.getSubscription() || null;
  }

  private async getServiceWorkerRegistration(create?: true): Promise<ServiceWorkerRegistration>;
  private async getServiceWorkerRegistration(create: false): Promise<ServiceWorkerRegistration | null>;
  private async getServiceWorkerRegistration(create = true) {
    if (!this.options) {
      if (create) {
        throw new Error('Sendrealm.initialize(...) must be called first.');
      }

      return null;
    }

    if (!create) {
      return navigator.serviceWorker.getRegistration(
        this.options.serviceWorkerScope
      );
    }

    return navigator.serviceWorker.register(this.options.serviceWorkerPath, {
      scope: this.options.serviceWorkerScope
    });
  }

  private async getReadyServiceWorkerRegistration(
    fallbackRegistration?: ServiceWorkerRegistration
  ) {
    const registration =
      fallbackRegistration || (await this.getServiceWorkerRegistration());
    const readyRegistration = await withTimeout(
      navigator.serviceWorker.ready,
      SERVICE_WORKER_READY_TIMEOUT_MS
    );

    return readyRegistration || registration;
  }

  private async resetServiceWorkerRegistration(
    registration: ServiceWorkerRegistration
  ) {
    await registration.unregister().catch(() => undefined);
    await delay(300);

    if (!this.options) {
      throw new Error('Sendrealm.initialize(...) must be called first.');
    }

    const nextRegistration = await navigator.serviceWorker.register(
      this.options.serviceWorkerPath,
      {
        scope: this.options.serviceWorkerScope
      }
    );

    return this.getReadyServiceWorkerRegistration(nextRegistration);
  }

  private bindServiceWorkerMessages() {
    if (this.serviceWorkerMessageBound || !browserSupported()) {
      return;
    }

    this.serviceWorkerMessageBound = true;
    navigator.serviceWorker.addEventListener('message', event => {
      const data = event.data;

      if (!data || typeof data !== 'object') {
        return;
      }

      if (data.type === 'SENDREALM_PUSH_RECEIVED') {
        this.lastNotificationPayload = data.payload || null;

        if (data.isForeground) {
          this.emit(SendrealmEvents.foregroundNotification, {
            notificationId: data.notificationId || null,
            launchUrl: data.launchUrl || null,
            rawPayload: JSON.stringify(data.payload || {}),
            payload: data.payload || {},
            isForeground: true,
            preventedDefault: false
          });
        }
      }

      if (data.type === 'SENDREALM_SILENT_NOTIFICATION') {
        this.lastNotificationPayload = data.payload || null;
        this.emit(SendrealmEvents.silentNotification, {
          notificationId: data.notificationId || null,
          rawPayload: JSON.stringify(data.payload || {}),
          payload: data.payload || {},
          isForeground: !!data.isForeground
        });
      }

      if (data.type === 'SENDREALM_NOTIFICATION_CLICKED') {
        this.lastOpenPayload = data;
        const openEvent = this.parseOpenEvent(data);

        if (openEvent) {
          this.emit(SendrealmEvents.notificationClicked, openEvent);

          if (openEvent.actionIdentifier) {
            this.emit(SendrealmEvents.notificationAction, {
              notificationId: openEvent.notificationId,
              actionIdentifier: openEvent.actionIdentifier,
              launchUrl: openEvent.launchUrl,
              rawPayload: openEvent.rawPayload,
              payload: openEvent.payload
            });
          }
        }
      }

      if (data.type === 'SENDREALM_PUSH_SUBSCRIPTION_CHANGED') {
        void this.refreshRegistrationToken(false).catch(error => {
          this.recordError('PushSubscriptionChangedRefreshFailed', error);
        });
      }
    });
  }

  private bindPageLifecycleObservers() {
    if (this.pageLifecycleBound || !hasBrowserApis()) {
      return;
    }

    this.pageLifecycleBound = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        void this.applyPermissionStatus(getPermissionStatus(), {
          trackServerEvent: true
        });
      }
    });

    if ('permissions' in navigator && navigator.permissions?.query) {
      navigator.permissions
        .query({ name: 'notifications' as PermissionName })
        .then(permission => {
          permission.addEventListener?.('change', () => {
            void this.applyPermissionStatus(getPermissionStatus(), {
              trackServerEvent: true
            });
          });
        })
        .catch(() => undefined);
    }
  }

  private async applyPermissionStatus(
    nextStatus: SendrealmPermissionStatus,
    options: {
      previousStatus?: SendrealmPermissionStatus | null;
      forceEmit?: boolean;
      trackServerEvent?: boolean;
    } = {}
  ) {
    const previousStatus =
      options.previousStatus || this.permissionStatus || nextStatus;
    const changed = previousStatus !== nextStatus;
    const granted = nextStatus === 'authorized';

    this.permissionStatus = nextStatus;
    this.state.permissionGranted = granted;

    if (options.forceEmit || changed) {
      this.emit(SendrealmEvents.permissionChanged, {
        granted,
        status: nextStatus
      });
    }

    if (
      options.trackServerEvent &&
      changed &&
      (nextStatus === 'authorized' || nextStatus === 'denied')
    ) {
      await this.trackEventSafely(
        nextStatus === 'authorized' ? 'permission_granted' : 'permission_denied',
        {
          previous_status: previousStatus,
          permission_status: nextStatus
        }
      );
    }
  }

  private async trackEventSafely(
    eventType: string,
    properties: Record<string, SendrealmEventPropertyValue> | null = null
  ) {
    if (!this.options?.appId || !this.state.deviceId || !this.state.initialized) {
      return false;
    }

    try {
      await this.trackEvent(eventType, properties);
      return true;
    } catch {
      return false;
    }
  }

  private parseOpenEvent(data: unknown): SendrealmNotificationOpenResult | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const value = data as Record<string, any>;
    const payload = value.payload?.sendrealm_v1 || value.payload || null;
    const metadata = payload?.metadata || {};
    const actionIdentifier = value.actionIdentifier || null;

    return {
      notificationId: value.notificationId || metadata.notification_id || null,
      actionIdentifier,
      rawActionIdentifier: actionIdentifier,
      action:
        payload?.actions?.find?.((action: any) => action.id === actionIdentifier) ||
        null,
      launchUrl:
        value.launchUrl ||
        metadata.web_launch_url ||
        metadata.launch_url ||
        null,
      rawPayload: JSON.stringify(value.payload || null),
      payload
    };
  }

  private requestApi<T = unknown>(path: string, body: Record<string, unknown>) {
    this.requireInitializedForRequest(path);

    return fetch(`${this.options?.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sendrealm-sdk': `sendrealm-react/${VERSION}`
      },
      body: JSON.stringify(body)
    }).then(async response => {
      const text = await response.text();
      const parsed = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const message =
          parsed?.error?.message || parsed?.message || 'Sendrealm API request failed';
        throw new Error(message);
      }

      return (parsed.data ?? parsed) as T;
    });
  }

  private addListener<K extends keyof ListenerMap>(
    eventName: K,
    listener: Listener<ListenerMap[K]>
  ): SendrealmListenerSubscription {
    const listeners = this.listeners.get(eventName) || new Set<Listener<unknown>>();
    listeners.add(listener as Listener<unknown>);
    this.listeners.set(eventName, listeners);

    return {
      remove: () => {
        listeners.delete(listener as Listener<unknown>);
      }
    };
  }

  private emit<K extends keyof ListenerMap>(eventName: K, event: ListenerMap[K]) {
    this.listeners.get(eventName)?.forEach(listener => {
      listener(event);
    });
  }

  private requireInitialized() {
    if (!this.options || !this.state.initialized) {
      throw new Error('Sendrealm.initialize(...) must be called first.');
    }
  }

  private requireInitializedForRequest(path: string) {
    if (!this.options && path !== '/v1/init') {
      this.requireInitialized();
    }
  }

  private requireBrowserSupport() {
    if (!browserSupported()) {
      throw new Error('Sendrealm Web Push requires window, Notification, serviceWorker, and PushManager browser APIs.');
    }
  }

  private recordError(code: string, error: unknown) {
    this.lastSdkError = {
      code,
      message: error instanceof Error ? error.message : String(error),
      at: Date.now()
    };
  }
}

const Sendrealm = new SendrealmWebClient();

export { Sendrealm, redactDiagnostics };
export default Sendrealm;
