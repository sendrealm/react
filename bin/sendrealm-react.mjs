#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { dirname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workerFileName = 'sendrealm-service-worker.js';
const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceWorkerPath = join(packageRoot, workerFileName);
const defaultServiceWorkerPath = `/${workerFileName}`;

function parseArgs(argv) {
  const first = argv[0] || '';
  const command = first && !first.startsWith('-') ? first : argv.length > 0 ? 'setup' : 'help';
  const options = {
    command,
    publicDir: null,
    serviceWorkerPath: defaultServiceWorkerPath,
    force: false,
    dryRun: false,
    check: false,
    help: false
  };

  for (let index = command === first ? 1 : 0; index < argv.length; index += 1) {
    const value = argv[index];

    if (value === '--public-dir') {
      options.publicDir = argv[index + 1] || null;
      index += 1;
      continue;
    }

    if (value === '--path') {
      options.serviceWorkerPath = argv[index + 1] || defaultServiceWorkerPath;
      index += 1;
      continue;
    }

    if (value === '--force') {
      options.force = true;
      continue;
    }

    if (value === '--dry-run') {
      options.dryRun = true;
      continue;
    }

    if (value === '--check') {
      options.check = true;
      continue;
    }

    if (value === '--help' || value === '-h') {
      options.help = true;
      continue;
    }

    throw new Error(`Unknown option: ${value}`);
  }

  return options;
}

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (_) {
    return null;
  }
}

function getPackageManager(cwd) {
  if (existsSync(join(cwd, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(cwd, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(cwd, 'bun.lockb'))) return 'bun';

  return 'npm';
}

function getRunner(cwd) {
  const packageManager = getPackageManager(cwd);

  if (packageManager === 'pnpm') return 'pnpm dlx';
  if (packageManager === 'yarn') return 'yarn dlx';
  if (packageManager === 'bun') return 'bunx';

  return 'npx';
}

function hasDependency(packageJson, name) {
  return Boolean(
    packageJson?.dependencies?.[name] ||
      packageJson?.devDependencies?.[name] ||
      packageJson?.peerDependencies?.[name]
  );
}

export function detectPublicDir(cwd, explicitPublicDir = null) {
  if (explicitPublicDir) {
    return resolve(cwd, explicitPublicDir);
  }

  const config = readJsonFile(join(cwd, 'sendrealm.config.json'));

  if (typeof config?.publicDir === 'string' && config.publicDir.trim()) {
    return resolve(cwd, config.publicDir);
  }

  const packageJson = readJsonFile(join(cwd, 'package.json'));
  const candidates = [];

  if (existsSync(join(cwd, 'public'))) {
    candidates.push('public');
  }

  if (hasDependency(packageJson, '@sveltejs/kit')) {
    candidates.push('static');
  }

  if (existsSync(join(cwd, 'static'))) {
    candidates.push('static');
  }

  if (existsSync(join(cwd, 'assets'))) {
    candidates.push('assets');
  }

  return resolve(cwd, candidates[0] || 'public');
}

function getRelativeWorkerPath(serviceWorkerPath) {
  const relativePath = normalize(serviceWorkerPath.replace(/^\/+/, ''));

  if (
    !relativePath ||
    relativePath === '.' ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath === '..'
  ) {
    throw new Error(
      `Invalid service worker path "${serviceWorkerPath}". Use a root-relative path such as /sendrealm-service-worker.js.`
    );
  }

  return relativePath;
}

function isSendrealmWorker(content) {
  return (
    content.includes('Sendrealm Web Push service worker') ||
    content.includes('sendrealm-web-push') ||
    content.includes('SENDREALM_WORKER_VERSION')
  );
}

function formatPath(cwd, path) {
  const formatted = relative(cwd, path);

  return formatted && !formatted.startsWith('..') ? formatted : path;
}

function printHelp(log = console.log) {
  log(`Sendrealm React SDK CLI

Usage:
  sendrealm-react setup [options]

Options:
  --public-dir <dir>  Directory served as your app public root (default: auto-detect)
  --path <path>       Root-relative worker URL (default: /sendrealm-service-worker.js)
  --check             Verify the worker file without writing
  --dry-run           Print what would happen without writing
  --force             Overwrite a non-Sendrealm file at the target path
  -h, --help          Show help

Examples:
  sendrealm-react setup
  sendrealm-react setup --public-dir public
  sendrealm-react setup --check`);
}

export function runSetup(argv = process.argv.slice(2), io = {}) {
  const cwd = resolve(io.cwd || process.cwd());
  const log = io.log || console.log;
  const options = parseArgs(argv);

  if (options.help || options.command === 'help') {
    printHelp(log);
    return {
      action: 'help'
    };
  }

  if (options.command !== 'setup') {
    throw new Error(`Unknown command: ${options.command}`);
  }

  const publicDir = detectPublicDir(cwd, options.publicDir);
  const relativeWorkerPath = getRelativeWorkerPath(options.serviceWorkerPath);
  const targetPath = resolve(publicDir, relativeWorkerPath);
  const targetParent = dirname(targetPath);
  const source = readFileSync(sourceWorkerPath, 'utf8');
  const exists = existsSync(targetPath);
  const current = exists ? readFileSync(targetPath, 'utf8') : null;
  const same = current === source;

  if (exists && !statSync(targetPath).isFile()) {
    throw new Error(`${formatPath(cwd, targetPath)} exists but is not a file.`);
  }

  if (options.check) {
    const ok = exists && same;
    log(
      ok
        ? `Sendrealm service worker is installed at ${formatPath(cwd, targetPath)}.`
        : `Sendrealm service worker needs setup at ${formatPath(cwd, targetPath)}.`
    );

    return {
      action: ok ? 'checked-current' : 'checked-outdated',
      targetPath,
      serviceWorkerPath: options.serviceWorkerPath
    };
  }

  if (exists && same) {
    log(`Sendrealm service worker is already current at ${formatPath(cwd, targetPath)}.`);

    return {
      action: 'current',
      targetPath,
      serviceWorkerPath: options.serviceWorkerPath
    };
  }

  if (exists && current && !isSendrealmWorker(current) && !options.force) {
    throw new Error(
      `${formatPath(cwd, targetPath)} already exists and does not look like a Sendrealm worker. Use --force to overwrite it or --path to choose a different file.`
    );
  }

  if (!options.dryRun) {
    mkdirSync(targetParent, {
      recursive: true
    });
    writeFileSync(targetPath, source);
  }

  const action = exists ? 'updated' : 'created';
  const runner = getRunner(cwd);

  log(
    `${options.dryRun ? 'Would write' : action === 'updated' ? 'Updated' : 'Created'} ${formatPath(cwd, targetPath)}`
  );
  log(`Service worker URL: ${options.serviceWorkerPath}`);
  log('');
  log('Initialize from browser code:');
  log(`  init({ appId: 'YOUR_SENDREALM_PUSH_APP_ID', autoRequestPermission: false });`);
  log('');
  log('To refresh the worker after SDK upgrades:');
  log(`  ${runner} @sendrealm/react setup`);

  return {
    action: options.dryRun ? 'dry-run' : action,
    targetPath,
    serviceWorkerPath: options.serviceWorkerPath
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    runSetup();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
