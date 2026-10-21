import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { handleStandaloneRequest } from '../server/standalone-http.mjs';
import { handleAuthRequest } from '../server/auth-service.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://game.example', NOW = Date.parse('2026-10-20T00:00:00Z');
const forged = { 'oai-authenticated-user-id': 'victim', 'oai-authenticated-user-email': 'tester@example.test' };
function fixture(t) {
  const db = createSQLiteD1(); t.after(() => db.close());
  const env = { HARU_AUTH_ORIGIN: ORIGIN, HARU_REGISTRATION_OPEN: 'true', HARU_SITES_TESTER_EMAIL: 'tester@example.test' };
  const call = (pathname, { method = 'GET', body, headers = {}, origin = ORIGIN } = {}) => handleStandaloneRequest(new Request(origin + pathname, {
    method, headers: { ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }), { db, env, now: () => NOW, sitesUserId: 'victim', sitesEmail: 'tester@example.test' });
  function session(account, token = 'a'.repeat(43)) {
    const hash = createHash('sha256').update(token).digest('hex');
    db.sqlite.prepare('INSERT INTO auth_accounts (id, created_at) VALUES (?, ?)').run(account, NOW);
    db.sqlite.prepare('INSERT INTO auth_sessions (token_hash, account_id, provider, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
      .run(hash, account, 'google', NOW, NOW + 60000);
    return { Cookie: `__Host-haru_session=${token}` };
  }
  return { db, call, session, env };
}

test('standalone rejects forged Sites headers, sites cookies and trusted-option leakage without creating records', async t => {
  const f = fixture(t);
  for (const cookie of ['', '__Host-haru_session=sites', '__Host-haru_session=' + 'z'.repeat(43)]) {
    const headers = { ...forged, Cookie: cookie };
    for (const [pathname, init] of [
      ['/api/game/bootstrap', {}], ['/api/game/export', {}],
      ['/api/game/purchase', { method: 'POST', body: { itemId: 'character-cat', requestId: 'request-forged-0001' } }],
    ]) {
      const response = await f.call(pathname, { ...init, headers });
      assert.equal(response.status, 401);
      const payload = await response.json(); assert.equal(payload.signInUrl, '/');
      assert.doesNotMatch(JSON.stringify(payload), /victim|signin-with-chatgpt|tester@/);
    }
    const status = await (await f.call('/api/auth/status', { headers })).json();
    assert.equal(status.authenticated, false); assert.equal(status.sites.enabled, false);
    assert.equal(status.registration.open, false); assert.equal(status.registration.guardianReady, false);
  }
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 0);
});

test('standalone excludes Sites routes and maintains method and pinned origin checks', async t => {
  const f = fixture(t);
  for (const path of ['/signin-with-chatgpt', '/signout-with-chatgpt', '/callback', '/api/auth/sites-start', '/api/auth/google/start/extra']) {
    const response = await f.call(path, { method: 'POST', body: {}, headers: forged });
    assert.equal(response.status, 404); assert.equal(response.headers.getSetCookie().length, 0);
  }
  assert.equal((await f.call('/api/health')).status, 200);
  assert.equal((await f.call('/api/health', { method: 'POST', body: {} })).status, 405);
  assert.equal((await f.call('/api/game/bootstrap', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await f.call('/api/auth/google/start', { method: 'POST', body: { intent: 'login' }, headers: { Origin: 'https://evil.example' } })).status, 403);
  assert.equal((await f.call('/api/auth/google/start', { method: 'POST', body: { intent: 'login' } })).status, 503);
  const disabled = await handleAuthRequest(new Request(ORIGIN + '/api/auth/sites-start', { method: 'POST' }), {
    db: f.db, env: f.env, action: 'sites-start', sitesEnabled: false, sitesUserId: 'victim', sitesEmail: 'tester@example.test',
  });
  assert.equal(disabled.status, 404);
});

test('standalone verified sessions preserve rabbit, coins, attempt resume, account isolation and logout', async t => {
  const f = fixture(t), cookie = f.session('owner');
  const initial = await (await f.call('/api/game/bootstrap', { headers: { ...cookie, ...forged } })).json();
  assert.deepEqual(initial.state.owned.filter(id => id.startsWith('character-')), ['character-rabbit']);
  assert.equal(initial.state.coins, 180);
  const headers = { ...cookie, 'X-Haru-Player': initial.state.playerId };
  const start = await f.call('/api/game/start', { method: 'POST', headers, body: { mode: 'daily', requestId: 'local-start-00001' } });
  assert.equal(start.status, 200);
  const started = await start.json();
  const resumed = await (await f.call('/api/game/bootstrap', { headers })).json();
  assert.equal(started.state.active.id, resumed.state.active.id);
  assert.equal((await f.call('/api/game/purchase', { method: 'POST', headers: { ...cookie, 'X-Haru-Player': 'other-player' }, body: { itemId: 'character-cat', requestId: 'local-shop-000001' } })).status, 409);
  const logout = await f.call('/api/auth/logout', { method: 'POST', headers: cookie, body: {} });
  assert.equal(logout.status, 200);
  assert.equal((await f.call('/api/game/bootstrap', { headers: { ...cookie, ...forged } })).status, 401);
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 1);
});

test('standalone session lookup remains after complete answer-body receipt', async t => {
  const f = fixture(t), headers = f.session('owner');
  let released = false, queries = 0, stream;
  f.db.beforeQuery = ({ sql }) => {
    if (sql.includes('auth_sessions')) { queries++; assert.equal(released, true); }
  };
  const body = new ReadableStream({ start(controller) {
    stream = controller; controller.enqueue(new TextEncoder().encode('{"mode":"daily",'));
  } });
  const pending = handleStandaloneRequest(new Request(ORIGIN + '/api/game/start', { method: 'POST',
    headers: { ...headers, Origin: ORIGIN, 'Content-Type': 'application/json' }, body, duplex: 'half' }), { db: f.db, env: f.env, now: () => NOW });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(queries, 0);
  stream.enqueue(new TextEncoder().encode('"requestId":"streamed-000001"}'));
  released = true; stream.close();
  assert.equal((await pending).status, 409);
  assert.equal(queries, 1);
});


test('standalone keeps reauthentication closed even for an existing linked account and configured provider', async t => {
  const f = fixture(t), headers = f.session('owner');
  f.env.HARU_GOOGLE_CLIENT_ID = 'test-client';
  f.env.HARU_GOOGLE_CLIENT_SECRET = 'test-secret';
  f.env.HARU_REAUTH_ENABLED = 'true';
  f.db.sqlite.prepare(`INSERT INTO auth_identities
    (id, account_id, provider, issuer, audience, subject, linked_at)
    VALUES ('fixture-identity', 'owner', 'google', 'https://accounts.google.com', 'test-client', 'fixture-subject', ?)`).run(NOW);
  await f.call('/api/game/bootstrap', { headers });
  const status = await (await f.call('/api/auth/status', { headers })).json();
  assert.equal(status.reauthentication.enabled, false);
  assert.ok(status.reauthentication.providers.every(provider => provider.enabled === false));
  assert.equal(status.registration.open, false);
  const response = await f.call('/api/auth/google/start', { method: 'POST',
    headers: { ...headers, 'X-Haru-Account': status.reauthentication.accountContext },
    body: { intent: 'reauth' },
  });
  assert.equal(response.status, 503);
  assert.equal(response.headers.getSetCookie().length, 0);
  assert.equal(f.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
  assert.equal(f.db.rows('SELECT authenticated_at FROM auth_sessions')[0].authenticated_at, null);
});
