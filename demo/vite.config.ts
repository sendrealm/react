import fs from 'node:fs';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const sdkRoot = path.resolve(__dirname, '..');
const serviceWorkerPath = path.join(sdkRoot, 'sendrealm-service-worker.js');
const demoManifest = {
  name: 'Sendrealm Web Push Demo',
  short_name: 'Sendrealm Push',
  start_url: '/',
  scope: '/',
  display: 'standalone',
  background_color: '#0c111d',
  theme_color: '#7ddbd3',
  gcm_sender_id: '103953800507'
};

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'sendrealm-service-worker',
      configureServer(server) {
        const serveSendrealmWorker = (_req, res) => {
          res.setHeader('content-type', 'application/javascript; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('service-worker-allowed', '/');
          fs.createReadStream(serviceWorkerPath).pipe(res);
        };

        server.middlewares.use(
          '/sendrealm-service-worker.js',
          serveSendrealmWorker
        );
        server.middlewares.use(
          '/push/sendrealm/sendrealm-service-worker.js',
          serveSendrealmWorker
        );
        server.middlewares.use('/existing-push-worker.js', (_req, res) => {
          res.setHeader('content-type', 'application/javascript; charset=utf-8');
          res.setHeader('cache-control', 'no-store');
          res.setHeader('service-worker-allowed', '/');
          res.end(
            '/* Existing push worker fixture */ self.addEventListener("install", event => event.waitUntil(self.skipWaiting())); self.addEventListener("activate", event => event.waitUntil(self.clients.claim())); self.addEventListener("push", () => {});'
          );
        });
        server.middlewares.use('/manifest.webmanifest', (_req, res) => {
          res.setHeader('content-type', 'application/manifest+json; charset=utf-8');
          res.end(JSON.stringify(demoManifest));
        });
      }
    }
  ],
  server: {
    port: 5174,
    strictPort: false
  }
});
