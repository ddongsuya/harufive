import assert from 'node:assert/strict';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import {
  buildPreviewWorker, CONNECTED_PREVIEW_CONFIG, measurePreviewBundle, offlinePreloadSource, PREVIEW_CONFIG,
  PREVIEW_GZIP_LIMIT, PREVIEW_ORIGIN, previewChildEnvironment, previewDryRunCommand,
  runPreviewWorker, validatePreviewConfig,
} from '../scripts/preview-worker.mjs';
import { STANDALONE_GAME_ASSETS } from '../server/standalone-assets.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

test('preview preparation rejects remote arguments without echoing them or building', async () => {
  for (const args of [[], ['deploy'], ['dry-run', '--remote'], ['build', 'private-token-marker']]) {
    const messages = [];
    assert.equal(await runPreviewWorker(args, message => messages.push(message)), 2);
    assert.equal(messages.length, 1);
    assert.doesNotMatch(messages[0], /private-token-marker/);
  }
});

test('preview config admits no external bindings, build commands, source maps or account ID', () => {
  assert.equal(validatePreviewConfig(structuredClone(PREVIEW_CONFIG)).name, 'harufive-preview');
  for (const additions of [
    { account_id: 'unexpected-account' }, { assets: { directory: './public' } },
    { d1_databases: [{}] }, { build: { command: 'unexpected' } }, { upload_source_maps: true },
    { vars: { ...PREVIEW_CONFIG.vars, HARU_PREVIEW_PASSWORD: 'private-token-marker' } },
    { main: 'server/worker.mjs' }, { find_additional_modules: true },
    { vars: { ...PREVIEW_CONFIG.vars, HARU_AUTH_ORIGIN: 'https://example.com' } },
  ]) assert.throws(() => validatePreviewConfig({ ...structuredClone(PREVIEW_CONFIG), ...additions }));
});

test('connected preparation accepts only its explicit local DB placeholder and isolated dry-run target', () => {
  assert.equal(validatePreviewConfig(structuredClone(CONNECTED_PREVIEW_CONFIG), { connected: true }).name, 'harufive-preview');
  assert.throws(() => validatePreviewConfig(CONNECTED_PREVIEW_CONFIG));
  assert.throws(() => validatePreviewConfig(PREVIEW_CONFIG, { connected: true }));
  for (const extra of [
    { account_id: 'unexpected' }, { assets: { directory: './public' } },
    { vars: { ...CONNECTED_PREVIEW_CONFIG.vars, HARU_GOOGLE_CLIENT_SECRET: 'private-marker' } },
    { d1_databases: [{ ...CONNECTED_PREVIEW_CONFIG.d1_databases[0], remote: true }] },
    { d1_databases: [{ ...CONNECTED_PREVIEW_CONFIG.d1_databases[0], database_id: 'real-database' }] },
    { main: 'server/connected-preview-worker.mjs' }, { upload_source_maps: true },
  ]) assert.throws(() => validatePreviewConfig({ ...structuredClone(CONNECTED_PREVIEW_CONFIG), ...extra }, { connected: true }));
  const args = previewDryRunCommand(path.join(os.tmpdir(), 'haru-connected-check'), { connected: true });
  assert.ok(args.includes('--dry-run') && args.includes('--env-file'));
  assert.match(args[args.indexOf('--config') + 1], /wrangler\.connected-preview\.jsonc$/);
});

test('dry-run uses isolated homes and never inherits provider, proxy or Cloudflare credentials', () => {
  const accessed = [];
  const parent = new Proxy({ PATH: 'system-path', TEMP: 'system-temp' }, {
    get(target, key) { accessed.push(key); return target[key]; },
    ownKeys() { throw new Error('environment enumeration is forbidden'); },
  });
  const isolated = path.join(os.tmpdir(), 'haru-private-preview-isolated');
  const env = previewChildEnvironment(parent, isolated);
  assert.deepEqual([...new Set(accessed)].sort(),
    ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP'].sort());
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME']) assert.equal(env[key], isolated);
  assert.equal(env.WRANGLER_SEND_METRICS, 'false');
  assert.equal(env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV, 'false');
  assert.equal(env.CLOUDFLARE_INCLUDE_PROCESS_ENV, 'false');
  for (const key of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'HARU_PREVIEW_PASSWORD', 'HARU_GOOGLE_CLIENT_SECRET', 'NODE_OPTIONS', 'HTTPS_PROXY']) assert.equal(env[key], undefined);
  const args = previewDryRunCommand(isolated);
  assert.equal(args[0], '--require');
  assert.ok(args.includes('deploy') && args.includes('--dry-run'));
  assert.ok(args.includes('--env-file'));
  assert.ok(!args.includes('--remote'));
});

