import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createGameService } from '../server/game-service.mjs';
import { AUTH_COOKIES, AUTH_LIMITS, handleAuthRequest, resolveGameIdentity } from '../server/auth-service.mjs';

const ORIGIN = 'https://haru-five.example.test';
const CLOCK = Date.UTC(2026, 9, 20, 0, 0, 0);
const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const publicKey = { ...await exportJWK(pair.publicKey), kid: 'fixture-rsa', alg: 'RS256', use: 'sig' };
const ISSUERS = { google: 'https://accounts.google.com', kakao: 'https://kauth.kakao.com', naver: 'https://nid.naver.com' };
const ENDPOINTS = {
  google: { authorize: 'https://accounts.google.com/o/oauth2/v2/auth', token: 'https://oauth2.googleapis.com/token', jwks: 'https://www.googleapis.com/oauth2/v3/certs' },
  kakao: { authorize: 'https://kauth.kakao.com/oauth/authorize', token: 'https://kauth.kakao.com/oauth/token', jwks: 'https://kauth.kakao.com/.well-known/jwks.json' },
  naver: { authorize: 'https://nid.naver.com/oauth2/authorize', token: 'https://nid.naver.com/oauth2/token', jwks: 'https://nid.naver.com/oauth2/jwks' },
};
const TEST_ENV = {
  HARU_AUTH_ORIGIN: ORIGIN,
  HARU_GOOGLE_CLIENT_ID: 'fixture-google-client', HARU_GOOGLE_CLIENT_SECRET: 'fixture-google-secret',
  HARU_KAKAO_CLIENT_ID: 'fixture-kakao-client', HARU_KAKAO_CLIENT_SECRET: 'fixture-kakao-secret', HARU_KAKAO_OIDC_ENABLED: 'true',
  HARU_NAVER_CLIENT_ID: 'fixture-naver-client', HARU_NAVER_CLIENT_SECRET: 'fixture-naver-secret',
};

function applyCookies(response, previous = '') {
  const jar = new Map(previous.split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const index = item.indexOf('=');
    return [item.slice(0, index), item.slice(index + 1)];
  }));
  for (const item of response.headers.getSetCookie()) {
    const [pair] = item.split(';');
    const index = pair.indexOf('=');
    const name = pair.slice(0, index);
    if (item.includes('Max-Age=0')) jar.delete(name);
    else jar.set(name, pair.slice(index + 1));
  }
  return [...jar].map(([name, value]) => `${name}=${value}`).join('; ');
}

function request(path, { method = 'GET', body, cookie = '', origin = ORIGIN, headers = {}, urlOrigin = ORIGIN } = {}) {
  return new Request(`${urlOrigin}${path}`, {
    method,
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
  });
}

function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

