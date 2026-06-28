/* Sendrealm Web Push service worker. Copy this file to your app's public root. */

const CONFIG_DB_NAME = 'sendrealm-web-push';
const CONFIG_DB_VERSION = 1;
const CONFIG_STORE_NAME = 'config';
const CONFIG_KEY = 'tracking';

let sendrealmConfig = null;

function parsePushPayload(event) {
  if (!event.data) {
    return {};
  }

  try {
    return event.data.json();
  } catch (_) {
    try {
      return JSON.parse(event.data.text());
    } catch (__) {
      return {};
    }
  }
}

function getSendrealmPayload(payload) {
  return payload && payload.sendrealm_v1 ? payload.sendrealm_v1 : payload;
}

function getMetadata(payload) {
  return getSendrealmPayload(payload)?.metadata || {};
}

function getNotificationId(payload) {
  const metadata = getMetadata(payload);

  return (
    metadata.notification_id ||
    metadata.notificationId ||
    payload?.notification_id ||
    payload?.notificationId ||
    null
  );
}

function firstString(...values) {
  return values.find(value => typeof value === 'string' && value.length > 0) || undefined;
}

function getNotificationImage(notification, metadata) {
  return firstString(
    notification.image,
    notification.imageUrl,
    notification.image_url,
    notification.web?.image,
    notification.web?.imageUrl,
    notification.web?.image_url,
    metadata.image_url,
    metadata.imageUrl
  );
}

function getIndexedDB() {
  return self.indexedDB || (typeof indexedDB !== 'undefined' ? indexedDB : null);
}

