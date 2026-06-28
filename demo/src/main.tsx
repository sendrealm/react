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

if (!numericLoopbackHosts.has(window.location.hostname)) {
  createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <DemoApp appId={appId} baseUrl={baseUrl} />
    </React.StrictMode>
  );
}
