import test from 'node:test';
import assert from 'node:assert/strict';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { AUTH_COOKIES, AUTH_LIMITS, handleAuthRequest, resolveGameIdentity } from '../server/auth-service.mjs';
import { createGameService } from '../server/game-service.mjs';

const ORIGIN = 'https://preview-owner.example.test';
const CLOCK = Date.now();
const OWNER = 'owner@gmail.com';
const ENROLLMENT = Object.freeze({ email: OWNER, notBefore: CLOCK });
const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const jwk = { ...await exportJWK(pair.publicKey), kid: 'preview-owner-fixture', alg: 'RS256', use: 'sig' };
const PROVIDERS = {
  google: { issuer: 'https://accounts.google.com', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  kakao: { issuer: 'https://kauth.kakao.com', token: 'https://kauth.kakao.com/oauth/token', jwks: 'https://kauth.kakao.com/.well-known/jwks.json' },
  naver: { issuer: 'https://nid.naver.com', token: 'https://nid.naver.com/oauth2/token', jwks: 'https://nid.naver.com/oauth2/jwks' },
};

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

function fixture(t, { previewOwnerEnrollment = ENROLLMENT, env = {}, options = {} } = {}) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let clock = CLOCK, serial = 0;
  db.sqlite.function('unixepoch', (_modifier) => Math.floor(clock / 1000));
  const settings = { HARU_AUTH_ORIGIN: ORIGIN, HARU_KAKAO_OIDC_ENABLED: 'true', ...env };
  for (const id of Object.keys(PROVIDERS)) {
    settings[`HARU_${id.toUpperCase()}_CLIENT_ID`] ??= `fixture-${id}-client`;
    settings[`HARU_${id.toUpperCase()}_CLIENT_SECRET`] ??= `fixture-${id}-secret`;
  }
  const codes = new Map(), calls = [];
  const f = { db, env: settings, calls, pause: null, now: () => clock, setTime(value) { clock = value; } };
  const fetcher = async (url, init) => {
    calls.push(url);
    const id = Object.keys(PROVIDERS).find(key => [PROVIDERS[key].token, PROVIDERS[key].jwks].includes(url));
    assert.ok(id, 'Only a pinned synthetic provider endpoint may be called');
    assert.equal(init.redirect, 'manual');
    if (url === PROVIDERS[id].jwks) return Response.json({ keys: [jwk] });
    const body = new URLSearchParams(init.body), flow = codes.get(body.get('code'));
    assert.ok(flow, 'Authorization code belongs to this isolated fixture');
    assert.equal(flow.provider, id);
    assert.equal(flow.used, false);
    flow.used = true;
    assert.equal(body.get('client_id'), settings[`HARU_${id.toUpperCase()}_CLIENT_ID`]);
    assert.equal(body.get('client_secret'), settings[`HARU_${id.toUpperCase()}_CLIENT_SECRET`]);
    assert.equal(body.get('redirect_uri'), `${ORIGIN}/api/auth/${id}/callback`);
    const challenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
    assert.equal(challenge, flow.challenge);
    if (f.pause) { f.pause.entered.resolve(); await f.pause.release.promise; }
    const seconds = Math.floor(clock / 1000);
    const claims = { iss: PROVIDERS[id].issuer, aud: settings[`HARU_${id.toUpperCase()}_CLIENT_ID`],
      sub: flow.subject, nonce: flow.nonce, iat: seconds, exp: seconds + 300,
      email: OWNER, email_verified: true, name: 'Discard this private profile', ...flow.claims };
    for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
    let token = await new SignJWT(claims).setProtectedHeader({ alg: 'RS256', kid: jwk.kid }).sign(pair.privateKey);
    if (flow.tamper) token = `${token.slice(0, -12)}XXXXXXXXXXXX`;
    return Response.json({ id_token: token, access_token: 'discard-fixture-access-token', refresh_token: 'discard-fixture-refresh-token' });
  };
  f.options = { db, env: settings, now: f.now, fetch: fetcher, sitesEnabled: false, previewOwnerEnrollment, ...options };
  f.invoke = (action, req, extra = {}) => handleAuthRequest(req, { ...f.options, action, ...extra });
  f.identity = cookie => resolveGameIdentity(request('/', { cookie }), f.options);
  f.status = async (cookie = '', extra = {}) => (await f.invoke('status', request('/api/auth/status', { cookie }), extra)).json();
  f.begin = async ({ provider = 'google', subject = 'owner-subject', claims = {}, tamper = false, cookie = '', body = {}, headers = {} } = {}) => {
    const response = await f.invoke('start', request(`/api/auth/${provider}/start`, {
      method: 'POST', cookie, body: { intent: 'login', ...body }, headers,
    }), { provider });
    assert.equal(response.status, 200, await response.clone().text());
    const url = new URL((await response.json()).url);
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), provider === 'google' ? 'openid email' : 'openid');
    const flow = { provider, subject, claims, tamper, cookie: cookies(response, cookie), code: `owner-code-${++serial}`,
      state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'), challenge: url.searchParams.get('code_challenge'), used: false };
    codes.set(flow.code, flow);
    return flow;
  };
  f.callback = (flow, { query = {}, options = {} } = {}) => f.invoke('callback', request(`/api/auth/${flow.provider}/callback?${new URLSearchParams({ code: flow.code, state: flow.state, ...query })}`, {
    cookie: flow.cookie, headers: { 'Sec-Fetch-Site': 'cross-site' },
  }), { provider: flow.provider, ...options });
  f.login = async (args = {}) => {
    const flow = await f.begin(args), response = await f.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
    return { flow, response, cookie: cookies(response, flow.cookie) };
  };
  f.logout = cookie => f.invoke('logout', request('/api/auth/logout', { method: 'POST', cookie, body: {} }));
  f.seed = ({ account = 'previous-account', provider = 'google', subject = 'previous-subject', audience = settings[`HARU_${provider.toUpperCase()}_CLIENT_ID`] } = {}) => {
    db.sqlite.prepare('INSERT INTO auth_accounts(id,created_at) VALUES (?,?)').run(account, clock);
    db.sqlite.prepare('INSERT INTO auth_identities(id,account_id,provider,issuer,audience,subject,linked_at) VALUES (?,?,?,?,?,?,?)')
      .run(crypto.randomUUID(), account, provider, PROVIDERS[provider].issuer, audience, subject, clock);
    return account;
  };
  return f;
}

