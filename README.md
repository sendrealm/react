# Sendrealm React Web Push SDK

React SDK for Sendrealm Web Push notifications. It registers native browser `PushSubscription` objects with Sendrealm, tracks notification lifecycle events, and exposes hooks for permission, subscription, identity, tags, events, and diagnostics.

The SDK is safe to import in server-rendered code, but initialization must run in the browser. Do not use a Sendrealm API key in browser code.

## Install

```bash
npm install @sendrealm/react
```

Copy the service worker to your public root:

```bash
cp node_modules/@sendrealm/react/sendrealm-service-worker.js public/sendrealm-service-worker.js
```

The service worker must be served from the same origin as your app. The default path is `/sendrealm-service-worker.js` with scope `/`.

## React / Vite

Use the provider-free `init()` function from client-side React code.

```tsx
import { useEffect } from "react";
import { init, useSendrealmSubscription } from "@sendrealm/react";

const sendrealmAppId = "YOUR_SENDREALM_PUSH_APP_ID";

function PushButton() {
  const { subscribed, optIn, optOut } = useSendrealmSubscription();

  return (
    <button onClick={() => (subscribed ? optOut() : optIn())}>
      {subscribed ? "Disable notifications" : "Enable notifications"}
    </button>
  );
}

export function App() {
  useEffect(() => {
    void init({
      appId: sendrealmAppId,
      autoRequestPermission: false,
    });
  }, []);

  return <PushButton />;
}
```

`init()` is idempotent, so React StrictMode duplicate effects do not create duplicate initialization requests.

## Next.js

Create a Client Component and render it once in your app shell.

```tsx
"use client";

import { useEffect } from "react";
import { init } from "@sendrealm/react";

export function SendrealmInit() {
  useEffect(() => {
    void init({
      appId: process.env.NEXT_PUBLIC_SENDREALM_PUSH_APP_ID!,
      autoRequestPermission: false,
    });
  }, []);

  return null;
}
```

Put `sendrealm-service-worker.js` in `public/` so it is served at `/sendrealm-service-worker.js`.

## Initialization Options

```ts
init({
  appId: "YOUR_SENDREALM_PUSH_APP_ID",
  baseUrl: "https://sdk-api.sendrealm.com",
  environment: "production",
  autoRequestPermission: false,
  serviceWorkerPath: "/sendrealm-service-worker.js",
  serviceWorkerScope: "/",
  externalUserId: "user_123",
  userEmail: "user@example.com",
});
```

| Option | Default | Description |
| --- | --- | --- |
| `appId` | Required | Sendrealm Push App ID. |
| `baseUrl` | `https://sdk-api.sendrealm.com` | SDK API base URL. |
| `environment` | `production` | Device environment for targeting. |
| `autoRequestPermission` | `false` | Requests notification permission during initialization. Keep false unless initialization is triggered by a user gesture. |
| `serviceWorkerPath` | `/sendrealm-service-worker.js` | Same-origin service worker URL. |
| `serviceWorkerScope` | `/` | Service worker scope. |
| `deviceId` | Generated | Optional stable Sendrealm web device ID. |
| `externalUserId` | `null` | Optional identity to link during initialization. |
| `userEmail` | `null` | Optional email to link during initialization. |

## Hooks

```tsx
import {
  useSendrealm,
  useSendrealmPermission,
  useSendrealmSubscription,
} from "@sendrealm/react";

function PushSettings() {
  const { client, state, initializing, error } = useSendrealm();
  const { permissionStatus, requestPermission } = useSendrealmPermission();
  const { subscribed, optIn, optOut, refreshRegistrationToken } =
    useSendrealmSubscription();

  return (
    <section>
      <p>Permission: {permissionStatus}</p>
      <p>Subscribed: {subscribed ? "yes" : "no"}</p>
      <button onClick={() => void requestPermission()}>Ask permission</button>
      <button onClick={() => void optIn()}>Enable notifications</button>
      <button onClick={() => void optOut()}>Disable notifications</button>
      <button onClick={() => void refreshRegistrationToken(true)}>
        Refresh subscription
      </button>
    </section>
  );
}
```

`SendrealmProvider` is still exported for advanced apps that need to inject a custom `SendrealmWebClient`, but it is not required. Hooks subscribe to the default singleton client after `init()`.