function harness(t, { env = {}, sitesUserId, sitesEmail } = {}) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let clock = CLOCK;
  let serial = 0;
  const codes = new Map();
  const calls = [];
  const settings = { ...TEST_ENV, ...env };
  const h = {
    db, env: settings, calls, codes,
    setTime(value) { clock = value; },
    now: () => clock,
    pause: null,
    upstream: null,
  };
  const fetcher = async (url, init) => {
    calls.push({ url, init });
    const provider = Object.keys(ENDPOINTS).find(id => ENDPOINTS[id].token === url || ENDPOINTS[id].jwks === url);
    assert.ok(provider, 'Only pinned provider endpoints may receive outgoing requests');
    assert.equal(init.redirect, 'manual');
    if (url === ENDPOINTS[provider].jwks) return Response.json({ keys: [publicKey] });
    const body = new URLSearchParams(init.body);
    const grant = codes.get(body.get('code'));
    assert.ok(grant, 'The authorization code must belong to a started flow');
    assert.equal(grant.provider, provider);
    assert.equal(grant.used, false);
    grant.used = true;
    assert.equal(body.get('grant_type'), 'authorization_code');
    assert.equal(body.get('client_id'), settings[`HARU_${provider.toUpperCase()}_CLIENT_ID`]);
    assert.equal(body.get('client_secret'), settings[`HARU_${provider.toUpperCase()}_CLIENT_SECRET`]);
    assert.equal(body.get('redirect_uri'), `${ORIGIN}/api/auth/${provider}/callback`);
    const expectedChallenge = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body.get('code_verifier')))).toString('base64url');
    assert.equal(expectedChallenge, grant.challenge, 'The original S256 PKCE verifier is exchanged');
    if (provider === 'naver') assert.equal(body.get('state'), grant.state);
    if (h.pause) {
      h.pause.entered.resolve();
      await h.pause.release.promise;
    }
    if (h.upstream) return h.upstream({ body, grant, provider });
    const claims = {
      iss: ISSUERS[provider], aud: settings[`HARU_${provider.toUpperCase()}_CLIENT_ID`],
      sub: grant.subject, nonce: grant.nonce, iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 300,
      email: 'same-email@example.test', email_verified: true, name: 'Ignored private profile', ...grant.claims,
    };
    for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
    const header = { alg: 'RS256', kid: 'fixture-rsa', ...grant.header };
    let token = await new SignJWT(claims).setProtectedHeader(header).sign(header.alg === 'HS256' ? new Uint8Array(32).fill(9) : pair.privateKey);
    if (grant.tamper) token = `${token.slice(0, -10)}XXXXXXXXXX`;
    return Response.json({ id_token: token, access_token: 'discard-this-access-token', refresh_token: 'discard-this-refresh-token', token_type: 'Bearer' });
  };
  h.options = { db, env: settings, sitesUserId, sitesEmail, now: h.now, fetch: fetcher };
  h.invoke = (action, req, options = {}) => handleAuthRequest(req, { ...h.options, action, ...options });
  h.identity = (cookie = '', options = {}) => resolveGameIdentity(request('/', { cookie }), { ...h.options, ...options });
  h.begin = async ({ provider = 'google', intent = 'login', cookie = '', subject = 'subject-1', claims, header, tamper, options = {} } = {}) => {
    const response = await h.invoke('start', request(`/api/auth/${provider}/start`, { method: 'POST', cookie, body: { intent } }), { provider, ...options });
    assert.equal(response.status, 200, await response.clone().text());
    const url = new URL((await response.json()).url);
    assert.equal(`${url.origin}${url.pathname}`, ENDPOINTS[provider].authorize);
    assert.equal(url.searchParams.get('response_type'), 'code');
    assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
    assert.equal(url.searchParams.get('scope'), provider === 'google' ? 'openid email' : 'openid');
    const code = `fixture-code-${++serial}`;
    const flow = {
      provider, code, response, state: url.searchParams.get('state'), nonce: url.searchParams.get('nonce'),
      challenge: url.searchParams.get('code_challenge'), cookie: applyCookies(response, cookie), subject,
      claims, header, tamper, used: false, options,
    };
    codes.set(code, flow);
    return flow;
  };
  h.callback = (flow, { provider = flow.provider, cookie = flow.cookie, params = {}, options = {} } = {}) => {
    const query = new URLSearchParams({ state: flow.state, code: flow.code, ...params });
    return h.invoke('callback', request(`/api/auth/${provider}/callback?${query}`, { cookie, headers: { 'Sec-Fetch-Site': 'cross-site' } }), { provider, ...flow.options, ...options });
  };
  h.login = async (args = {}) => {
    const flow = await h.begin(args);
    const response = await h.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth=success`);
    return { flow, response, cookie: applyCookies(response, flow.cookie) };
  };
  return h;
}

test('auth status exposes only configuration state and no app identity without an explicit sign-in', async t => {
  const h = harness(t, { env: { HARU_GOOGLE_CLIENT_ID: '', HARU_KAKAO_CLIENT_SECRET: '', HARU_NAVER_CLIENT_ID: '' }, sitesUserId: 'trusted-owner' });
  const response = await h.invoke('status', request('/api/auth/status'));
  const body = await response.json();
  assert.equal(body.authenticated, false);
  assert.equal(body.account, null);
  assert.deepEqual(body.providers.map(item => [item.id, item.enabled, item.reason]), [['kakao', false, 'not_configured'], ['google', false, 'not_configured'], ['naver', false, 'not_configured']]);
  assert.deepEqual(body.registration, { open: false, ageTarget: '전체이용가 목표', minimumSignupAge: null, guardianReady: false });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  assert.equal(response.headers.get('Referrer-Policy'), 'no-referrer');
  assert.ok(!JSON.stringify(body).includes('trusted-owner'));
  const start = await h.invoke('start', request('/api/auth/google/start', { method: 'POST', body: { intent: 'login' } }), { provider: 'google' });
  assert.equal(start.status, 503);
  assert.equal((await start.json()).code, 'AUTH_NOT_CONFIGURED');
  assert.equal(h.calls.length, 0);
});

test('Kakao OIDC console confirmation is required; Naver uses current OIDC routes without an invented flag', async t => {
  const h = harness(t, { env: { HARU_KAKAO_OIDC_ENABLED: 'false' } });
  const status = await (await h.invoke('status', request('/api/auth/status'))).json();
  assert.equal(status.providers.find(item => item.id === 'kakao').reason, 'oidc_not_enabled');
  assert.equal(status.providers.find(item => item.id === 'naver').enabled, true);
  await h.begin({ provider: 'naver' });
});

test('closed signup blocks new verified social subjects without creating accounts or storing profile data', async t => {
  const h = harness(t);
  const flow = await h.begin();
  const response = await h.callback(flow);
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=signup_closed`);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 0);
  assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, 0);
  assert.equal(h.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
});

