import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import connected from '../server/connected-preview-worker.mjs';
import preview from '../server/preview-worker.mjs';
import worker from '../server/worker.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://connected-preview.example';
const PASSWORD = Buffer.alloc(32, 0x64).toString('base64url');
const BASIC = `Basic ${Buffer.from(`harufive:${PASSWORD}`).toString('base64')}`;
const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const jwk = { ...await exportJWK(pair.publicKey), kid: 'connected-fixture', alg: 'RS256', use: 'sig' };
const PROVIDERS = {
  google: { issuer: 'https://accounts.google.com', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  kakao: { issuer: 'https://kauth.kakao.com', token: 'https://kauth.kakao.com/oauth/token', jwks: 'https://kauth.kakao.com/.well-known/jwks.json' },
  naver: { issuer: 'https://nid.naver.com', token: 'https://nid.naver.com/oauth2/token', jwks: 'https://nid.naver.com/oauth2/jwks' },
};
function cookies(response, before = '') {
  const jar = new Map(before.split(';').map(value => value.trim()).filter(Boolean).map(value => value.split('=')));
  for (const item of response.headers.getSetCookie()) {
    const [name, value] = item.split(';')[0].split('=');
    if (item.includes('Max-Age=0')) jar.delete(name); else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}
function fixture(t) {
  const db = createSQLiteD1(); t.after(() => db.close());
  const prior = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    configurable: true, value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  });
  t.after(() => {
    if (prior) Object.defineProperty(crypto.subtle, 'timingSafeEqual', prior);
    else delete crypto.subtle.timingSafeEqual;
  });
  const env = { DB: db, HARU_AUTH_ORIGIN: ORIGIN, HARU_PREVIEW_PASSWORD: PASSWORD,
    HARU_REGISTRATION_OPEN: 'true', HARU_REAUTH_ENABLED: 'true', HARU_EXISTING_ACCOUNT_LOGIN: 'true',
    ASSETS: { async fetch() { return new Response('public fixture'); } } };
  for (const id of Object.keys(PROVIDERS)) {
    env[`HARU_${id.toUpperCase()}_CLIENT_ID`] = `fixture-${id}-client`;
    env[`HARU_${id.toUpperCase()}_CLIENT_SECRET`] = `fixture-${id}-secret`;
  }
  env.HARU_KAKAO_OIDC_ENABLED = 'true';
  for (const name of ['HARU_SITES_TESTER_EMAIL', 'HARU_GUARDIAN_PUBLIC_KEY', 'CLOUDFLARE_API_TOKEN']) {
    Object.defineProperty(env, name, { get() { assert.fail(`Unexpected setting access: ${name}`); } });
  }
  const calls = [], codes = new Map();
  let serial = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    calls.push({ url, init });
    const id = Object.keys(PROVIDERS).find(key => [PROVIDERS[key].token, PROVIDERS[key].jwks].includes(url));
    assert.ok(id, 'Only pinned provider endpoints receive upstream requests');
    assert.equal(init.redirect, 'manual');
    const headers = new Headers(init.headers);
    assert.equal(headers.get('Authorization'), null);
    assert.equal(headers.get('Cookie'), null);
    assert.ok(!JSON.stringify(init).includes(PASSWORD), 'Preview password never reaches a provider');
    if (url === PROVIDERS[id].jwks) return Response.json({ keys: [jwk] });
    const body = new URLSearchParams(init.body), flow = codes.get(body.get('code'));
    assert.ok(flow); assert.equal(flow.used, false); flow.used = true;
    assert.equal(body.get('client_id'), env[`HARU_${id.toUpperCase()}_CLIENT_ID`]);
    assert.equal(body.get('client_secret'), env[`HARU_${id.toUpperCase()}_CLIENT_SECRET`]);
    assert.equal(body.get('redirect_uri'), `${ORIGIN}/api/auth/${id}/callback`);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
    assert.equal(challenge, flow.challenge);
    const seconds = Math.floor(Date.now() / 1000);
    let token = await new SignJWT({ iss: PROVIDERS[id].issuer, aud: env[`HARU_${id.toUpperCase()}_CLIENT_ID`],
      sub: flow.subject, nonce: flow.nonce, iat: seconds, exp: seconds + 300,
      ...(flow.authTime ? { auth_time: seconds } : {}),
    }).setProtectedHeader({ alg: 'RS256', kid: 'connected-fixture' }).sign(pair.privateKey);
    if (flow.tamper) token = `${token.slice(0, -12)}XXXXXXXXXXXX`;
    return Response.json({ id_token: token, access_token: 'unused-fixture-access-token' });
  });
  const f = { db, env, calls, codes,
    call(path, { method = 'GET', body, cookie = '', headers = {}, target = ORIGIN, auth = true } = {}, adapter = connected) {
      return adapter.fetch(new Request(target + path, { method,
        headers: { ...(auth ? { Authorization: BASIC } : {}), ...(cookie ? { Cookie: cookie } : {}),
          ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...headers },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }), env);
    },
    seed(id, subject = 'existing-subject', account = `existing-${id}`) {
      db.sqlite.prepare('INSERT OR IGNORE INTO auth_accounts(id,created_at) VALUES (?,?)').run(account, Date.now());
      db.sqlite.prepare('INSERT INTO auth_identities(id,account_id,provider,issuer,audience,subject,linked_at) VALUES (?,?,?,?,?,?,?)')
        .run(`identity-${++serial}`, account, id, PROVIDERS[id].issuer, env[`HARU_${id.toUpperCase()}_CLIENT_ID`], subject, Date.now());
      return account;
    },
    async begin(id = 'google', { subject = 'existing-subject', cookie = '', authTime = false, tamper = false } = {}) {
      const response = await f.call(`/api/auth/${id}/start`, { method: 'POST', body: { intent: 'login' }, cookie });
      assert.equal(response.status, 200, await response.clone().text());
      const url = new URL((await response.json()).url);
      const flow = { id, subject, authTime, tamper, code: `code-${++serial}`,
        state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'),
        challenge: url.searchParams.get('code_challenge'), cookie: cookies(response, cookie), used: false };
      codes.set(flow.code, flow);
      return flow;
    },
    callback(flow) {
      return f.call(`/api/auth/${flow.id}/callback?${new URLSearchParams({ code: flow.code, state: flow.state })}`,
        { cookie: flow.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } });
    },
    async login(id = 'google', args = {}) {
      const flow = await f.begin(id, args), response = await f.callback(flow);
      assert.equal(response.status, 303);
      assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
      return { cookie: cookies(response, flow.cookie), response, flow };
    },
  };
  return f;
}

