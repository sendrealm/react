export type SendrealmEnvironment = 'production' | 'development';
export type SendrealmPermissionStatus =
  | 'not_determined'
  | 'authorized'
  | 'denied'
  | 'unsupported'
  | 'unknown'
  | string;
export type SendrealmTagValue = string | number | boolean | null;
export type SendrealmEventPropertyValue =
  | string
  | number
  | boolean
  | null
  | SendrealmEventPropertyValue[]
  | { [key: string]: SendrealmEventPropertyValue };

export interface SendrealmInitializeOptions {
  appId: string;
  baseUrl?: string;
  externalUserId?: string;
  userEmail?: string;
  environment?: SendrealmEnvironment;
  autoRequestPermission?: boolean;
  serviceWorkerPath?: string;
  serviceWorkerScope?: string;
  deviceId?: string;
}

export interface SendrealmInitializeResult {
  token: string | null;
  deviceId: string | null;
  environment: SendrealmEnvironment | string;
  subscribed: boolean;
  permissionGranted: boolean;
}

export interface SendrealmState {
  initialized: boolean;
  registered: boolean;
  permissionGranted: boolean;
  subscribed: boolean;
  deviceId: string | null;
  registrationToken: string | null;
  tokenStatus: 'missing' | 'registered' | 'unsubscribed' | string;
  externalUserId: string | null;
  userEmail: string | null;
  platform: 'web';
  environment: SendrealmEnvironment | string;
  sdkVersion: string;
}

export interface SendrealmOperationResult {
  success: boolean;
  message: string | null;
  at: number | string;
}

export interface SendrealmSdkError {
  code: string;
  message: string;
  at: number | string;
}

export interface SendrealmDiagnostics {
  appId: string | null;
  apiUrl: string | null;
  apiUrlSource: string;
  sdkVersion: string;
  platform: 'web';
  environment: SendrealmEnvironment | string;
  deviceId: string | null;
  registrationTokenPresent: boolean;
  permissionStatus: SendrealmPermissionStatus;
  subscribed: boolean;
  serviceWorkerPath: string | null;
  serviceWorkerScope: string | null;
  browserSupported: boolean;
  userAgent: string | null;
  locale: string | null;
  timezone: string | null;
  lastInitResult: SendrealmOperationResult | null;
  lastRegisterResult: SendrealmOperationResult | null;
  lastSdkError: SendrealmSdkError | null;
  lastNotificationPayload: unknown | null;
  lastOpenPayload: unknown | null;
}

export interface SendrealmSupportDiagnosticsOptions {
  includePayloads?: boolean;
}

export type SendrealmSupportDiagnostics = SendrealmDiagnostics;

export interface SendrealmNotificationPayload {
  notification?: {
    title?: string;
    body?: string;
    image?: string;
    imageUrl?: string;
    image_url?: string;
    icon?: string;
    badge?: string;
    web?: {
      image?: string;
      imageUrl?: string;
      image_url?: string;
      icon?: string;
      badge?: string;
    } | null;
  } | null;
  metadata?: {
    notification_id?: string | null;
    launch_url?: string | null;
    web_launch_url?: string | null;
    image_url?: string | null;
    imageUrl?: string | null;
  } | null;
  data?: Record<string, unknown> | null;
  actions?: Array<{
    id: string;
    title?: string | null;
    text?: string | null;
    icon?: string | null;
    launchUrl?: string | null;
    launch_url?: string | null;
  }> | null;
}

export interface SendrealmNotificationOpenResult {
  notificationId: string | null;
  deliveryId?: string | null;
  clickId?: string | null;
  actionIdentifier?: string | null;
  rawActionIdentifier?: string | null;
  action?: {
    id: string;
    title?: string | null;
    text?: string | null;
    icon?: string | null;
    launchUrl?: string | null;
    launch_url?: string | null;
  } | null;
  launchUrl: string | null;
  rawPayload: string | null;
  payload: SendrealmNotificationPayload | null;
}

export interface SendrealmForegroundNotificationEvent {
  notificationId: string | null;
  launchUrl: string | null;
  rawPayload: string;
  payload: SendrealmNotificationPayload;
  isForeground: boolean;
  preventedDefault: boolean;
}

export interface SendrealmNotificationActionEvent {
  notificationId: string | null;
  actionIdentifier: string | null;
  launchUrl: string | null;
  rawPayload: string | null;
  payload: SendrealmNotificationPayload | null;
}

export interface SendrealmSilentNotificationEvent {
  notificationId: string | null;
  rawPayload: string;
  payload: SendrealmNotificationPayload;
  isForeground: boolean;
}

export interface SendrealmPermissionChangedEvent {
  granted: boolean;
  status: SendrealmPermissionStatus;
}

export interface SendrealmSubscriptionChangedEvent {
  subscribed: boolean;
  token: string | null;
}

export interface SendrealmListenerSubscription {
  remove(): void;
}

export interface SendrealmWebPushConfig {
  public_key: string;
  service_worker_path: string;
  service_worker_scope: string;
}
