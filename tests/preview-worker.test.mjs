import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import preview, { handlePreviewWorkerRequest } from '../server/preview-worker.mjs';

const ORIGIN = 'https://harufive-preview.example';
// Public synthetic fixtures, not deployment credentials.
const PASSWORD = Buffer.alloc(32, 0x35).toString('base64url');
const NEXT_PASSWORD = Buffer.alloc(32, 0x77).toString('base64url');
const basic = (password = PASSWORD, username = 'harufive') =>
  `Basic ${Buffer.from(`${username}:${password}`).toString('base64')}`;

function fixture(t, overrides = {}) {
  // Only the Node test runtime supplies the Workers-specific primitive.
  const prior = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    configurable: true, value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  });
  t.after(() => {
    if (prior) Object.defineProperty(crypto.subtle, 'timingSafeEqual', prior);
    else delete crypto.subtle.timingSafeEqual;
  });
  const assets = [];
  const env = { HARU_AUTH_ORIGIN: ORIGIN, HARU_PREVIEW_PASSWORD: PASSWORD,
    ASSETS: { async fetch(request) {
      assets.push(request);
      return new Response('public preview fixture', { headers: {
        'Content-Type': 'text/plain', 'Cache-Control': 'public, max-age=3600',
      } });
    } }, ...overrides };
  // Any access to a DB binding is a regression, even with a correct password.
  let databaseReads = 0;
  Object.defineProperty(env, 'DB', { get() { databaseReads++; throw new Error('Database forbidden'); } });
  t.after(() => assert.equal(databaseReads, 0, 'Preview must not read DB binding'));
  return { assets, env, call: (path = '/', init = {}, target = ORIGIN) =>
    preview.fetch(new Request(target + path, init), env) };
}

function assertSealed(response) {
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('X-Robots-Tag'), 'noindex, nofollow, noarchive');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.equal(response.headers.get('X-Frame-Options'), 'DENY');
  assert.equal(response.headers.get('Strict-Transport-Security'), 'max-age=31536000');
  assert.match(response.headers.get('Permissions-Policy'), /payment=\(\)/);
  assert.match(response.headers.get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.match(response.headers.get('Vary'), /Authorization/);
  assert.equal(response.headers.getSetCookie().length, 0);
}

test('preview fails closed for absent or malformed secret/origin before reading assets', async t => {
  const f = fixture(t);
  assert.equal(preview.fetch, handlePreviewWorkerRequest);
  for (const invalid of [undefined, null, '', 'short-password', 43, 'x'.repeat(42),
    'A'.repeat(44), 'A'.repeat(42) + 'B', 'A'.repeat(42) + '+', ` ${PASSWORD}`, `${PASSWORD}\n`]) {
    const response = await preview.fetch(new Request(ORIGIN), { ...f.env, HARU_PREVIEW_PASSWORD: invalid });
    assert.equal(response.status, 503); assertSealed(response);
    assert.equal((await response.json()).code, 'PREVIEW_NOT_CONFIGURED');
  }
  for (const invalid of [undefined, null, '', 'http://harufive-preview.example', `${ORIGIN}/`,
    `${ORIGIN}/path`, `${ORIGIN}?key=test`, `${ORIGIN}#fragment`, ` ${ORIGIN}`,
    'https://user:pass@harufive-preview.example', 'https://HARUFIVE-PREVIEW.example']) {
    const response = await preview.fetch(new Request(ORIGIN), { ...f.env, HARU_AUTH_ORIGIN: invalid });
    assert.equal(response.status, 503); assertSealed(response);
  }
  assert.equal(f.assets.length, 0);
});

test('preview pins exact HTTPS origin before authentication on every route', async t => {
  const f = fixture(t);
  for (const target of ['https://other.example', 'http://harufive-preview.example',
    'http://127.0.0.1:8787', 'https://harufive-preview.example:444']) {
    for (const path of ['/', '/game/app.js', '/api/health']) {
      const response = await f.call(path, { headers: { Authorization: basic() } }, target);
      assert.equal(response.status, 403); assertSealed(response);
      assert.equal(response.headers.get('WWW-Authenticate'), null);
      assert.equal(response.headers.get('X-Haru-Application-Status'), null);
    }
  }
  assert.equal(f.assets.length, 0);
});