function assertEmpty(f) {
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions', 'game_players']) {
    assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 0, table);
  }
}

async function assertClosed(f, args = {}, callbackOptions = {}) {
  const flow = await f.begin(args), response = await f.callback(flow, callbackOptions);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
  assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`) && !value.includes('Max-Age=0')));
  assertEmpty(f);
}

test('trusted owner preview status is a one-account exception and never opens public age admission', async t => {
  const f = fixture(t);
  const status = await f.status();
  assert.deepEqual(status.previewEnrollment, { enabled: true, provider: 'google', accountLimit: 1 });
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.minimumSignupAge, 14);
  assert.equal(status.registration.ageVerificationReady, false);
  assert.equal(status.registration.under14EnrollmentOpen, false);
  assert.equal(status.registration.guardianReady, false);
  assert.ok(!JSON.stringify(status).includes(OWNER), 'Status does not expose the private allowlist');
  assert.equal((await f.status('', { previewOwnerEnrollment: null })).previewEnrollment.enabled, false);
  assert.equal((await f.status('', { loginEnabled: false })).previewEnrollment.enabled, false);
  assert.equal((await f.status('', { env: { ...f.env, HARU_GOOGLE_CLIENT_SECRET: '' } })).previewEnrollment.enabled, false);
  assert.equal((await f.status('', { previewOwnerEnrollment: { email: OWNER, notBefore: CLOCK + 1 } })).previewEnrollment.enabled, false);
  assertEmpty(f);
});

test('a signed fresh allowlisted Google identity receives one opaque owner account without age or profile claims', async t => {
  const f = fixture(t), login = await f.login();
  const identity = await f.identity(login.cookie);
  assert.match(identity.userId, /^preview-owner-[0-9a-f-]{36}$/);
  assert.equal(identity.provider, 'google');
  const accounts = f.db.rows('SELECT * FROM auth_accounts');
  const identities = f.db.rows('SELECT * FROM auth_identities');
  const sessions = f.db.rows('SELECT * FROM auth_sessions');
  assert.equal(accounts.length, 1); assert.equal(identities.length, 1); assert.equal(sessions.length, 1);
  assert.equal(identities[0].account_id, identity.userId);
  assert.equal(identities[0].subject, 'owner-subject');
  assert.equal(sessions[0].authenticated_at, null, 'Ordinary login does not infer recent provider reauthentication');
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0, 'Game initialization still owns profile creation');
  const stored = JSON.stringify({ accounts, identities, sessions });
  for (const value of [OWNER, 'Discard this private profile', 'discard-fixture-access-token', 'discard-fixture-refresh-token']) assert.ok(!stored.includes(value));
  const token = login.cookie.match(/__Host-haru_session=([^;]+)/)[1];
  assert.ok(!stored.includes(token), 'Only the session digest is stored');
  assert.ok(login.response.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`) && value.includes('Secure') && value.includes('HttpOnly') && value.includes('SameSite=Lax')));
  const status = await f.status(login.cookie);
  assert.equal(status.authenticated, true);
  assert.equal(status.previewEnrollment.enabled, false);
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.ageVerificationReady, false);
});