test('all three providers complete signed RS256, PKCE and nonce verification and keep only opaque server identity', async t => {
  for (const provider of ['kakao', 'google', 'naver']) await t.test(provider, async t => {
    const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
    const { cookie, response } = await h.login({ provider });
    const identity = await h.identity(cookie);
    assert.match(identity.userId, /^social:/);
    assert.equal(identity.provider, provider);
    assert.deepEqual(identity.linkedProviders, [provider]);
    assert.match(response.headers.getSetCookie()[0], /__Host-haru_session=[A-Za-z0-9_-]{43}; Path=\/; Secure; HttpOnly; SameSite=Lax; Max-Age=604800/);
    const stored = JSON.stringify({ accounts: h.db.rows('SELECT * FROM auth_accounts'), identities: h.db.rows('SELECT * FROM auth_identities'), sessions: h.db.rows('SELECT * FROM auth_sessions') });
    assert.ok(!stored.includes('same-email'));
    assert.ok(!stored.includes('Ignored private profile'));
    assert.ok(!stored.includes('discard-this'));
    const sessionValue = cookie.match(/__Host-haru_session=([^;]+)/)[1];
    assert.ok(!stored.includes(sessionValue), 'Only the SHA-256 session hash is persisted');
    const status = await (await h.invoke('status', request('/api/auth/status', { cookie }))).json();
    assert.deepEqual(status.account, { provider, linkedProviders: [provider] });
    assert.ok(!JSON.stringify(status).includes(identity.userId));
  });
});

test('forged, swapped, wrong-provider, expired and replayed OAuth state do not exchange an authorization code', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  const a = await h.begin();
  const b = await h.begin();
  for (const options of [{ params: { state: 'X'.repeat(43) } }, { cookie: b.cookie }, { provider: 'kakao' }]) {
    const response = await h.callback(a, options);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=state_invalid`);
  }
  assert.equal(h.calls.length, 0);
  h.setTime(CLOCK + AUTH_LIMITS.flowMs);
  assert.equal((await h.callback(a)).headers.get('Location'), `${ORIGIN}/?auth_error=state_invalid`);
  assert.equal(h.calls.length, 0);
  h.setTime(CLOCK);
  const responses = await Promise.all([h.callback(a), h.callback(a)]);
  assert.deepEqual(responses.map(response => new URL(response.headers.get('Location')).search).sort(), ['?auth=success', '?auth_error=state_invalid'].sort());
  assert.equal(h.calls.filter(call => call.url === ENDPOINTS.google.token).length, 1);
  assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, 1);
});

test('tokens with wrong issuer, audience, nonce, signature, authorized party, algorithm or time claims are rejected', async t => {
  const cases = [
    ['issuer', { claims: { iss: 'https://attacker.example.test' } }],
    ['audience', { claims: { aud: 'another-client' } }],
    ['nonce', { claims: { nonce: 'wrong-nonce' } }],
    ['missing nonce', { claims: { nonce: undefined } }],
    ['missing issued-at', { claims: { iat: undefined } }],
    ['expired', { claims: { exp: Math.floor(CLOCK / 1000) - 60 } }],
    ['future issued-at', { claims: { iat: Math.floor(CLOCK / 1000) + 120 } }],
    ['authorized party', { claims: { azp: 'another-client' } }],
    ['ambiguous audience', { claims: { aud: [TEST_ENV.HARU_GOOGLE_CLIENT_ID, 'another-client'] } }],
    ['signature', { tamper: true }],
    ['algorithm confusion', { header: { alg: 'HS256' } }],
  ];
  for (const [name, mutation] of cases) await t.test(name, async t => {
    const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
    const flow = await h.begin(mutation);
    const response = await h.callback(flow);
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=verification_failed`);
    assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 0);
    assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, 0);
    assert.equal(h.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
  });
});

