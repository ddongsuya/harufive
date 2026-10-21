import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { AUTH_COOKIES, AUTH_LIMITS, handleAuthRequest, resolveGameIdentity } from '../server/auth-service.mjs';
import { createGameService } from '../server/game-service.mjs';

const ORIGIN = 'https://local-signup.example.test';
const CLOCK = Date.now();
const PASSWORD = 'a long fixture password 2026';
const CONSENT = Object.freeze({ ageConfirmed: true, policyAccepted: true, policyVersion: 'preview-2026-10-21' });
const DEFAULT = Object.freeze({ username: 'fixture_user', password: PASSWORD, nickname: '시험 토끼', ...CONSENT });
const HASH = value => `scrypt-v1$65536$8$2$${'c'.repeat(32)}$${createHash('sha256').update(value).digest('hex')}`;
const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const jwk = { ...await exportJWK(pair.publicKey), kid: 'local-signup-fixture', alg: 'RS256', use: 'sig' };

function request(path, { method = 'GET', cookie = '', body, headers = {} } = {}) {
  return new Request(ORIGIN + path, { method,
    headers: { ...(cookie ? { Cookie: cookie } : {}),
      ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function cookies(response, previous = '') {
  const jar = new Map(previous.split(';').map(item => item.trim()).filter(Boolean).map(item => item.split('=')));
  for (const item of response.headers.getSetCookie()) {
    const [name, value] = item.split(';')[0].split('=');
    if (item.includes('Max-Age=0')) jar.delete(name); else jar.set(name, value);
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function fixture(t, overrides = {}) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let clock = CLOCK, serial = 0;
  db.sqlite.function('unixepoch', (_modifier) => Math.floor(clock / 1000));
  const env = { HARU_AUTH_ORIGIN: ORIGIN, HARU_GOOGLE_CLIENT_ID: 'fixture-google-client', HARU_GOOGLE_CLIENT_SECRET: 'fixture-google-secret' };
  const codes = new Map();
  const f = { db, env, hashCalls: [], providerCalls: [], pause: null, now: () => clock, setTime(value) { clock = value; } };
  const passwordService = {
    async hash(password) {
      f.hashCalls.push({ action: 'hash', password });
      if (f.pause) { f.pause.entered.resolve(); await f.pause.release.promise; }
      return HASH(password);
    },
    async verify(password, encodedHash) {
      f.hashCalls.push({ action: 'verify', password, encodedHash });
      if (f.pause) { f.pause.entered.resolve(); await f.pause.release.promise; }
      return encodedHash === HASH(password);
    },
  };
  const fetcher = async (url, init) => {
    f.providerCalls.push(url);
    assert.equal(init.redirect, 'manual');
    if (url === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [jwk] });
    assert.equal(url, 'https://oauth2.googleapis.com/token');
    const body = new URLSearchParams(init.body), flow = codes.get(body.get('code'));
    assert.ok(flow); assert.equal(flow.used, false); flow.used = true;
    assert.equal(body.get('client_id'), env.HARU_GOOGLE_CLIENT_ID);
    assert.equal(body.get('client_secret'), env.HARU_GOOGLE_CLIENT_SECRET);
    assert.equal(body.get('redirect_uri'), `${ORIGIN}/api/auth/google/callback`);
    assert.equal(createHash('sha256').update(body.get('code_verifier')).digest('base64url'), flow.challenge);
    if (f.providerPause) { f.providerPause.entered.resolve(); await f.providerPause.release.promise; }
    const seconds = Math.floor(clock / 1000);
    const claims = { iss: 'https://accounts.google.com', aud: env.HARU_GOOGLE_CLIENT_ID, sub: flow.subject,
      nonce: flow.nonce, iat: seconds, exp: seconds + 300, email: 'do-not-store@gmail.com', email_verified: true, ...flow.claims };
    for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
    let token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(pair.privateKey);
    if (flow.tamper) token = `${token.slice(0, -12)}XXXXXXXXXXXX`;
    return Response.json({ id_token: token, access_token: 'private-provider-token-not-stored' });
  };
  f.options = { db, env, now: f.now, fetch: fetcher, sitesEnabled: false, loginEnabled: true,
    previewRegistration: true, passwordService, clientAddressHash: 'a'.repeat(64), ...overrides };
  f.invoke = (action, req, extra = {}) => handleAuthRequest(req, { ...f.options, action, ...extra });
  f.statusResponse = (cookie = '', extra = {}) => f.invoke('status', request('/api/auth/status', { cookie }), extra);
  f.status = async (cookie = '', extra = {}) => (await f.statusResponse(cookie, extra)).json();
  f.prepare = async (cookie = '') => {
    const response = await f.statusResponse(cookie);
    assert.equal(response.status, 200, await response.clone().text());
    return cookies(response, cookie);
  };
  f.register = (cookie, body = DEFAULT, extra = {}, headers = {}) => f.invoke('local-register', request('/api/auth/local/register', {
    method: 'POST', cookie, body, headers,
  }), extra);
  f.login = (cookie, body = { username: DEFAULT.username, password: PASSWORD }, extra = {}, headers = {}) => f.invoke('local-login', request('/api/auth/local/login', {
    method: 'POST', cookie, body, headers,
  }), extra);
  f.identity = cookie => resolveGameIdentity(request('/', { cookie }), f.options);
  f.logout = cookie => f.invoke('logout', request('/api/auth/logout', { method: 'POST', cookie, body: {} }));
  f.signup = async (body = DEFAULT) => {
    const before = await f.prepare(), response = await f.register(before, body);
    assert.equal(response.status, 200, await response.clone().text());
    assert.deepEqual(await response.clone().json(), { authenticated: true });
    return { response, cookie: cookies(response, before), before };
  };
  f.beginGoogle = async ({ subject = 'google-subject', claims = {}, tamper = false, signup = CONSENT, cookie = '' } = {}) => {
    const response = await f.invoke('start', request('/api/auth/google/start', { method: 'POST', cookie,
      body: { intent: 'login', ...(signup === false ? {} : { signup }) } }), { provider: 'google' });
    assert.equal(response.status, 200, await response.clone().text());
    const url = new URL((await response.json()).url);
    const flow = { subject, claims, tamper, cookie: cookies(response, cookie), code: `google-signup-${++serial}`,
      state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), used: false };
    codes.set(flow.code, flow); return flow;
  };
  f.callback = flow => f.invoke('callback', request(`/api/auth/google/callback?${new URLSearchParams({ code: flow.code, state: flow.state })}`, {
    cookie: flow.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' },
  }), { provider: 'google' });
  return f;
}

function assertNoAccounts(f) {
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions', 'game_players', 'auth_local_credentials', 'auth_registration_consents']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 0, table);
  }
}

test('private signup status issues a stable HttpOnly binding without declaring verified age or public admission', async t => {
  const f = fixture(t), response = await f.statusResponse(), cookie = cookies(response);
  assert.match(cookie, /__Host-haru_oauth=[A-Za-z0-9_-]{43}/);
  assert.ok(response.headers.getSetCookie().every(value => value.includes('Secure') && value.includes('HttpOnly') && value.includes('SameSite=Lax')));
  const status = await response.json();
  assert.deepEqual(status.localAuth, { enabled: true, registrationOpen: true });
  assert.equal(status.registration.previewOpen, true);
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.ageVerificationReady, false);
  assert.equal(status.registration.under14EnrollmentOpen, false);
  assert.equal(status.registration.minimumSignupAge, 14);
  assert.equal(await f.prepare(cookie), cookie, 'Repeated status cannot rotate another pending request binding');
  assertNoAccounts(f);
});

test('direct signup creates one account, nickname, consent and opaque local session atomically', async t => {
  const f = fixture(t), signed = await f.signup({ ...DEFAULT, nickname: '  시험   토끼  ' });
  const identity = await f.identity(signed.cookie);
  assert.equal(identity.provider, 'local'); assert.deepEqual(identity.linkedProviders, ['local']);
  for (const table of ['auth_accounts', 'auth_sessions', 'game_players', 'auth_local_credentials', 'auth_registration_consents']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 1, table);
  }
  assert.equal(f.db.rows('SELECT * FROM auth_identities').length, 0, 'A password credential is not a fabricated social identity');
  const credential = f.db.rows('SELECT * FROM auth_local_credentials')[0];
  assert.equal(credential.username, DEFAULT.username); assert.equal(credential.account_id, identity.userId);
  assert.equal(credential.password_hash, HASH(PASSWORD));
  const consent = f.db.rows('SELECT * FROM auth_registration_consents')[0];
  assert.equal(consent.account_id, identity.userId); assert.equal(consent.policy_version, CONSENT.policyVersion);
  assert.equal(consent.self_declared_14, 1); assert.equal(consent.accepted_at, f.now());
  const game = createGameService({ db: f.db, now: f.now });
  const boot = await game.bootstrap(identity.userId);
  assert.equal(boot.state.name, '시험 토끼');
  assert.deepEqual(boot.state.owned.filter(value => value.startsWith('character-')), ['character-rabbit']);
  const status = await f.status(signed.cookie);
  assert.equal(status.authenticated, true); assert.equal(status.account.provider, 'local');
  assert.deepEqual(status.account.linkedProviders, ['local']);
  assert.equal(status.localAuth.registrationOpen, false);
  const json = JSON.stringify(status);
  for (const privateValue of [DEFAULT.username, PASSWORD, credential.password_hash, credential.account_id]) assert.ok(!json.includes(privateValue));
  const token = signed.cookie.match(/__Host-haru_session=([^;]+)/)[1];
  const stored = JSON.stringify(f.db.rows('SELECT * FROM auth_sessions'));
  assert.ok(!stored.includes(token)); assert.ok(!stored.includes(PASSWORD));
  assert.equal(f.providerCalls.length, 0);
});