test('connected entry checks origin and preview password before reading DB or OAuth keys', async t => {
  const f = fixture(t);
  let reads = 0;
  for (const name of ['DB', 'HARU_GOOGLE_CLIENT_ID', 'HARU_GOOGLE_CLIENT_SECRET']) {
    Object.defineProperty(f.env, name, { get() { reads++; throw new Error('must remain unread'); } });
  }
  for (const path of ['/', '/api/health', '/api/auth/status', '/api/auth/google/callback?code=x&state=y']) {
    assert.equal((await f.call(path, { auth: false })).status, 401);
    assert.equal((await f.call(path, { headers: { Authorization: 'Basic aW52YWxpZA==' } })).status, 401);
    assert.equal((await f.call(path, { target: 'https://other.example' })).status, 403);
  }
  assert.equal(reads, 0); assert.equal(f.calls.length, 0);
});

test('ordinary preview and worker remain closed even when connection flags and credentials are supplied', async t => {
  const f = fixture(t);
  assert.equal((await f.call('/api/auth/status', {}, preview)).status, 503);
  const standard = await f.call('/api/auth/status', {}, worker);
  assert.equal(standard.status, 200);
  assert.ok((await standard.json()).providers.every(provider => !provider.enabled));
  assert.equal((await f.call('/api/auth/google/start', { method: 'POST', body: { intent: 'login' },
    headers: { 'X-Haru-Existing-Account-Login': 'true' } }, worker)).status, 503);
  assert.equal(f.calls.length, 0);
  assert.equal(f.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
});

test('connected status offers configured existing-account login without changing admission or reauthentication', async t => {
  const f = fixture(t);
  const response = await f.call('/api/auth/status');
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.ok(status.providers.every(provider => provider.enabled));
  assert.equal(status.sites.enabled, false); assert.equal(status.authenticated, false);
  assert.equal(status.registration.open, false); assert.equal(status.registration.minimumSignupAge, 14);
  assert.equal(status.registration.ageVerificationReady, false); assert.equal(status.registration.under14EnrollmentOpen, false);
  assert.equal(status.reauthentication.enabled, false);
  assert.ok(status.reauthentication.providers.every(provider => !provider.enabled));
  assert.doesNotMatch(JSON.stringify(status), /fixture-.*-(client|secret)/);
  assert.equal((await f.call('/api/health')).status, 200);
  for (const id of Object.keys(PROVIDERS)) {
    assert.equal((await f.call(`/api/auth/${id}/start`, { method: 'POST', body: { intent: 'reauth' } })).status, 503);
  }
  assert.equal(f.calls.length, 0);
});

for (const id of Object.keys(PROVIDERS)) {
  test(`connected ${id} signed login resumes only its existing account and persists game progress`, async t => {
    const f = fixture(t), account = f.seed(id);
    const login = await f.login(id);
    assert.ok(login.response.headers.getSetCookie().some(value => value.startsWith('__Host-haru_session=') &&
      value.includes('HttpOnly') && value.includes('Secure') && value.includes('SameSite=Lax')));
    const bootstrap = await f.call('/api/game/bootstrap', { cookie: login.cookie,
      headers: { 'oai-authenticated-user-id': 'other-account', 'oai-authenticated-user-email': 'wrong@example.test' } });
    assert.equal(bootstrap.status, 200);
    const { state } = await bootstrap.json();
    assert.deepEqual(state.owned.filter(item => item.startsWith('character-')), ['character-rabbit']);
    const headers = { 'X-Haru-Player': state.playerId };
    const renamed = await f.call('/api/game/rename', { method: 'POST', cookie: login.cookie, headers,
      body: { name: '연결검증', requestId: 'connected-name-001' } });
    assert.equal(renamed.status, 200);
    const start = await f.call('/api/game/start', { method: 'POST', cookie: login.cookie, headers,
      body: { mode: 'daily', requestId: 'connected-start-001' } });
    assert.equal(start.status, 200);
    const started = await start.json();
    const duplicate = await f.call('/api/game/start', { method: 'POST', cookie: login.cookie, headers,
      body: { mode: 'daily', requestId: 'connected-start-001' } });
    assert.equal(duplicate.status, 200);
    const freshLogin = await f.login(id);
    const restored = await (await f.call('/api/game/bootstrap', { cookie: freshLogin.cookie })).json();
    assert.equal(restored.state.playerId, state.playerId);
    assert.equal(restored.state.active.id, started.state.active.id);
    assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
    assert.equal(f.db.rows('SELECT * FROM game_players')[0].id, account);
    assert.equal(f.db.rows('SELECT * FROM game_attempts').length, 1);
    assert.equal(f.db.rows('SELECT * FROM auth_sessions').every(row => row.authenticated_at === null), true);
    assert.equal((await f.call('/api/privacy/status', { cookie: freshLogin.cookie })).status, 401,
      'Ordinary login without signed auth_time cannot acquire recent rights authority');
    assert.equal((await f.call('/api/auth/logout', { method: 'POST', cookie: freshLogin.cookie, body: {} })).status, 200);
    assert.equal((await f.call('/api/game/bootstrap', { cookie: freshLogin.cookie })).status, 401);
    assert.equal(f.db.rows('SELECT * FROM game_attempts').length, 1, 'Logout does not remove progress');
  });
}

test('verified but unknown provider subject cannot create an account, identity, session or game player', async t => {
  const f = fixture(t);
  for (const id of Object.keys(PROVIDERS)) {
    const flow = await f.begin(id, { subject: 'never-admitted' });
    const response = await f.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith('__Host-haru_session=') && !value.includes('Max-Age=0')));
  }
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions', 'game_players']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 0, table);
  }
});

