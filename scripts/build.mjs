import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const bin = process.platform === 'win32' ? 'npx.cmd' : 'npx';

const result = spawnSync(bin, ['tsup', '--config', 'tsup.config.ts'], {
  cwd: root,
  stdio: 'inherit'
});

if (result.status !== 0) {
  process.exit(result.status || 1);
}

copyFileSync(
  resolve(root, 'sendrealm-service-worker.js'),
  resolve(root, 'dist', 'sendrealm-service-worker.js')
);
