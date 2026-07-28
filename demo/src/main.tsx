import React from 'react';
import { createRoot } from 'react-dom/client';
import { DemoApp } from './DemoApp';
import './styles.css';

const numericLoopbackHosts = new Set(['127.0.0.1', '::1']);

if (numericLoopbackHosts.has(window.location.hostname)) {
  const localhostUrl = new URL(window.location.href);
  localhostUrl.hostname = 'localhost';
  window.location.replace(localhostUrl.toString());
}

const appId = import.meta.env.VITE_SENDREALM_APP_ID || 'demo_push_app_id';
const baseUrl =
  import.meta.env.VITE_SENDREALM_BASE_URL || 'http://localhost:5506';
const serviceWorkerPath = import.meta.env.VITE_SENDREALM_SERVICE_WORKER_PATH;
const serviceWorkerScope = import.meta.env.VITE_SENDREALM_SERVICE_WORKER_SCOPE;
const installExistingPushWorkerFixture =
  import.meta.env.VITE_EXISTING_PUSH_WORKER_FIXTURE === 'true';

if (!numericLoopbackHosts.has(window.location.hostname)) {
  void (async () => {
    // Opt-in local test fixture for proving that the Sendrealm worker can use
    // a dedicated scope while an existing push worker owns root.
    if (installExistingPushWorkerFixture) {
      const rootRegistration =
        await navigator.serviceWorker.getRegistration('/');

      if (
        rootRegistration?.scope === new URL('/', window.location.href).href &&
        !rootRegistration.active?.scriptURL.endsWith('/existing-push-worker.js')
      ) {
        await rootRegistration.unregister();
      }

      await navigator.serviceWorker.register('/existing-push-worker.js', {
        scope: '/'
      });
    }

    createRoot(document.getElementById('root') as HTMLElement).render(
      <React.StrictMode>
        <DemoApp
          appId={appId}
          baseUrl={baseUrl}
          serviceWorkerPath={serviceWorkerPath}
          serviceWorkerScope={serviceWorkerScope}
        />
      </React.StrictMode>
    );
  })();
}