## Identity, Tags, And Events

```ts
import { getSendrealmClient } from "@sendrealm/react";

const sendrealm = getSendrealmClient();

await sendrealm.login("user_123", "user@example.com");
await sendrealm.addTags({
  plan: "pro",
  onboarding_complete: true,
});
await sendrealm.trackEvent("checkout.started", {
  cart_id: "cart_123",
});
```

Call `logout()` when the signed-in user changes or signs out.

## Notification Events

```tsx
import { useEffect } from "react";
import { useSendrealm } from "@sendrealm/react";

export function NotificationEvents() {
  const { client } = useSendrealm();

  useEffect(() => {
    const opened = client.addNotificationClickListener(event => {
      console.log("opened", event.launchUrl, event.notificationId);
    });
    const action = client.addNotificationActionListener(event => {
      console.log("action", event.actionIdentifier);
    });
    const foreground = client.addForegroundNotificationListener(event => {
      console.log("foreground", event.payload);
    });
    const silent = client.addSilentNotificationListener(event => {
      console.log("silent", event.payload);
    });

    return () => {
      opened.remove();
      action.remove();
      foreground.remove();
      silent.remove();
    };
  }, [client]);

  return null;
}
```

Read the notification that opened the page:

```ts
const initialOpen = await getSendrealmClient().getInitialNotification();
```

## Automatic Tracking

The SDK and service worker track Sendrealm notification lifecycle events when the SDK has initialized and the payload contains Sendrealm metadata:

- `delivery`
- `foreground_display`
- `background_notification_received`
- `open`
- `click`
- `notification_action`
- `dismiss`
- `push_subscription_changed`
- `permission_granted`
- `permission_denied`

Browsers control which service worker events fire, so some events such as dismiss can vary by browser and operating system.

## Launch URLs, Images, And Actions

When a notification is opened, the service worker resolves the launch URL from an action-level `launch_url`, metadata `web_launch_url`, metadata `launch_url`, notification `data.launch_url`, then `/`.

Rich web notification images are forwarded to `showNotification({ image })` when the browser supports them. From the public API, send `notification.image_url`:

```ts
await client.push.notifications.send({
  app_id: "push_app_short_id",
  external_ids: ["user_123"],
  platforms: ["web"],
  notification: {
    title: "Order update",
    body: "Your order is ready.",
    image_url: "https://cdn.example.com/order.png",
    launch_url: "https://app.example.com/orders/123",
  },
  buttons: [
    {
      id: "view_order",
      text: "View order",
      launch_url: "https://app.example.com/orders/123",
    },
  ],
});
```

Browser UI support for images and action buttons varies. Browsers without image support still show title, body, icon, and badge.

## Main API

- `init` / `initialize`
- `Sendrealm`, `getSendrealmClient`
- `login`, `logout`
- `requestPermission`, `hasNotificationPermission`, `getPermissionStatus`
- `getDeviceId`, `isSubscribed`, `getState`, `getDiagnostics`, `getSupportDiagnostics`
- `refreshRegistrationToken`, `optIn`, `optOut`
- `addTag`, `addTags`, `removeTag`
- `trackEvent`
- `getInitialNotification`
- `addNotificationClickListener`, `addNotificationActionListener`, `addForegroundNotificationListener`, `addSilentNotificationListener`
- `addPermissionObserver`, `addSubscriptionObserver`

Mobile-only APIs such as Android notification channels, APNs token injection, and Live Activities are no-ops or unsupported on web.

## Browser Notes

Web Push requires HTTPS, service workers, Notification permission, and a user-visible notification for every push. iOS Web Push requires an installed Home Screen web app with a valid manifest and a user-initiated permission request.

For local development, open the demo at `http://localhost:5174` instead of a numeric loopback host. Some Chromium push-service builds reject subscriptions on `127.0.0.1` even when the page is otherwise treated as a secure context.

If Chrome, Brave, or Edge reports `Registration failed - push service error`, clear the origin's site data and service worker registrations, confirm push messaging is enabled, and test in a full browser rather than an embedded Chromium webview.

## Demo

```bash
cd sdks/react
pnpm install
VITE_SENDREALM_APP_ID=YOUR_PUSH_APP_ID pnpm demo
```