test('local login restores the same player and saved answer after logout', async t => {
  const f = fixture(t), signed = await f.signup(), identity = await f.identity(signed.cookie);
  const game = createGameService({ db: f.db, now: f.now });
  let current = await game.start(identity.userId, { mode: 'daily', requestId: 'local-start-00001' });
  if (current.state.active.phase === 'ready') current = await game.memory(identity.userId, {
    attemptId: current.state.active.id, questionId: current.state.active.currentQuestionId, requestId: 'local-memory-00001',
  });
  if (current.state.active.phase === 'memorizing') { f.setTime(current.state.active.memoryUntil); current = await game.bootstrap(identity.userId); }
  f.setTime(Math.max(f.now(), current.state.active.issuedAt + 1250));
  const saved = await game.answer(identity.userId, { attemptId: current.state.active.id, questionId: current.state.active.currentQuestionId,
    index: current.state.active.index, selected: 0, requestId: 'local-answer-00001' });
  const out = await f.logout(signed.cookie);
  assert.equal(out.status, 200); assert.equal(await f.identity(signed.cookie), null);
  const before = await f.prepare(cookies(out, signed.cookie)), response = await f.login(before);
  assert.equal(response.status, 200, await response.clone().text());
  const again = await f.identity(cookies(response, before));
  assert.equal(again.userId, identity.userId);
  const restored = await game.bootstrap(again.userId);
  assert.equal(restored.state.active.id, saved.state.active.id); assert.equal(restored.state.active.index, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
});

test('direct signup is fail closed without every trusted server capability', async t => {
  for (const options of [{ previewRegistration: false }, { previewRegistration: 'true' }, { loginEnabled: false },
    { passwordService: null }, { passwordService: {} }, { clientAddressHash: null }, { clientAddressHash: 'client-supplied-address' }]) {
    await t.test(JSON.stringify(options), async t => {
      const f = fixture(t, options), status = await f.status();
      assert.equal(status.localAuth.enabled, false);
      const response = await f.register('');
      assert.notEqual(response.status, 200); assert.equal(f.hashCalls.length, 0); assertNoAccounts(f);
    });
  }
});

test('request fields, headers and environment cannot enable direct signup', async t => {
  const f = fixture(t, { previewRegistration: false });
  f.options.env = { ...f.env, HARU_REGISTRATION_OPEN: 'true', HARU_PREVIEW_REGISTRATION: 'true', HARU_AGE_VERIFIED: 'true' };
  const response = await f.register('', { ...DEFAULT, previewRegistration: true, clientAddressHash: 'a'.repeat(64), ageVerified: true }, {}, { 'X-Haru-Preview-Registration': 'true' });
  assert.notEqual(response.status, 200); assertNoAccounts(f); assert.equal(f.hashCalls.length, 0);
});

test('local requests require same origin, JSON, stable browser binding and POST', async t => {
  const f = fixture(t), cookie = await f.prepare();
  for (const action of ['register', 'login']) {
    const body = action === 'register' ? DEFAULT : { username: DEFAULT.username, password: PASSWORD };
    for (const headers of [{ Origin: 'https://attacker.invalid' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
      const response = await f[action](cookie, body, {}, headers); assert.equal(response.status, 403);
    }
    const wrongType = await f[action](cookie, body, {}, { 'Content-Type': 'text/plain' }); assert.equal(wrongType.status, 415);
    const noBinding = await f[action]('', body); assert.notEqual(noBinding.status, 200);
    const wrongMethod = await f.invoke(`local-${action}`, request(`/api/auth/local/${action}`, { cookie })); assert.equal(wrongMethod.status, 405);
  }
  assert.equal(f.hashCalls.length, 0); assertNoAccounts(f);
});

test('signup validates username, nickname and explicit current consent before hashing', async t => {
  const cases = [
    { username: 'abc' }, { username: 'a'.repeat(25) }, { username: 'UPPER' }, { username: '한글아이디' }, { username: 'has space' }, { username: 'valid\n' },
    { nickname: 'a' }, { nickname: '<script>' }, { nickname: '가'.repeat(13) },
    { ageConfirmed: false }, { ageConfirmed: 'true' }, { policyAccepted: false }, { policyAccepted: 1 },
    { policyVersion: 'old-policy' }, { policyVersion: null }, { password: 'short password' }, { password: 'a'.repeat(129) },
  ];
  for (const body of cases) await t.test(Object.keys(body)[0] + ':' + String(Object.values(body)[0]), async t => {
    const f = fixture(t), cookie = await f.prepare(), response = await f.register(cookie, { ...DEFAULT, ...body });
    assert.equal(response.status, 400, await response.clone().text()); assert.equal(f.hashCalls.length, 0); assertNoAccounts(f);
  });
});

test('password boundaries and literal spaces are preserved', async t => {
  for (const password of [' '.repeat(15), 'a'.repeat(15), 'a'.repeat(128), '🙂'.repeat(64), '  password with spaces  ']) {
    await t.test(String(password.length), async t => {
      const f = fixture(t), signed = await f.signup({ ...DEFAULT, password });
      assert.equal(f.hashCalls[0].password, password);
      const out = await f.logout(signed.cookie), cookie = await f.prepare(cookies(out, signed.cookie));
      const response = await f.login(cookie, { username: DEFAULT.username, password });
      assert.equal(response.status, 200, await response.clone().text());
      assert.equal(f.hashCalls.at(-1).password, password);
    });
  }
});

test('wrong password and absent username give the same generic failure and both verify a hash', async t => {
  const f = fixture(t); await f.signup();
  const cookie = await f.prepare();
  const wrong = await f.login(cookie, { username: DEFAULT.username, password: 'incorrect long password' });
  const absent = await f.login(cookie, { username: 'missing_user', password: 'incorrect long password' });
  assert.equal(wrong.status, 401); assert.equal(absent.status, 401);
  assert.deepEqual(await wrong.json(), await absent.json());
  assert.equal(f.hashCalls.filter(item => item.action === 'verify').length, 2);
  assert.equal(f.db.rows('SELECT * FROM auth_sessions').length, 1);
  assert.ok(!wrong.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`)));
});

test('disabled and privacy-blocked accounts cannot log in with a valid password', async t => {
  for (const blocked of ['disabled', 'privacy']) await t.test(blocked, async t => {
    const f = fixture(t), signed = await f.signup(), identity = await f.identity(signed.cookie);
    if (blocked === 'disabled') f.db.sqlite.prepare('UPDATE auth_accounts SET disabled_at = ? WHERE id = ?').run(f.now(), identity.userId);
    else f.db.sqlite.prepare("INSERT INTO privacy_account_controls(account_id,state,updated_at) VALUES(?,'deletion_pending',?)").run(identity.userId, f.now());
    assert.equal(await f.identity(signed.cookie), null);
    const response = await f.login(await f.prepare());
    assert.equal(response.status, 401, await response.clone().text());
    assert.equal(f.db.rows('SELECT * FROM auth_sessions').length, 1);
  });
});

test('expired and revoked local sessions do not resolve an identity', async t => {
  const f = fixture(t), signed = await f.signup();
  f.setTime(CLOCK + AUTH_LIMITS.sessionMs + 1);
  assert.equal(await f.identity(signed.cookie), null);
  f.setTime(CLOCK);
  f.db.sqlite.prepare('UPDATE auth_sessions SET revoked_at = ?').run(CLOCK);
  assert.equal(await f.identity(signed.cookie), null);
});

test('concurrent duplicate usernames cannot leave a second account or player', async t => {
  const f = fixture(t), first = await f.prepare(), second = await f.prepare();
  const responses = await Promise.all([f.register(first), f.register(second)]);
  assert.equal(responses.filter(response => response.status === 200).length, 1);
  for (const table of ['auth_accounts', 'auth_local_credentials', 'game_players', 'auth_registration_consents', 'auth_sessions']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 1, table);
  }
});

test('partial signup failures roll back credentials, account, consent, player and session', async t => {
  for (const table of ['auth_local_credentials', 'game_players', 'auth_registration_consents', 'auth_sessions']) await t.test(table, async t => {
    const f = fixture(t), cookie = await f.prepare();
    f.db.sqlite.exec(`CREATE TRIGGER fixture_fail_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'fixture transaction failure'); END`);
    const response = await f.register(cookie);
    assert.notEqual(response.status, 200); assertNoAccounts(f);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`)));
  });
});