test('provider callback error text and query redirects are never reflected', async t => {
  const h = harness(t);
  const flow = await h.begin();
  const response = await h.callback(flow, { params: { error: 'access_denied', error_description: 'secret-code-and-email', error_uri: 'https://attacker.example.test' } });
  assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=provider_denied`);
  assert.equal(await response.text(), '');
  assert.equal(h.calls.length, 0);
  const next = await h.begin();
  assert.equal((await h.callback(next, { params: { return_to: 'https://attacker.example.test' } })).headers.get('Location'), `${ORIGIN}/?auth_error=invalid_request`);
});

test('verified email equality never merges accounts; simultaneous same-subject sign-ins converge atomically', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  const a = await h.begin({ subject: 'same-subject' });
  const b = await h.begin({ subject: 'same-subject' });
  const [ra, rb] = await Promise.all([h.callback(a), h.callback(b)]);
  assert.equal(ra.headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(rb.headers.get('Location'), `${ORIGIN}/?auth=success`);
  const first = await h.identity(applyCookies(ra, a.cookie));
  const second = await h.identity(applyCookies(rb, b.cookie));
  assert.equal(first.userId, second.userId);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 1);
  const other = await h.login({ subject: 'different-subject' });
  const otherProvider = await h.login({ provider: 'kakao', subject: 'same-subject' });
  assert.notEqual((await h.identity(other.cookie)).userId, first.userId);
  assert.notEqual((await h.identity(otherProvider.cookie)).userId, first.userId);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 3);
});

test('deliberate Sites sign-in preserves the existing game account, while new Sites membership remains closed', async t => {
  const h = harness(t, { sitesUserId: 'existing-sites-player' });
  const game = createGameService({ db: h.db, now: h.now });
  await game.bootstrap('existing-sites-player');
  const before = h.db.rows('SELECT * FROM game_players');
  assert.equal(await h.identity(''), null);
  const intent = await h.invoke('sites-start', request('/api/auth/sites-start', { method: 'POST', body: {} }));
  assert.deepEqual(await intent.clone().json(), { url: '/signin-with-chatgpt?return_to=%2F' });
  const cookie = applyCookies(intent);
  assert.match(cookie, /__Host-haru_session=sites/);
  assert.equal((await h.identity(cookie)).userId, 'existing-sites-player');
  const flow = await h.begin({ intent: 'link', cookie, subject: 'owner-google' });
  const linked = await h.callback(flow);
  assert.equal(linked.headers.get('Location'), `${ORIGIN}/?auth=linked`);
  assert.deepEqual(h.db.rows('SELECT * FROM game_players'), before);
  const social = await h.login({ subject: 'owner-google' });
  assert.equal((await h.identity(social.cookie)).userId, 'existing-sites-player');
  assert.deepEqual(h.db.rows('SELECT * FROM game_players'), before);
  assert.equal(await h.identity(cookie, { sitesUserId: 'unregistered-sites-person' }), null);
});

test('private tester email permits initial Sites entry only with trusted Sites identity and deliberate app intent', async t => {
  const h = harness(t, { sitesUserId: 'owner-private-subject', sitesEmail: 'owner@example.test', env: { HARU_SITES_TESTER_EMAIL: 'owner@example.test' } });
  assert.equal(await h.identity(''), null);
  assert.equal((await h.identity(`${AUTH_COOKIES.session}=sites`)).userId, 'owner-private-subject');
  assert.equal(await h.identity(`${AUTH_COOKIES.session}=sites`, { sitesEmail: 'visitor@example.test' }), null);
  assert.equal(await h.identity(`${AUTH_COOKIES.session}=sites`, { sitesUserId: undefined }), null);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 0, 'Eligibility does not create or merge an account by email');
});

test('linking requires the same existing app identity, prevents ownership transfer, and keeps current social session usable', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  const a = await h.login({ subject: 'account-a' });
  const b = await h.login({ subject: 'account-b' });
  const aId = (await h.identity(a.cookie)).userId;
  const flow = await h.begin({ provider: 'kakao', intent: 'link', cookie: a.cookie, subject: 'kakao-a' });
  assert.equal((await h.identity(flow.cookie)).userId, aId, 'Starting a link must retain the presented session');
  const switched = await h.callback(flow, { cookie: applyCookies(flow.response, b.cookie) });
  assert.equal(switched.headers.get('Location'), `${ORIGIN}/?auth_error=state_invalid`);
  const success = await h.callback(flow);
  assert.equal(success.headers.get('Location'), `${ORIGIN}/?auth=linked`);
  const collision = await h.begin({ provider: 'kakao', intent: 'link', cookie: b.cookie, subject: 'kakao-a' });
  assert.equal((await h.callback(collision)).headers.get('Location'), `${ORIGIN}/?auth_error=account_conflict`);
  const owned = h.db.rows("SELECT account_id FROM auth_identities WHERE provider = 'kakao'");
  assert.deepEqual(owned, [{ account_id: aId }]);
  const byKakao = await h.login({ provider: 'kakao', subject: 'kakao-a' });
  assert.equal((await h.identity(byKakao.cookie)).userId, aId);
});

test('concurrent linking of one provider identity to two different accounts has exactly one owner', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  const a = await h.login({ subject: 'account-a' });
  const b = await h.login({ subject: 'account-b' });
  const aFlow = await h.begin({ provider: 'naver', intent: 'link', cookie: a.cookie, subject: 'one-naver-identity' });
  const bFlow = await h.begin({ provider: 'naver', intent: 'link', cookie: b.cookie, subject: 'one-naver-identity' });
  const responses = await Promise.all([h.callback(aFlow), h.callback(bFlow)]);
  assert.deepEqual(responses.map(response => new URL(response.headers.get('Location')).search).sort(), ['?auth=linked', '?auth_error=account_conflict'].sort());
  const owners = h.db.rows("SELECT account_id FROM auth_identities WHERE provider = 'naver'");
  assert.equal(owners.length, 1);
  assert.ok([(await h.identity(a.cookie)).userId, (await h.identity(b.cookie)).userId].includes(owners[0].account_id));
});

test('logout, invalid/expired/revoked and browser-deleted cookies never fall through to Sites identity', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' }, sitesUserId: 'outer-sites-person' });
  const login = await h.login();
  const logout = await h.invoke('logout', request('/api/auth/logout', { method: 'POST', cookie: login.cookie, body: {} }));
  const signedOut = applyCookies(logout, login.cookie);
  assert.match(signedOut, /__Host-haru_session=signed-out/);
  assert.equal(await h.identity(signedOut), null);
  assert.equal(await h.identity(login.cookie), null, 'Replaying a revoked bearer does not restore the session');
  assert.equal(await h.identity(`${AUTH_COOKIES.session}=bad-cookie`), null);
  assert.equal(await h.identity(`${AUTH_COOKIES.session}=sites; ${AUTH_COOKIES.session}=sites`), null);
  assert.equal(await h.identity(''), null, 'An expired cookie removed by the browser stays unauthenticated');
  const again = await h.login();
  h.setTime(CLOCK + AUTH_LIMITS.sessionMs);
  assert.equal(await h.identity(again.cookie), null);
});

test('logout while token exchange is pending cancels login and Sites linking before any account mutation', async t => {
  for (const intent of ['login', 'link']) await t.test(intent, async t => {
    const h = harness(t, {
      env: { HARU_REGISTRATION_OPEN: 'true', HARU_SITES_TESTER_EMAIL: 'owner@example.test' },
      sitesUserId: 'sites-owner', sitesEmail: 'owner@example.test',
    });
    const flow = await h.begin({ intent, cookie: intent === 'link' ? `${AUTH_COOKIES.session}=sites` : '' });
    h.pause = { entered: deferred(), release: deferred() };
    const pending = h.callback(flow);
    await h.pause.entered.promise;
    const logout = await h.invoke('logout', request('/api/auth/logout', { method: 'POST', cookie: flow.cookie, body: {} }));
    assert.equal(logout.status, 200);
    h.pause.release.resolve();
    const response = await pending;
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=account_changed`);
    assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, 0);
    assert.equal(h.db.rows('SELECT * FROM auth_identities').length, 0);
    assert.equal(response.headers.getSetCookie().length, 0, 'Stale callback cannot overwrite logout or a newer browser flow');
  });
});