function openConfigDb() {
  const idb = getIndexedDB();

  if (!idb) {
    return Promise.resolve(null);
  }

  return new Promise(resolve => {
    const request = idb.open(CONFIG_DB_NAME, CONFIG_DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;

      if (!db.objectStoreNames.contains(CONFIG_STORE_NAME)) {
        db.createObjectStore(CONFIG_STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function closeDb(db) {
  if (db && typeof db.close === 'function') {
    db.close();
  }
}

async function readStoredConfig() {
  const db = await openConfigDb();

  if (!db) {
    return null;
  }

  return new Promise(resolve => {
    const transaction = db.transaction(CONFIG_STORE_NAME, 'readonly');
    const request = transaction.objectStore(CONFIG_STORE_NAME).get(CONFIG_KEY);

    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => resolve(null);
    transaction.oncomplete = () => closeDb(db);
    transaction.onerror = () => closeDb(db);
    transaction.onabort = () => closeDb(db);
  });
}

async function persistConfig(config) {
  sendrealmConfig = config;

  const db = await openConfigDb();

  if (!db) {
    return;
  }

  await new Promise(resolve => {
    const transaction = db.transaction(CONFIG_STORE_NAME, 'readwrite');

    transaction.objectStore(CONFIG_STORE_NAME).put(config, CONFIG_KEY);
    transaction.oncomplete = () => {
      closeDb(db);
      resolve();
    };
    transaction.onerror = () => {
      closeDb(db);
      resolve();
    };
    transaction.onabort = () => {
      closeDb(db);
      resolve();
    };
  });
}

async function getTrackingConfig() {
  if (sendrealmConfig?.appId && sendrealmConfig?.deviceId && sendrealmConfig?.baseUrl) {
    return sendrealmConfig;
  }

  const storedConfig = await readStoredConfig();

  if (storedConfig?.appId && storedConfig?.deviceId && storedConfig?.baseUrl) {
    sendrealmConfig = storedConfig;
  }

  return sendrealmConfig;
}

function getNotificationOptions(payload) {
  const sendrealm = getSendrealmPayload(payload);
  const notification = payload.notification || sendrealm?.notification || {};
  const metadata = sendrealm?.metadata || {};
  const actions = Array.isArray(sendrealm?.actions) ? sendrealm.actions : [];

  return {
    title: notification.title || 'Notification',
    options: {
      body: notification.body || '',
      image: getNotificationImage(notification, metadata),
      icon: notification.icon || notification.web?.icon || undefined,
      badge: notification.badge || notification.web?.badge || undefined,
      tag: notification.tag || metadata.notification_id || undefined,
      data: {
        payload,
        launchUrl:
          metadata.web_launch_url ||
          metadata.launch_url ||
          notification.data?.launch_url ||
          ''
      },
      actions: actions.slice(0, 2).map(action => ({
        action: action.id,
        title: action.title || action.text || action.id,
        icon: action.icon || undefined
      }))
    }
  };
}

function isSilentPayload(payload) {
  const sendrealm = getSendrealmPayload(payload);
  const notification = payload.notification || sendrealm?.notification || null;
  const metadata = sendrealm?.metadata || {};

  return (
    sendrealm?.silent === true ||
    sendrealm?.content_available === true ||
    payload?.silent === true ||
    payload?.content_available === true ||
    metadata.silent === true ||
    notification === null
  );
}

async function getWindowClients() {
  try {
    return await self.clients.matchAll({
      includeUncontrolled: true,
      type: 'window'
    });
  } catch (_) {
    return [];
  }
}

function getClientVisibility(clientsList) {
  const hasVisibleClient = clientsList.some(client => {
    return client.focused || client.visibilityState === 'visible';
  });

  return {
    hasClients: clientsList.length > 0,
    isForeground: hasVisibleClient
  };
}

async function trackEvent(eventType, payload, extra) {
  const config = await getTrackingConfig();

  if (!config?.appId || !config?.deviceId || !config?.baseUrl) {
    return;
  }

  const metadata = getMetadata(payload);
  const notificationId = metadata.notification_id;

  if (
    ['delivery', 'open', 'click', 'dismiss', 'foreground_display'].includes(eventType) &&
    !notificationId
  ) {
    return;
  }

  const properties = {
    ...(extra || {}),
    ...(notificationId &&
    !['delivery', 'open', 'click', 'dismiss', 'foreground_display'].includes(eventType)
      ? { notification_id: notificationId }
      : {})
  };

  try {
    await fetch(`${config.baseUrl}/v1/track`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-sendrealm-sdk': `sendrealm-react/${config.sdkVersion || '0.1.0'}`
      },
      body: JSON.stringify({
        app_id: config.appId,
        device_id: config.deviceId,
        platform: 'web',
        event_type: eventType,
        notification_id: notificationId,
        properties: Object.keys(properties).length > 0 ? properties : undefined,
        environment: config.environment || 'production',
        sdk_version: config.sdkVersion || '0.1.0',
        subscribed: true
      })
    });
  } catch (_) {
    // Tracking must never block display or click handling.
  }
}

async function notifyClients(message, clientsList) {
  clientsList = clientsList || (await getWindowClients());
  for (const client of clientsList) {
    client.postMessage(message);
  }
}

self.addEventListener('message', event => {
  if (event.data?.type === 'SENDREALM_CONFIG') {
    const config = {
      appId: event.data.appId,
      deviceId: event.data.deviceId,
      baseUrl: event.data.baseUrl,
      environment: event.data.environment,
      sdkVersion: event.data.sdkVersion
    };
    const persistPromise = persistConfig(config);

    if (typeof event.waitUntil === 'function') {
      event.waitUntil(persistPromise);
    }
  }
});

self.addEventListener('push', event => {
  const payload = parsePushPayload(event);
  const { title, options } = getNotificationOptions(payload);
  const metadata = getMetadata(payload);

  event.waitUntil(
    (async () => {
      const clientsList = await getWindowClients();
      const clientVisibility = getClientVisibility(clientsList);
      const silent = isSilentPayload(payload);
      const notificationId = getNotificationId(payload);
      const receivedMessage = {
        type: 'SENDREALM_PUSH_RECEIVED',
        payload: getSendrealmPayload(payload),
        notificationId,
        launchUrl:
          metadata.web_launch_url ||
          metadata.launch_url ||
          options.data?.launchUrl ||
          null,
        isForeground: clientVisibility.isForeground,
        isSilent: silent
      };
      const tracking = [
        trackEvent('delivery', payload),
        clientVisibility.isForeground
          ? trackEvent('foreground_display', payload)
          : trackEvent('background_notification_received', payload, {
              silent,
              has_clients: clientVisibility.hasClients
            })
      ];

      await Promise.all([
        self.registration.showNotification(title, options),
        ...tracking,
        notifyClients(receivedMessage, clientsList),
        silent
          ? notifyClients(
              {
                type: 'SENDREALM_SILENT_NOTIFICATION',
                payload: getSendrealmPayload(payload),
                notificationId,
                isForeground: clientVisibility.isForeground
              },
              clientsList
            )
          : Promise.resolve()
      ]);
    })()
  );
});

self.addEventListener('notificationclick', event => {
  const payload = event.notification.data?.payload || {};
  const sendrealm = getSendrealmPayload(payload);
  const metadata = getMetadata(payload);
  const action = event.action || null;
  const actionPayload = Array.isArray(sendrealm?.actions)
    ? sendrealm.actions.find(item => item.id === action)
    : null;
  const launchUrl =
    actionPayload?.launch_url ||
    actionPayload?.launchUrl ||
    metadata.web_launch_url ||
    metadata.launch_url ||
    event.notification.data?.launchUrl ||
    '/';

  event.notification.close();

  event.waitUntil(
    Promise.all([
      trackEvent('open', payload),
      trackEvent('click', payload, {
        action_id: action || undefined
      }),
      action
        ? trackEvent('notification_action', payload, {
            notification_id: metadata.notification_id || metadata.notificationId || undefined,
            action_id: action
          })
        : Promise.resolve(),
      notifyClients({
        type: 'SENDREALM_NOTIFICATION_CLICKED',
        payload: sendrealm,
        notificationId: metadata.notification_id || null,
        actionIdentifier: action,
        launchUrl
      }),
      self.clients.openWindow(launchUrl)
    ])
  );
});

self.addEventListener('notificationclose', event => {
  const payload = event.notification.data?.payload || {};

  event.waitUntil(trackEvent('dismiss', payload));
});

self.addEventListener('pushsubscriptionchange', event => {
  event.waitUntil(
    Promise.all([
      trackEvent('push_subscription_changed', {}, {
        old_endpoint: event.oldSubscription?.endpoint || null,
        new_endpoint: event.newSubscription?.endpoint || null
      }),
      notifyClients({
        type: 'SENDREALM_PUSH_SUBSCRIPTION_CHANGED',
        oldEndpoint: event.oldSubscription?.endpoint || null,
        newSubscription: event.newSubscription?.toJSON?.() || null
      })
    ])
  );
});