test('owner first login can save an answer, log out, and resume the same game on verified relogin', async t => {
  const f = fixture(t), first = await f.login(), identity = await f.identity(first.cookie);
  const game = createGameService({ db: f.db, now: f.now });
  const boot = await game.bootstrap(identity.userId);
  assert.deepEqual(boot.state.owned.filter(id => id.startsWith('character-')), ['character-rabbit']);
  let current = await game.start(identity.userId, { mode: 'daily', requestId: 'owner-start-00001' });
  if (current.state.active.phase === 'ready') {
    current = await game.memory(identity.userId, { attemptId: current.state.active.id, questionId: current.state.active.currentQuestionId, requestId: 'owner-memory-00001' });
  }
  if (current.state.active.phase === 'memorizing') {
    f.setTime(current.state.active.memoryUntil);
    current = await game.bootstrap(identity.userId);
  }
  f.setTime(Math.max(f.now(), current.state.active.issuedAt + 1250));
  const saved = await game.answer(identity.userId, { attemptId: current.state.active.id,
    questionId: current.state.active.currentQuestionId, index: current.state.active.index, selected: 0, requestId: 'owner-answer-00001' });
  assert.equal(saved.state.active.index, 1);
  const logout = await f.logout(first.cookie);
  assert.equal(logout.status, 200);
  assert.equal(await f.identity(first.cookie), null);
  const second = await f.login({ claims: { email: 'new-email@gmail.com', email_verified: false } });
  const again = await f.identity(second.cookie);
  assert.equal(again.userId, identity.userId, 'Existing signed provider tuple does not depend on matching the enrollment email again');
  const restored = await game.bootstrap(again.userId);
  assert.equal(restored.state.playerId, boot.state.playerId);
  assert.equal(restored.state.active.id, saved.state.active.id);
  assert.equal(restored.state.active.index, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_identities').length, 1);
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 1);
  assert.equal(f.db.rows('SELECT * FROM game_attempts').length, 1);
});

test('only the exact verified Gmail address qualifies, without dot, plus, or domain aliases', async t => {
  const cases = [
    ['other address', { email: 'visitor@gmail.com' }], ['missing email', { email: undefined }],
    ['unverified', { email_verified: false }], ['missing verification', { email_verified: undefined }],
    ['string verification', { email_verified: 'true' }], ['numeric verification', { email_verified: 1 }],
    ['plus alias', { email: 'owner+preview@gmail.com' }], ['dot alias', { email: 'ow.ner@gmail.com' }],
    ['googlemail alias', { email: 'owner@googlemail.com' }], ['other domain', { email: 'owner@example.test' }],
    ['leading space', { email: ' owner@gmail.com' }], ['trailing space', { email: 'owner@gmail.com ' }],
  ];
  for (const [label, claims] of cases) await t.test(label, async t => assertClosed(fixture(t), { claims }));
});

test('verified email from another provider cannot enter the Google owner exception', async t => {
  for (const provider of ['kakao', 'naver']) await t.test(provider, async t => assertClosed(fixture(t), { provider }));
});

test('missing or malformed trusted enrollment stays closed even with verified matching claims', async t => {
  const values = [null, false, true, {}, { email: OWNER }, { email: OWNER, notBefore: '1' },
    { email: OWNER, notBefore: NaN }, { email: OWNER, notBefore: -1 }, { email: OWNER, notBefore: 0 },
    { email: OWNER, notBefore: CLOCK + 0.5 }, { email: OWNER, notBefore: Infinity },
    { email: 'owner@example.test', notBefore: CLOCK }, { email: ` ${OWNER}`, notBefore: CLOCK },
    { ...ENROLLMENT, accountLimit: 20 }, [ENROLLMENT], Object.create(ENROLLMENT)];
  for (const [index, previewOwnerEnrollment] of values.entries()) await t.test(String(index), async t => {
    const f = fixture(t, { previewOwnerEnrollment });
    assert.equal((await f.status()).previewEnrollment.enabled, false);
    await assertClosed(f);
  });
});