test('a new start cancels an in-flight callback and old response cannot erase the new binding', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  const a = await h.begin();
  h.pause = { entered: deferred(), release: deferred() };
  const pending = h.callback(a);
  await h.pause.entered.promise;
  const b = await h.begin({ provider: 'kakao', cookie: a.cookie });
  h.pause.release.resolve();
  assert.equal((await pending).headers.get('Location'), `${ORIGIN}/?auth_error=account_changed`);
  h.pause = null;
  assert.equal((await h.callback(b)).headers.get('Location'), `${ORIGIN}/?auth=success`);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 1);
});

test('logout or a new start also revokes an issued session whose callback cookie has not arrived yet', async t => {
  for (const action of ['logout', 'start']) await t.test(action, async t => {
    const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
    const flow = await h.begin();
    const delayedResponse = await h.callback(flow);
    assert.equal(delayedResponse.headers.get('Location'), `${ORIGIN}/?auth=success`);
    if (action === 'logout') await h.invoke('logout', request('/api/auth/logout', { method: 'POST', cookie: flow.cookie, body: {} }));
    else await h.begin({ cookie: flow.cookie });
    const staleCookie = applyCookies(delayedResponse, flow.cookie);
    assert.equal(await h.identity(staleCookie), null, 'Late Set-Cookie points only to a revoked server session');
  });
});

