import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { detectPublicDir, runSetup } from '../bin/sendrealm-react.mjs';

const tempDirs = [];

function createTempProject() {
  const dir = mkdtempSync(join(tmpdir(), 'sendrealm-react-setup-'));
  tempDirs.push(dir);
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify(
      {
        dependencies: {
          react: '^18.0.0'
        }
      },
      null,
      2
    )
  );

  return dir;
}

function createLogger() {
  const lines = [];

  return {
    lines,
    log: line => {
      lines.push(String(line));
    }
  };
}

afterEach(() => {
  while (tempDirs.length > 0) {
    rmSync(tempDirs.pop(), {
      recursive: true,
      force: true
    });
  }
});

describe('sendrealm-react setup CLI', () => {
  it('copies the bundled worker into the detected public directory', () => {
    const cwd = createTempProject();
    const logger = createLogger();

    mkdirSync(join(cwd, 'public'));

    const result = runSetup(['setup'], {
      cwd,
      log: logger.log
    });
    const targetPath = join(cwd, 'public', 'sendrealm-service-worker.js');

    expect(result.action).toBe('created');
    expect(readFileSync(targetPath, 'utf8')).toContain(
      'SENDREALM_WORKER_VERSION'
    );
    expect(logger.lines.join('\n')).toContain('Service worker URL: /sendrealm-service-worker.js');
  });

  it('updates an existing Sendrealm worker', () => {
    const cwd = createTempProject();
    const logger = createLogger();
    const targetPath = join(cwd, 'public', 'sendrealm-service-worker.js');

    mkdirSync(join(cwd, 'public'));
    writeFileSync(targetPath, '/* Sendrealm Web Push service worker */\nold');

    const result = runSetup(['setup'], {
      cwd,
      log: logger.log
    });

    expect(result.action).toBe('updated');
    expect(readFileSync(targetPath, 'utf8')).toContain(
      'SENDREALM_WORKER_VERSION'
    );
  });

  it('refuses to overwrite an unrelated worker without force', () => {
    const cwd = createTempProject();
    const targetPath = join(cwd, 'public', 'sendrealm-service-worker.js');

    mkdirSync(join(cwd, 'public'));
    writeFileSync(targetPath, 'self.addEventListener("push", () => {});');

    expect(() =>
      runSetup(['setup'], {
        cwd,
        log: () => undefined
      })
    ).toThrow('does not look like a Sendrealm worker');
  });

  it('detects SvelteKit static directories', () => {
    const cwd = createTempProject();

    writeFileSync(
      join(cwd, 'package.json'),
      JSON.stringify({
        devDependencies: {
          '@sveltejs/kit': '^2.0.0'
        }
      })
    );

    expect(detectPublicDir(cwd)).toBe(join(cwd, 'static'));
  });
});