test('invalid signatures, stale flows and closed existing accounts never gain game access', async t => {
  const f = fixture(t), account = f.seed('google');
  const tampered = await f.begin('google', { tamper: true });
  assert.equal((await f.callback(tampered)).headers.get('Location'), `${ORIGIN}/?auth_error=verification_failed`);
  const expired = await f.begin('google');
  f.db.sqlite.prepare('UPDATE auth_oauth_transactions SET created_at = ?, expires_at = ?').run(Date.now() - 601000, Date.now() - 1000);
  const callCount = f.calls.length;
  assert.equal((await f.callback(expired)).headers.get('Location'), `${ORIGIN}/?auth_error=state_invalid`);
  assert.equal(f.calls.length, callCount);
  const closed = await f.begin('google');
  f.db.sqlite.prepare("INSERT INTO privacy_account_controls(account_id,state,updated_at) VALUES (?,'withdrawn',?)").run(account, Date.now());
  assert.equal((await f.callback(closed)).headers.get('Location'), `${ORIGIN}/?auth_error=account_unavailable`);
  assert.equal(f.db.rows('SELECT * FROM auth_sessions').length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
});

test('missing configuration and cross-origin writes cannot initiate provider calls', async t => {
  const f = fixture(t);
  delete f.env.HARU_KAKAO_OIDC_ENABLED;
  delete f.env.HARU_GOOGLE_CLIENT_SECRET;
  const status = await (await f.call('/api/auth/status')).json();
  assert.equal(status.providers.find(provider => provider.id === 'google').enabled, false);
  assert.equal(status.providers.find(provider => provider.id === 'kakao').enabled, false);
  for (const id of ['google', 'kakao']) {
    assert.equal((await f.call(`/api/auth/${id}/start`, { method: 'POST', body: { intent: 'login' } })).status, 503);
  }
  assert.equal((await f.call('/api/auth/naver/start', { method: 'POST', body: { intent: 'login' },
    headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal(f.calls.length, 0); assert.equal(f.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
  delete f.env.DB;
  assert.equal((await f.call('/api/auth/status')).status, 503);
  assert.equal((await f.call('/api/health')).status, 503);
});


test('connected accounts retain privacy authority and cannot write another account game state', async t => {
  const f = fixture(t);
  f.seed('google', 'first-subject', 'first-account');
  f.seed('google', 'second-subject', 'second-account');
  const first = await f.login('google', { subject: 'first-subject', authTime: true });
  const second = await f.login('google', { subject: 'second-subject', authTime: true });
  const a = await (await f.call('/api/game/bootstrap', { cookie: first.cookie })).json();
  const b = await (await f.call('/api/game/bootstrap', { cookie: second.cookie })).json();
  assert.notEqual(a.state.playerId, b.state.playerId);
  const mismatch = await f.call('/api/game/rename', { method: 'POST', cookie: first.cookie,
    headers: { 'X-Haru-Player': b.state.playerId }, body: { name: '허용안됨', requestId: 'mismatched-owner-01' } });
  assert.equal(mismatch.status, 409);
  const privacyResponse = await f.call('/api/privacy/status', { cookie: first.cookie });
  assert.equal(privacyResponse.status, 200);
  const status = await privacyResponse.json();
  assert.equal(status.playerId, a.state.playerId);
  assert.equal(status.capabilities.selfClosure, false);
  const before = f.db.rows('SELECT * FROM game_players ORDER BY id');
  const headers = { 'X-Haru-Account': status.accountContext };
  const exported = await f.call('/api/privacy/export', { method: 'POST', cookie: first.cookie, headers, body: {} });
  assert.equal(exported.status, 200);
  const blocked = await f.call('/api/privacy/delete', { method: 'POST', cookie: first.cookie,
    headers, body: { confirmation: 'delete' } });
  assert.equal(blocked.status, 403);
  assert.equal((await blocked.json()).code, 'SELF_CLOSURE_NOT_READY');
  assert.deepEqual(f.db.rows('SELECT * FROM game_players ORDER BY id'), before);
  assert.equal((await f.call('/api/game/bootstrap', { cookie: first.cookie })).status, 200);
});