test('auth writes reject cross-site, missing Origin, wrong Host, form bodies and caller-supplied redirects', async t => {
  const h = harness(t);
  const mutations = [
    { origin: 'https://attacker.example.test' },
    { headers: { 'Sec-Fetch-Site': 'cross-site' } },
    { urlOrigin: 'https://wrong-host.example.test' },
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    { body: { intent: 'login', return_to: 'https://attacker.example.test' } },
    { body: { intent: 'login', userId: 'victim' } },
    { body: { intent: 'login', extra: 'x'.repeat(2000) } },
  ];
  for (const mutation of mutations) {
    const response = await h.invoke('start', request('/api/auth/google/start', { method: 'POST', body: { intent: 'login' }, ...mutation }), { provider: 'google' });
    assert.ok([400, 403, 413, 415].includes(response.status));
  }
  const missing = request('/api/auth/google/start', { method: 'POST', body: { intent: 'login' } });
  missing.headers.delete('Origin');
  assert.equal((await h.invoke('start', missing, { provider: 'google' })).status, 403);
  assert.equal((await h.invoke('logout', request('/api/auth/logout'))).status, 405);
  assert.equal((await h.invoke('start', request('/api/auth/evil/start', { method: 'POST', body: { intent: 'login' } }), { provider: 'evil' })).status, 404);
  assert.equal(h.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
});

test('provider timeouts, redirects, oversized responses and SQL exceptions produce fixed redacted failures', async t => {
  for (const kind of ['timeout', 'redirect', 'oversized', 'exception']) await t.test(kind, async t => {
    const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
    const flow = await h.begin();
    h.upstream = () => {
      if (kind === 'timeout') return new Promise(() => {});
      if (kind === 'redirect') return new Response(null, { status: 302, headers: { Location: 'https://attacker.example.test/collect-secret' } });
      if (kind === 'oversized') return Response.json({ id_token: 'sensitive-profile-'.repeat(6000) });
      throw new Error('SECRET_DATABASE_OR_PROVIDER_DETAIL');
    };
    const response = await h.callback(flow, { options: { timeoutMs: 15 } });
    assert.equal(response.headers.get('Location'), `${ORIGIN}/?auth_error=provider_unavailable`);
    assert.equal(await response.text(), '');
    assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, 0);
  });
  const h = harness(t);
  h.db.beforeQuery = () => { throw new Error('SECRET_SQL_DETAILS'); };
  const response = await h.invoke('status', request('/api/auth/status', { cookie: `${AUTH_COOKIES.session}=sites` }), { sitesUserId: 'owner' });
  assert.equal(response.status, 503);
  assert.ok(!(await response.text()).includes('SECRET_SQL_DETAILS'));
});