test('offline preload rejects network entry points before attempting a connection', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'haru-preview-offline-test-'));
  const preload = path.join(directory, 'offline.cjs');
  await writeFile(preload, offlinePreloadSource());
  const script = `
    const assert = require('node:assert/strict');
    for (const attempt of [
      () => fetch('https://example.invalid'),
      () => require('node:http').get('http://example.invalid'),
      () => require('node:https').request('https://example.invalid'),
      () => require('node:net').connect(443, 'example.invalid'),
      () => new (require('node:net').Socket)().connect(443, 'example.invalid'),
      () => require('node:tls').connect(443, 'example.invalid'),
      () => require('node:dns').lookup('example.invalid', () => {}),
      () => require('node:dns').promises.lookup('example.invalid'),
      () => require('node:dgram').createSocket('udp4'),
      () => new WebSocket('wss://example.invalid'),
    ]) assert.throws(attempt, /OFFLINE_PREVIEW_NETWORK_DISABLED/);
  `;
  const child = spawnSync(process.execPath, ['--require', preload, '-e', script], {
    env: previewChildEnvironment(process.env, directory), encoding: 'utf8', windowsHide: true,
  });
  assert.equal(child.status, 0, child.stderr);
});

test('bundle gzip size is capped below the Workers Free limit', () => {
  assert.equal(measurePreviewBundle(Buffer.from('small')).bytes, 5);
  assert.throws(() => measurePreviewBundle(randomBytes(PREVIEW_GZIP_LIMIT + 4096)));
});

test('built single module embeds exactly the public manifest and keeps auth configuration private', async () => {
  const marker = 'must-not-be-embedded-private-environment-marker';
  const old = process.env.HARU_PREVIEW_PASSWORD;
  process.env.HARU_PREVIEW_PASSWORD = marker;
  let result;
  try { result = await buildPreviewWorker(); }
  finally {
    if (old === undefined) delete process.env.HARU_PREVIEW_PASSWORD;
    else process.env.HARU_PREVIEW_PASSWORD = old;
  }
  assert.equal(result.assetCount, STANDALONE_GAME_ASSETS.length + 2);
  assert.ok(result.gzipBytes < PREVIEW_GZIP_LIMIT);
  const code = await readFile(result.output, 'utf8');
  assert.doesNotMatch(code, /must-not-be-embedded-private-environment-marker|sourceMappingURL=/);
  assert.ok(result.inputs.every(input => input === '.local/private-preview/entry.mjs' ||
    input.startsWith('server/') || input.startsWith('legacy/v040/') || input.startsWith('node_modules/jose/dist/webapi/')));
  const module = await import(`${pathToFileURL(result.output).href}?test=${result.sha256}`);
  assert.deepEqual(Object.keys(module), ['default']);
  // Workers supplies this primitive. Node supplies the equivalent only in
  // node:crypto; install it for this bundle behavior test, then restore it.
  const previous = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  try {
    const password = randomBytes(32).toString('base64url');
    const authorization = `Basic ${Buffer.from(`harufive:${password}`).toString('base64')}`;
    const env = {
      HARU_PREVIEW_PASSWORD: password, HARU_AUTH_ORIGIN: 'https://wrong.example',
      HARU_REGISTRATION_OPEN: 'true',
      get DB() { throw new Error('DB binding must not be read'); },
      get HARU_GOOGLE_CLIENT_SECRET() { throw new Error('provider secret must not be read'); },
    };
    for (const route of ['/', '/local-boot.js', ...STANDALONE_GAME_ASSETS.map(name => `/game/${name}`)]) {
      const unauthenticated = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}${route}`), env);
      assert.equal(unauthenticated.status, 401, route);
      const response = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}${route}`, { headers: { authorization } }), env);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('Cache-Control'), /no-store/);
      assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
      assert.ok((await response.text()).length > 0, route);
    }
    for (const route of ['/.env', '/server/worker.mjs', '/worker.mjs', '/game/app.js.map', '/game/unlisted.js', '/index.html']) {
      const response = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}${route}`, { headers: { authorization } }), env);
      assert.equal(response.status, 404, route);
    }
    assert.equal((await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/`), {})).status, 503);
    assert.equal((await module.default.fetch(new Request('https://other.example/', { headers: { authorization } }), env)).status, 403);
    const head = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/`, { method: 'HEAD', headers: { authorization } }), env);
    assert.equal(head.status, 200);
    assert.equal(await head.text(), '');
    const status = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/api/auth/status`, { headers: { authorization } }), env);
    assert.equal(status.status, 503);
  } finally {
    if (previous) Object.defineProperty(crypto.subtle, 'timingSafeEqual', previous);
    else delete crypto.subtle.timingSafeEqual;
  }
});