test('every asset, API, private path and method requires authentication first', async t => {
  const f = fixture(t);
  for (const path of ['/', '/game/app.js', '/local-boot.js', '/favicon.ico', '/api/health',
    '/api/auth/status', '/api/game/bootstrap', '/api/privacy/status', '/.env', '/missing']) {
    for (const method of ['GET', 'HEAD', 'POST', 'OPTIONS']) {
      const response = await f.call(path, { method });
      assert.equal(response.status, 401, `${method} ${path}`); assertSealed(response);
      assert.equal(response.headers.get('WWW-Authenticate'), 'Basic realm="harufive-preview", charset="UTF-8"');
      assert.equal(response.headers.get('X-Haru-Application-Status'), null);
      if (method === 'HEAD') assert.equal(await response.text(), '');
    }
  }
  assert.equal(f.assets.length, 0);
});

test('invalid and ambiguous Basic headers never reach protected code or leak credentials', async t => {
  const f = fixture(t);
  const encoded = basic().slice(6);
  for (const authorization of ['Bearer fixture', 'Basic', 'Basic !!!', 'Basic Zg',
    `Basic ${encoded.slice(0, -1)}`, `Basic ${encoded}=`, `Basic ${encoded}, ${encoded}`,
    `Basic  ${encoded}`, `Basic ${'A'.repeat(300)}`, basic(NEXT_PASSWORD),
    basic(PASSWORD, 'other'), basic(PASSWORD, 'HARUFIVE'), basic(`${PASSWORD}:extra`),
    `Basic ${Buffer.from('harufive:\u0000').toString('base64')}`]) {
    const response = await f.call('/', { headers: { Authorization: authorization } });
    assert.equal(response.status, 401); assertSealed(response);
    assert.equal(response.headers.get('WWW-Authenticate'), 'Basic realm="harufive-preview", charset="UTF-8"');
    assert.equal(response.headers.get('X-Haru-Application-Status'), null);
    assert.doesNotMatch(await response.text(), new RegExp(PASSWORD));
  }
  assert.equal(f.assets.length, 0);
});

test('accepted preview access preserves downstream unauthorized bodies and cookies without a new challenge', async t => {
  const f = fixture(t, { ASSETS: { fetch() {
    return Response.json({ code: 'AUTH_REQUIRED', message: 'fixture application login' }, {
      status: 401, statusText: 'Unauthorized', headers: {
        'WWW-Authenticate': 'Basic realm="unexpected-downstream"',
        'Set-Cookie': '__Host-fixture=; Path=/; Max-Age=0; Secure; HttpOnly',
      },
    });
  } } });
  for (const method of ['GET', 'HEAD']) {
    const response = await f.call('/', { method, headers: { Authorization: basic() } });
    assert.equal(response.status, 403);
    assert.equal(response.statusText, 'Forbidden');
    assert.equal(response.headers.get('X-Haru-Application-Status'), '401');
    assert.equal(response.headers.get('WWW-Authenticate'), null);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    assert.deepEqual(response.headers.getSetCookie(), ['__Host-fixture=; Path=/; Max-Age=0; Secure; HttpOnly']);
    if (method === 'HEAD') assert.equal(await response.text(), '');
    else assert.deepEqual(await response.json(), { code: 'AUTH_REQUIRED', message: 'fixture application login' });
  }
});