test('logout during hashing cancels direct registration and prevents late session issuance', async t => {
  const f = fixture(t), cookie = await f.prepare();
  f.pause = { entered: deferred(), release: deferred() };
  const pending = f.register(cookie); await f.pause.entered.promise;
  assert.equal((await f.logout(cookie)).status, 200);
  f.pause.release.resolve();
  const response = await pending;
  assert.notEqual(response.status, 200); assertNoAccounts(f);
  assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`)));
});

test('logout during password verification prevents a late authenticated session', async t => {
  const f = fixture(t), signed = await f.signup(), out = await f.logout(signed.cookie), cookie = await f.prepare(cookies(out, signed.cookie));
  f.pause = { entered: deferred(), release: deferred() };
  const pending = f.login(cookie); await f.pause.entered.promise;
  await f.logout(cookie); f.pause.release.resolve();
  const response = await pending;
  assert.notEqual(response.status, 200);
  assert.ok(f.db.rows('SELECT * FROM auth_sessions').every(row => row.revoked_at !== null));
});

test('a pending signup that expires during hashing cannot commit', async t => {
  const f = fixture(t), cookie = await f.prepare();
  f.pause = { entered: deferred(), release: deferred() };
  const pending = f.register(cookie); await f.pause.entered.promise;
  f.setTime(CLOCK + 121000); f.pause.release.resolve();
  const response = await pending;
  assert.notEqual(response.status, 200); assertNoAccounts(f);
});

test('per-client or per-username rate limits stop repeated hashing and return Retry-After', async t => {
  const f = fixture(t), cookie = await f.prepare();
  let limited;
  for (let index = 0; index < 101; index++) {
    const response = await f.login(cookie, { username: 'missing_user', password: PASSWORD });
    if (response.status === 429) { limited = response; break; }
    assert.equal(response.status, 401, await response.clone().text());
  }
  assert.ok(limited, 'Repeated attempts must become rate limited before 100 hashes');
  assert.ok(Number(limited.headers.get('Retry-After')) > 0);
  const count = f.hashCalls.length;
  assert.equal((await f.login(cookie, { username: 'missing_user', password: PASSWORD })).status, 429);
  assert.equal(f.hashCalls.length, count);
  assertNoAccounts(f);
});

test('Google registration requires explicit stored consent and a verified provider identity', async t => {
  const f = fixture(t), flow = await f.beginGoogle(), response = await f.callback(flow);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  const identity = await f.identity(cookies(response, flow.cookie));
  assert.equal(identity.provider, 'google');
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions', 'game_players', 'auth_registration_consents']) assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 1, table);
  assert.equal(f.db.rows('SELECT * FROM auth_local_credentials').length, 0);
  const consent = f.db.rows('SELECT * FROM auth_registration_consents')[0];
  assert.equal(consent.policy_version, CONSENT.policyVersion); assert.equal(consent.self_declared_14, 1);
  const stored = JSON.stringify(['auth_accounts', 'auth_identities', 'auth_sessions', 'game_players', 'auth_registration_consents'].map(table => f.db.rows(`SELECT * FROM ${table}`)));
  assert.ok(!stored.includes('do-not-store@gmail.com')); assert.ok(!stored.includes('private-provider-token-not-stored'));
  assert.equal(f.hashCalls.length, 0);
});

test('unknown Google login without signup confirmation redirects to the signup form', async t => {
  const f = fixture(t), flow = await f.beginGoogle({ signup: false }), response = await f.callback(flow);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_required`);
  assertNoAccounts(f);
});

