import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../server/worker.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://game.example';
function fixture(t, overrides = {}) {
  const db = createSQLiteD1(); t.after(() => db.close());
  const assets = [];
  const env = {
    DB: db, HARU_AUTH_ORIGIN: ORIGIN,
    ASSETS: { async fetch(request) {
      assets.push({ url: request.url, method: request.method });
      return new Response('public asset only', { headers: { 'Content-Type': 'text/plain' } });
    } }, ...overrides,
  };
  return { db, env, assets, call: (pathname, init) => worker.fetch(new Request(ORIGIN + pathname, init), env, {}) };
}

test('worker routes the public root and game files through the assets binding', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/')).status, 200);
  assert.equal(new URL(f.assets[0].url).pathname, '/index.html');
  const script = await f.call('/game/app.js?v=review');
  assert.equal(script.status, 200);
  assert.equal(new URL(f.assets[1].url).pathname, '/game/app.js');
  assert.equal(script.headers.get('X-Content-Type-Options'), 'nosniff');
  const head = await f.call('/game/styles.css', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('worker rejects private and unknown paths without consulting asset storage', async t => {
  const f = fixture(t);
  for (const pathname of ['/.env', '/.dev.vars', '/.git/config', '/server/game-service.mjs',
    '/legacy/v040/game-core.js', '/.local/haru-five.sqlite', '/drizzle/0000_initial.sql',
    '/index.html', '/game/source.map', '/game/unknown.js', '/game/subdir/app.js',
    '/signin-with-chatgpt', '/missing', '/%2eenv', '/game/%2e%2e/server/auth-service.mjs']) {
    const response = await f.call(pathname);
    assert.equal(response.status, 404, pathname);
  }
  assert.equal(f.assets.length, 0);
});

test('worker keeps static and API method handling separate without SPA fallbacks', async t => {
  const f = fixture(t);
  const post = await f.call('/game/app.js', { method: 'POST', body: 'never an asset write' });
  assert.equal(post.status, 405); assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  assert.equal(f.assets.length, 0);
  assert.equal((await f.call('/api/health', { method: 'HEAD' })).status, 405);
  for (const pathname of ['/api', '/api/', '/api/missing', '/api/auth/status/extra']) {
    const response = await f.call(pathname);
    assert.equal(response.status, 404);
    assert.match(response.headers.get('Content-Type'), /application\/json/);
  }
  assert.equal(f.assets.length, 0);
});

test('worker pins a configured HTTPS origin before accessing assets or data', async t => {
  const f = fixture(t);
  for (const pathname of ['/', '/game/app.js', '/api/health']) {
    const response = await worker.fetch(new Request('https://other.example' + pathname), f.env, {});
    assert.equal(response.status, 403);
  }
  assert.equal(f.assets.length, 0);
  for (const invalid of ['http://game.example', 'https://game.example/path', ' https://game.example', 'https://user:pass@game.example']) {
    const response = await worker.fetch(new Request(ORIGIN + '/'), { ...f.env, HARU_AUTH_ORIGIN: invalid }, {});
    assert.equal(response.status, 503);
  }
  assert.equal(f.assets.length, 0);
});

test('unconfigured preparation worker is limited to loopback and cannot become a public preview', async t => {
  const f = fixture(t, { HARU_AUTH_ORIGIN: undefined });
  assert.equal((await f.call('/')).status, 503);
  assert.equal((await f.call('/api/health')).status, 503);
  assert.equal(f.assets.length, 0);
  const local = await worker.fetch(new Request('http://127.0.0.1:8787/api/health'), f.env, {});
  assert.equal(local.status, 200);
  assert.equal((await local.json()).database, 'ready');
});

test('worker ignores Sites identities and provider secrets while keeping all admission gates closed', async t => {
  const f = fixture(t, {
    HARU_REGISTRATION_OPEN: 'true', HARU_REAUTH_ENABLED: 'true',
    HARU_GOOGLE_CLIENT_ID: 'fixture-client', HARU_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    HARU_SITES_TESTER_EMAIL: 'fixture@example.test',
  });
  const headers = { 'oai-authenticated-user-id': 'forged-owner',
    'oai-authenticated-user-email': 'fixture@example.test', Cookie: '__Host-haru_session=sites' };
  const status = await (await f.call('/api/auth/status', { headers })).json();
  assert.equal(status.authenticated, false); assert.equal(status.sites.enabled, false);
  assert.equal(status.registration.open, false); assert.equal(status.registration.guardianReady, false);
  assert.equal(status.reauthentication.enabled, false);
  assert.ok(status.providers.every(p => !p.enabled));
  assert.equal((await f.call('/api/game/bootstrap', { headers })).status, 401);
  for (const intent of ['login', 'reauth']) {
    const response = await f.call('/api/auth/google/start', { method: 'POST',
      headers: { ...headers, Origin: ORIGIN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ intent }) });
    assert.equal(response.status, 503);
    assert.equal(response.headers.getSetCookie().length, 0);
  }
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 0);
  assert.equal(f.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
  assert.equal(f.assets.length, 0);
});

test('worker reports missing database and assets without exposing internal exceptions', async t => {
  const f = fixture(t);
  const health = await worker.fetch(new Request(ORIGIN + '/api/health'), { ...f.env, DB: undefined }, {});
  assert.equal(health.status, 503);
  const missing = await worker.fetch(new Request(ORIGIN + '/'), { ...f.env, ASSETS: undefined }, {});
  assert.equal(missing.status, 503);
  const broken = await worker.fetch(new Request(ORIGIN + '/'), {
    ...f.env, ASSETS: { fetch() { throw new Error('SECRET_INTERNAL_MARKER'); } },
  }, {});
  assert.equal(broken.status, 503);
  assert.doesNotMatch(await broken.text(), /SECRET_INTERNAL_MARKER|stack|worker\.mjs/);
});