test('valid access reuses the public allowlist and removes credentials from asset requests', async t => {
  const f = fixture(t);
  const headers = { Authorization: basic(), 'Proxy-Authorization': 'Basic proxy-fixture',
    Cookie: 'secret-cookie-fixture', 'oai-authenticated-user-id': 'forged' };
  const root = await f.call('/', { headers });
  assert.equal(root.status, 200); assertSealed(root);
  assert.equal(new URL(f.assets[0].url).pathname, '/index.html');
  assert.equal(f.assets[0].headers.get('Authorization'), null);
  assert.equal(f.assets[0].headers.get('Proxy-Authorization'), null);
  assert.equal(f.assets[0].headers.get('Cookie'), null);
  assert.equal(f.assets[0].headers.get('oai-authenticated-user-id'), null);
  const head = await f.call('/game/app.js', { method: 'HEAD', headers });
  assert.equal(head.status, 200); assert.equal(await head.text(), ''); assertSealed(head);
  const before = f.assets.length;
  assert.equal((await f.call('/.env', { headers })).status, 404);
  assert.equal((await f.call('/game/app.js', { method: 'POST', headers, body: 'fixture' })).status, 405);
  assert.equal(f.assets.length, before);
  assert.equal((await f.call('/', { headers: { Authorization: basic().replace('Basic', 'basic') } })).status, 200);
});

test('password rotation rejects the old value on the very next request', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/', { headers: { Authorization: basic() } })).status, 200);
  f.env.HARU_PREVIEW_PASSWORD = NEXT_PASSWORD;
  assert.equal((await f.call('/', { headers: { Authorization: basic() } })).status, 401);
  assert.equal((await f.call('/', { headers: { Authorization: basic(NEXT_PASSWORD) } })).status, 200);
  assert.equal(f.assets.length, 2);
});

test('preview cannot enable accounts, registration, reauthentication or a database', async t => {
  const f = fixture(t, { HARU_REGISTRATION_OPEN: 'true', HARU_REAUTH_ENABLED: 'true',
    HARU_GOOGLE_CLIENT_ID: 'fixture-id', HARU_GOOGLE_CLIENT_SECRET: 'fixture-secret',
    HARU_SITES_TESTER_EMAIL: 'fixture@example.test' });
  const headers = { Authorization: basic(), 'oai-authenticated-user-id': 'forged',
    'oai-authenticated-user-email': 'fixture@example.test', Cookie: '__Host-haru_session=fixture' };
  const statusResponse = await f.call('/api/auth/status', { headers });
  // No fake account status is manufactured when the database is deliberately absent.
  assert.equal(statusResponse.status, 503); assertSealed(statusResponse);
  assert.equal((await f.call('/api/game/bootstrap', { headers })).status, 503);
  assert.equal((await f.call('/api/privacy/status', { headers })).status, 503);
  const health = await f.call('/api/health', { headers });
  assert.equal(health.status, 503); assertSealed(health);
  for (const intent of ['login', 'reauth']) {
    const response = await f.call('/api/auth/google/start', { method: 'POST', headers: {
      ...headers, Origin: ORIGIN, 'Content-Type': 'application/json',
    }, body: JSON.stringify({ intent }) });
    assert.equal(response.status, 503); assertSealed(response);
  }
  assert.equal(f.assets.length, 0);
});

test('unavailable crypto and downstream exceptions fail closed with redacted errors', async t => {
  const f = fixture(t);
  const compare = crypto.subtle.timingSafeEqual;
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: undefined });
  const unavailable = await f.call('/', { headers: { Authorization: basic() } });
  assert.equal(unavailable.status, 503); assertSealed(unavailable);
  assert.equal((await unavailable.json()).code, 'PREVIEW_UNAVAILABLE');
  assert.equal(f.assets.length, 0);
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true, value: compare });
  const missing = await preview.fetch(new Request(ORIGIN, { headers: { Authorization: basic() } }),
    { ...f.env, ASSETS: undefined });
  assert.equal(missing.status, 503); assertSealed(missing);
  f.env.ASSETS = { fetch() { throw new Error(`NEVER_EXPOSE ${PASSWORD}`); } };
  const broken = await f.call('/', { headers: { Authorization: basic() } });
  assert.equal(broken.status, 503); assertSealed(broken);
  assert.doesNotMatch(await broken.text(), /NEVER_EXPOSE|NTU1|stack|preview-worker/);
});