test('environment, JSON body, headers, and URL parameters cannot grant the owner exception', async t => {
  const f = fixture(t, { previewOwnerEnrollment: null, env: {
    HARU_PREVIEW_OWNER_EMAIL: OWNER, HARU_PREVIEW_OWNER_NOT_BEFORE: String(CLOCK), HARU_PREVIEW_OWNER_ENROLLMENT: 'true',
    HARU_REGISTRATION_OPEN: 'true', HARU_AGE_VERIFIED: 'true', HARU_SITES_TESTER_EMAIL: OWNER,
  } });
  assert.equal((await f.status()).previewEnrollment.enabled, false);
  const bodyAttempt = await f.invoke('start', request('/api/auth/google/start', { method: 'POST',
    body: { intent: 'login', previewOwnerEnrollment: ENROLLMENT, email: OWNER, ageVerified: true },
  }), { provider: 'google' });
  assert.equal(bodyAttempt.status, 400);
  assert.equal((await bodyAttempt.json()).code, 'INVALID_REQUEST');
  assert.equal(f.calls.length, 0);
  await assertClosed(f, { headers: { 'X-Haru-Preview-Owner': OWNER, 'X-Haru-Owner-Enrollment': 'true', 'oai-authenticated-user-email': OWNER } });
  const flow = await f.begin(), callsBefore = f.calls.length;
  const queryAttempt = await f.callback(flow, { query: { previewOwnerEnrollment: 'true', owner: OWNER, notBefore: String(CLOCK) } });
  assert.equal(queryAttempt.headers.get('Location'), `${ORIGIN}/?auth_error=invalid_request`);
  assert.equal(f.calls.length, callsBefore);
  assertEmpty(f);
});

test('a flow begun before this owner authorization cannot acquire its new admission authority', async t => {
  const f = fixture(t);
  f.setTime(CLOCK - 1000);
  const flow = await f.begin();
  f.setTime(CLOCK);
  const response = await f.callback(flow);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
  assertEmpty(f);
});