test('built connected module delays DB and OAuth reads until authenticated and keeps account creation closed', async t => {
  const result = await buildPreviewWorker({ connected: true });
  assert.equal(result.assetCount, STANDALONE_GAME_ASSETS.length + 2);
  assert.ok(result.inputs.includes('server/connected-preview-worker.mjs'));
  const module = await import(`${pathToFileURL(result.output).href}?connected-test=${result.sha256}`);
  assert.deepEqual(Object.keys(module), ['default']);
  const previous = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    configurable: true, value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  });
  t.after(() => {
    if (previous) Object.defineProperty(crypto.subtle, 'timingSafeEqual', previous);
    else delete crypto.subtle.timingSafeEqual;
  });
  const db = createSQLiteD1(); t.after(() => db.close());
  const password = Buffer.alloc(32, 0x4b).toString('base64url');
  const authorization = `Basic ${Buffer.from(`harufive:${password}`).toString('base64')}`;
  const allowed = {
    DB: db,
    HARU_GOOGLE_CLIENT_ID: 'connected-build-fixture-client',
    HARU_GOOGLE_CLIENT_SECRET: 'connected-build-fixture-secret',
  };
  const reads = [];
  const env = { HARU_PREVIEW_PASSWORD: password };
  for (const [name, value] of Object.entries(allowed)) {
    Object.defineProperty(env, name, { get() { reads.push(name); return value; } });
  }
  for (const name of ['HARU_AUTH_ORIGIN', 'HARU_REGISTRATION_OPEN', 'HARU_SITES_TESTER_EMAIL', 'CLOUDFLARE_API_TOKEN']) {
    Object.defineProperty(env, name, { get() { assert.fail(`Unapproved environment read: ${name}`); } });
  }
  for (const route of ['/', '/api/auth/status', '/api/auth/google/callback?code=x&state=y']) {
    const response = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}${route}`), env);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('WWW-Authenticate'), 'Basic realm="harufive-preview", charset="UTF-8"');
    assert.equal(response.headers.get('X-Haru-Application-Status'), null);
  }
  assert.deepEqual(reads, []);
  assert.equal((await module.default.fetch(new Request('https://other.example/', { headers: { authorization } }), env)).status, 403);
  assert.deepEqual(reads, []);
  const statusResponse = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/api/auth/status`, { headers: { authorization } }), env);
  assert.equal(statusResponse.status, 200);
  const status = await statusResponse.json();
  assert.equal(status.providers.find(provider => provider.id === 'google').enabled, true);
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.ageVerificationReady, false);
  assert.equal(status.reauthentication.enabled, false);
  assert.equal(status.sites.enabled, false);
  assert.ok(reads.includes('DB') && reads.includes('HARU_GOOGLE_CLIENT_SECRET'));
  assert.doesNotMatch(JSON.stringify(status), /connected-build-fixture|HARU_GOOGLE_CLIENT_SECRET/);
  assert.equal(db.rows('SELECT * FROM auth_accounts').length, 0);
  const policy = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/game/policy-views.js`, { headers: { authorization } }), env);
  assert.equal(policy.status, 200);
  const bootstrap = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/api/game/bootstrap`, { headers: { authorization } }), env);
  assert.equal(bootstrap.status, 403);
  assert.equal(bootstrap.headers.get('X-Haru-Application-Status'), '401');
  assert.equal(bootstrap.headers.get('WWW-Authenticate'), null);
  assert.equal((await bootstrap.json()).code, 'SIGN_IN_REQUIRED');
  const health = await module.default.fetch(new Request(`${PREVIEW_ORIGIN}/api/health`, { headers: { authorization } }), env);
  assert.equal(health.status, 200);
  assert.equal(health.headers.get('X-Haru-Application-Status'), null);
  const code = await readFile(result.output, 'utf8');
  assert.doesNotMatch(code, /connected-build-fixture-secret|sourceMappingURL=/);
});