test('Google signup does not accept bad signatures, nonce, audience or issuer', async t => {
  for (const args of [{ tamper: true }, { claims: { nonce: 'wrong' } }, { claims: { aud: 'other-client' } }, { claims: { iss: 'https://attacker.invalid' } }]) {
    await t.test(JSON.stringify(args), async t => {
      const f = fixture(t), flow = await f.beginGoogle(args), response = await f.callback(flow);
      assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=verification_failed`); assertNoAccounts(f);
    });
  }
});

test('equal Google emails never merge distinct signed provider subjects', async t => {
  const f = fixture(t), first = await f.beginGoogle({ subject: 'subject-a' }), second = await f.beginGoogle({ subject: 'subject-b' });
  const responses = await Promise.all([f.callback(first), f.callback(second)]);
  for (const response of responses) assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 2);
  assert.equal(new Set(f.db.rows('SELECT * FROM auth_identities').map(row => row.account_id)).size, 2);
});

test('Google signup rejects missing, stale, extra and nonboolean confirmation fields before contacting Google', async t => {
  for (const signup of [null, {}, { ...CONSENT, ageConfirmed: false }, { ...CONSENT, policyAccepted: 'true' },
    { ...CONSENT, policyVersion: 'old-version' }, { ...CONSENT, ageVerified: true }]) {
    await t.test(JSON.stringify(signup), async t => {
      const f = fixture(t), response = await f.invoke('start', request('/api/auth/google/start', {
        method: 'POST', body: { intent: 'login', signup },
      }), { provider: 'google' });
      assert.equal(response.status, 400); assert.equal(f.providerCalls.length, 0); assertNoAccounts(f);
      assert.equal(f.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
    });
  }
});

test('existing Google identity can log in again without repeating signup confirmation', async t => {
  const f = fixture(t), first = await f.beginGoogle(), registered = await f.callback(first);
  const oldCookie = cookies(registered, first.cookie), identity = await f.identity(oldCookie);
  const out = await f.logout(oldCookie);
  const second = await f.beginGoogle({ signup: false, cookie: cookies(out, oldCookie) }), response = await f.callback(second);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal((await f.identity(cookies(response, second.cookie))).userId, identity.userId);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_registration_consents').length, 1);
});

test('logout during Google signup exchange cancels the pending creation', async t => {
  const f = fixture(t), flow = await f.beginGoogle();
  f.providerPause = { entered: deferred(), release: deferred() };
  const pending = f.callback(flow); await f.providerPause.entered.promise;
  await f.logout(flow.cookie); f.providerPause.release.resolve();
  const response = await pending;
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`); assertNoAccounts(f);
});

test('a newer Google flow cancels local registration still hashing in another tab', async t => {
  const f = fixture(t), cookie = await f.prepare();
  f.pause = { entered: deferred(), release: deferred() };
  const pending = f.register(cookie); await f.pause.entered.promise;
  const google = await f.beginGoogle({ cookie });
  f.pause.release.resolve();
  assert.notEqual((await pending).status, 200); assertNoAccounts(f);
  assert.equal((await f.callback(google)).headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_local_credentials').length, 0);
});

test('a local attempt cancels an older Google callback during provider exchange', async t => {
  const f = fixture(t), flow = await f.beginGoogle();
  f.providerPause = { entered: deferred(), release: deferred() };
  const pending = f.callback(flow); await f.providerPause.entered.promise;
  const local = await f.register(flow.cookie);
  assert.equal(local.status, 200, await local.clone().text());
  f.providerPause.release.resolve();
  const google = await pending;
  assert.notEqual(google.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_local_credentials').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_identities').length, 0);
});

test('credential changes or account disablement during password verification cannot authorize a session', async t => {
  for (const mutation of ['password', 'disable']) await t.test(mutation, async t => {
    const f = fixture(t), signed = await f.signup(), out = await f.logout(signed.cookie), cookie = await f.prepare(cookies(out, signed.cookie));
    f.pause = { entered: deferred(), release: deferred() };
    const pending = f.login(cookie); await f.pause.entered.promise;
    if (mutation === 'password') f.db.sqlite.prepare('UPDATE auth_local_credentials SET password_hash=?').run(HASH('the new longer password'));
    else f.db.sqlite.prepare('UPDATE auth_accounts SET disabled_at=?').run(f.now());
    f.pause.release.resolve();
    const response = await pending;
    assert.notEqual(response.status, 200);
    assert.ok(f.db.rows('SELECT * FROM auth_sessions').every(row => row.revoked_at !== null));
  });
});

test('hash service failure fails closed without persisting credentials or issuing a cookie', async t => {
  for (const result of ['throw', 'plaintext']) await t.test(result, async t => {
    const f = fixture(t), cookie = await f.prepare();
    f.options.passwordService = { async hash() { if (result === 'throw') throw new Error('internal fixture failure'); return PASSWORD; }, async verify() { throw new Error('internal fixture failure'); } };
    const response = await f.register(cookie);
    assert.equal(response.status, 503); assertNoAccounts(f);
    assert.doesNotMatch(await response.text(), /internal fixture failure|a long fixture password/);
  });
});

test('a seventh local login keeps the account session cap and its newly issued session usable', async t => {
  const f = fixture(t), signed = await f.signup(), account = await f.identity(signed.cookie);
  let latest;
  for (let index = 0; index < 7; index++) {
    f.setTime(CLOCK + index + 1);
    const cookie = await f.prepare(), response = await f.login(cookie);
    assert.equal(response.status, 200, await response.clone().text());
    latest = cookies(response, cookie);
    assert.equal((await f.identity(latest)).userId, account.userId);
    assert.ok(f.db.rows('SELECT * FROM auth_sessions WHERE account_id=?', account.userId).length <= AUTH_LIMITS.sessionsPerAccount);
  }
  assert.equal(f.db.rows('SELECT * FROM auth_sessions WHERE account_id=?', account.userId).length, AUTH_LIMITS.sessionsPerAccount);
  assert.equal(await f.identity(signed.cookie), null);
  assert.equal((await f.identity(latest)).provider, 'local');
});

test('consent timestamp records the initial acknowledgement before asynchronous hashing or Google exchange', async t => {
  for (const kind of ['local', 'google']) await t.test(kind, async t => {
    const f = fixture(t);
    const pause = { entered: deferred(), release: deferred() };
    let pending;
    if (kind === 'local') {
      const cookie = await f.prepare(); f.pause = pause; pending = f.register(cookie);
    } else {
      const flow = await f.beginGoogle(); f.providerPause = pause; pending = f.callback(flow);
    }
    await pause.entered.promise; f.setTime(CLOCK + 5000); pause.release.resolve();
    const response = await pending;
    assert.ok([200, 303].includes(response.status));
    const consent = f.db.rows('SELECT * FROM auth_registration_consents')[0];
    assert.equal(consent.accepted_at, CLOCK);
  });
});

test('migration 0006 preserves all existing social sessions and OAuth flows without inventing signup consent', t => {
  const db = new DatabaseSync(':memory:'); t.after(() => db.close());
  db.exec('PRAGMA foreign_keys=ON');
  const directory = new URL('../drizzle/', import.meta.url);
  const files = readdirSync(directory).filter(name => name.endsWith('.sql')).sort();
  assert.equal(files.length, 7);
  for (const file of files.slice(0, 6)) db.exec(readFileSync(new URL(file, directory), 'utf8'));
  db.prepare('INSERT INTO auth_accounts(id,created_at) VALUES(?,?)').run('previous-player', CLOCK);
  for (const [index, provider] of ['google', 'kakao', 'naver'].entries()) {
    db.prepare(`INSERT INTO auth_sessions(token_hash,binding_hash,authenticated_at,account_id,provider,created_at,expires_at,revoked_at)
      VALUES(?,?,?,?,?,?,?,?)`).run(String(index).repeat(64), String(index + 1).repeat(64), index ? CLOCK - 1000 : null,
      'previous-player', provider, CLOCK, CLOCK + 60000, index === 2 ? CLOCK + 1 : null);
    db.prepare(`INSERT INTO auth_oauth_transactions(state_hash,binding_hash,provider,audience,intent,account_id,context_hash,nonce_hash,code_verifier,claim_token,created_at,expires_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(`state-${index}`, 'binding-hash', provider, `${provider}-client`, index ? 'link' : 'login',
      index ? 'previous-player' : null, 'context-hash', 'nonce-hash', 'old-verifier', index === 2 ? 'old-claim' : null, CLOCK, CLOCK + 60000);
  }
  const rows = table => db.prepare(`SELECT * FROM ${table} ORDER BY 1`).all().map(row => ({ ...row }));
  const previousSessions = rows('auth_sessions'), previousFlows = rows('auth_oauth_transactions');
  db.exec('BEGIN IMMEDIATE');
  try { db.exec(readFileSync(new URL(files[6], directory), 'utf8')); db.exec('COMMIT'); }
  catch (error) { db.exec('ROLLBACK'); throw error; }
  assert.deepEqual(rows('auth_sessions'), previousSessions);
  assert.deepEqual(rows('auth_oauth_transactions'), previousFlows.map(row => ({ ...row, signup_policy_version: null, signup_confirmed_at: null })));
  assert.equal(rows('auth_registration_consents').length, 0);
  assert.equal(rows('auth_local_credentials').length, 0);
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  for (const index of ['auth_sessions_account_index', 'auth_sessions_expiry_index', 'auth_sessions_binding_index', 'auth_oauth_transactions_expiry_index']) {
    assert.ok(db.prepare("SELECT name FROM sqlite_schema WHERE type='index' AND name=?").get(index), index);
  }
});

test('revoking the private signup capability before Google callback prevents new account creation', async t => {
  const f = fixture(t), flow = await f.beginGoogle();
  f.options.previewRegistration = false;
  const response = await f.callback(flow);
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assertNoAccounts(f);
});

test('Google signup rechecks the DB clock at the atomic account insertion boundary', async t => {
  const f = fixture(t), flow = await f.beginGoogle();
  let reached = false;
  f.db.beforeBatch = async statements => {
    if (!statements.some(statement => /INSERT(?: OR IGNORE)? INTO auth_accounts/i.test(statement.sql))) return;
    reached = true; f.db.beforeBatch = null;
    f.setTime(CLOCK + AUTH_LIMITS.flowMs + 1000);
  };
  const response = await f.callback(flow);
  assert.equal(reached, true);
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assertNoAccounts(f);
});

test('concurrent Google registrations for one subject never split its identity or initial economy', async t => {
  const f = fixture(t), first = await f.beginGoogle(), second = await f.beginGoogle();
  const responses = await Promise.all([f.callback(first), f.callback(second)]);
  assert.ok(responses.some(response => response.headers.get('Location') === `${ORIGIN}/?auth=success`));
  for (const table of ['auth_accounts', 'auth_identities', 'game_players', 'auth_registration_consents', 'game_coin_ledger']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 1, table);
  }
});