test('signed tokens still require valid signature, audience, issuer, nonce, and subject for owner entry', async t => {
  const cases = [
    ['signature', { tamper: true }], ['audience', { claims: { aud: 'foreign-client' } }],
    ['issuer', { claims: { iss: 'https://attacker.example.test' } }], ['nonce', { claims: { nonce: 'foreign-nonce' } }],
    ['subject', { claims: { sub: undefined } }],
  ];
  for (const [label, args] of cases) await t.test(label, async t => {
    const f = fixture(t), flow = await f.begin(args), response = await f.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=verification_failed`);
    assertEmpty(f);
  });
});

test('a pre-existing account or game-only player consumes the empty-install exception', async t => {
  for (const existing of ['account', 'game-player']) await t.test(existing, async t => {
    const f = fixture(t);
    if (existing === 'account') f.db.sqlite.prepare('INSERT INTO auth_accounts(id,created_at) VALUES (?,?)').run('previous-account', CLOCK);
    else await createGameService({ db: f.db, now: f.now }).bootstrap('legacy-game-only-player');
    const before = { accounts: f.db.rows('SELECT * FROM auth_accounts'), identities: f.db.rows('SELECT * FROM auth_identities'), players: f.db.rows('SELECT * FROM game_players') };
    assert.equal((await f.status()).previewEnrollment.enabled, false);
    const flow = await f.begin(), response = await f.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
    assert.deepEqual(f.db.rows('SELECT * FROM auth_accounts'), before.accounts);
    assert.deepEqual(f.db.rows('SELECT * FROM auth_identities'), before.identities);
    assert.deepEqual(f.db.rows('SELECT * FROM game_players'), before.players);
    assert.equal(f.db.rows('SELECT * FROM auth_sessions').length, 0);
  });
});

test('matching verified email never merges a different existing provider identity tuple', async t => {
  for (const variation of ['subject', 'audience', 'provider']) await t.test(variation, async t => {
    const f = fixture(t);
    const account = f.seed(variation === 'audience' ? { subject: 'owner-subject', audience: 'old-google-client' }
      : variation === 'provider' ? { provider: 'kakao', subject: 'owner-subject' } : {});
    const before = f.db.rows('SELECT * FROM auth_identities');
    const flow = await f.begin(), response = await f.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
    assert.deepEqual(f.db.rows('SELECT * FROM auth_identities'), before);
    assert.equal(f.db.rows('SELECT * FROM auth_accounts')[0].id, account);
    assert.equal(f.db.rows('SELECT * FROM auth_sessions').length, 0);
  });
});

test('two concurrent first subjects with the same verified email create at most one account', async t => {
  const f = fixture(t);
  const first = await f.begin({ subject: 'subject-one' }), second = await f.begin({ subject: 'subject-two' });
  const responses = await Promise.all([f.callback(first), f.callback(second)]);
  assert.deepEqual(responses.map(response => new URL(response.headers.get('Location')).search).sort(), ['?auth=success', '?auth_error=signup_closed'].sort());
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions']) assert.equal(f.db.rows(`SELECT * FROM ${table}`).length, 1, table);
});

test('concurrent first logins for one provider subject cannot split the owner account', async t => {
  const f = fixture(t), first = await f.begin(), second = await f.begin();
  const responses = await Promise.all([f.callback(first), f.callback(second)]);
  const successes = responses.map((response, index) => ({ response, flow: [first, second][index] }))
    .filter(({ response }) => response.headers.get('Location') === `${ORIGIN}/?auth=success`);
  assert.ok(successes.length >= 1);
  const owners = await Promise.all(successes.map(async ({ response, flow }) => (await f.identity(cookies(response, flow.cookie))).userId));
  assert.equal(new Set(owners).size, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  assert.equal(f.db.rows('SELECT * FROM auth_identities').length, 1);
});

test('logout during owner token exchange prevents account creation and a late session cookie', async t => {
  const f = fixture(t), flow = await f.begin();
  f.pause = { entered: deferred(), release: deferred() };
  const pending = f.callback(flow);
  await f.pause.entered.promise;
  assert.equal((await f.logout(flow.cookie)).status, 200);
  f.pause.release.resolve();
  const response = await pending;
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(response.headers.getSetCookie().length, 0);
  assertEmpty(f);
});

test('logout immediately before the owner insert batch is checked atomically', async t => {
  const f = fixture(t), flow = await f.begin();
  let reached = false;
  f.db.beforeBatch = async statements => {
    if (!statements.some(statement => /INSERT(?: OR IGNORE)? INTO auth_accounts/i.test(statement.sql))) return;
    reached = true; f.db.beforeBatch = null;
    assert.equal((await f.logout(flow.cookie)).status, 200);
  };
  const response = await f.callback(flow);
  assert.equal(reached, true);
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(response.headers.getSetCookie().length, 0);
  assertEmpty(f);
});

test('an identity or session insertion failure rolls back the whole initial owner account transaction', async t => {
  for (const table of ['auth_identities', 'auth_sessions']) await t.test(table, async t => {
    const f = fixture(t), flow = await f.begin();
    f.db.sqlite.exec(`CREATE TRIGGER fixture_fail_owner_insert BEFORE INSERT ON ${table} BEGIN SELECT RAISE(ABORT, 'fixture owner transaction failure'); END`);
    const response = await f.callback(flow);
    assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
    assert.ok(!response.headers.getSetCookie().some(value => value.startsWith(`${AUTH_COOKIES.session}=`) && !value.includes('Max-Age=0')));
    assertEmpty(f);
    f.db.sqlite.exec('DROP TRIGGER fixture_fail_owner_insert');
    await f.login({ subject: 'retry-after-rollback' });
    assert.equal(f.db.rows('SELECT * FROM auth_accounts').length, 1);
  });
});

test('an OAuth flow that expires just before the owner transaction cannot create an account', async t => {
  const f = fixture(t), flow = await f.begin();
  let reached = false;
  f.db.beforeBatch = async statements => {
    if (!statements.some(statement => /INSERT(?: OR IGNORE)? INTO auth_accounts/i.test(statement.sql))) return;
    reached = true; f.db.beforeBatch = null;
    f.setTime(CLOCK + AUTH_LIMITS.flowMs + 1000);
  };
  const response = await f.callback(flow);
  assert.equal(reached, true);
  assert.notEqual(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assertEmpty(f);
});
