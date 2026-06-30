# Sendrealm React SDK

React SDK for Sendrealm web push integrations.

## Setup

Install the package:

```bash
npm install @sendrealm/react
```

Install the same-origin service worker file:

```bash
npx @sendrealm/react setup
```

The setup command detects your public directory and writes
`sendrealm-service-worker.js` there. Re-run it after SDK upgrades to refresh the
worker.

Browsers require service workers to be served from your app origin. Do not
register a GitHub or CDN URL directly as the service worker script.

Full installation, setup, and API documentation is maintained at:

https://docs.sendrealm.com

Package: `@sendrealm/react`