test('pending flow and quota storage are bounded, and accounts retain at most five live sessions', async t => {
  const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
  for (let index = 0; index < 7; index++) {
    h.setTime(CLOCK + index);
    await h.login();
  }
  assert.equal(h.db.rows('SELECT * FROM auth_sessions').length, AUTH_LIMITS.sessionsPerAccount);
  h.db.sqlite.prepare("UPDATE auth_rate_limits SET request_count = ? WHERE bucket = 'start:google'").run(AUTH_LIMITS.startsPerMinute);
  const response = await h.invoke('start', request('/api/auth/google/start', { method: 'POST', body: { intent: 'login' } }), { provider: 'google' });
  assert.equal(response.status, 429);
  assert.ok(Number(response.headers.get('Retry-After')) > 0);
  assert.ok(h.db.rows('SELECT * FROM auth_rate_limits').length <= 6);
  h.setTime(CLOCK + AUTH_LIMITS.flowMs + 60000);
  await h.begin();
  assert.equal(h.db.rows('SELECT * FROM auth_oauth_transactions').length, 1);
});

test('withdrawal during provider exchange blocks both login and linking at commit', async t => {
  const { createAccountLifecycle } = await import('../server/account-lifecycle.mjs');
  for (const intent of ['login', 'link']) await t.test(intent, async t => {
    const h = harness(t, { env: { HARU_REGISTRATION_OPEN: 'true' } });
    const first = await h.login();
    const owner = (await h.identity(first.cookie)).userId;
    h.env.HARU_REGISTRATION_OPEN = 'false';
    const flow = await h.begin({ intent, provider: intent === 'link' ? 'naver' : 'google', cookie: intent === 'link' ? first.cookie : '' });
    h.pause = { entered: deferred(), release: deferred() };
    const pending = h.callback(flow);
    await h.pause.entered.promise;
    await createAccountLifecycle({ db: h.db, now: h.now }).withdraw({ actorId: owner, accountId: owner });
    h.pause.release.resolve();
    const response = await pending;
    assert.doesNotMatch(response.headers.get('Location'), /auth=success|auth=linked/);
    assert.equal(response.headers.getSetCookie().length, 0);
    assert.equal(h.db.rows('SELECT * FROM auth_sessions WHERE revoked_at IS NULL').length, 0);
    assert.deepEqual(h.db.rows('SELECT provider FROM auth_identities').map(row => row.provider), ['google']);
    assert.equal(h.db.rows('SELECT * FROM auth_oauth_transactions').length, 0);
    assert.equal(await h.identity(first.cookie), null);
  });
});

test('terminated legacy Sites accounts cannot return through trusted tester access', async t => {
  const h = harness(t, { env: { HARU_SITES_TESTER_EMAIL: 'owner@example.test' }, sitesUserId: 'old-owner', sitesEmail: 'owner@example.test' });
  h.db.sqlite.prepare("INSERT INTO privacy_account_controls (account_id, state, updated_at) VALUES (?, 'deleted', ?)").run('old-owner', CLOCK);
  assert.equal(await h.identity(`${AUTH_COOKIES.session}=sites`), null);
  assert.equal(h.db.rows('SELECT * FROM auth_accounts').length, 0);
  assert.equal(h.db.rows('SELECT * FROM game_players').length, 0);
});
