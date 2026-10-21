import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthApi, normalizeAuthStatus, callbackNotice, validateLoginDestination } from '../public/game/auth.js';
import { GameApiError } from '../public/game/api.js';

const CONTEXT = 'a'.repeat(64), NEXT_CONTEXT = 'b'.repeat(64);
const LOGIN_URL = 'https://accounts.google.com/o/oauth2/v2/auth?response_type=code&state=fixture-state&nonce=fixture-nonce&code_challenge_method=S256&code_challenge=fixture-challenge';
const REAUTH_URL = LOGIN_URL.replace('https://accounts.google.com/o/oauth2/v2/auth', 'https://kauth.kakao.com/oauth/authorize') + '&max_age=0&prompt=login';
const response = (body, status = 200, headers = {}) => Response.json(body, { status, headers });
const status = (reauthentication = {}) => ({
  authenticated: true, sites: { enabled: false },
  account: { provider: 'kakao', linkedProviders: ['kakao'] },
  providers: ['kakao', 'google', 'naver'].map(id => ({ id, enabled: false, reason: 'not_configured' })),
  registration: { open: false },
  reauthentication: {
    enabled: true, accountContext: CONTEXT, playerId: 'player-a',
    providers: ['kakao', 'google', 'naver'].map(id => ({ id, enabled: id === 'kakao', reason: id === 'kakao' ? 'ready' : 'not_linked' })),
    ...reauthentication,
  },
});
const rejected = error => error instanceof GameApiError;
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

test('reauthentication metadata is disabled unless an authenticated linked provider and valid account context agree', () => {
  const normalized = normalizeAuthStatus(status({
    providers: [{ id: 'google', enabled: true }, { id: 'kakao', enabled: true }, { id: 'invented', enabled: true }],
    privateEmail: 'private@example.test', sessionToken: 'raw-session-secret',
  }));
  assert.equal(normalized.reauthentication.enabled, true);
  assert.equal(normalized.reauthentication.accountContext, CONTEXT);
  assert.equal(normalized.reauthentication.playerId, 'player-a');
  assert.deepEqual(normalized.reauthentication.providers.filter(item => item.enabled).map(item => item.id), ['kakao']);
  assert.equal(normalized.reauthentication.providers.length, 3);
  assert.doesNotMatch(JSON.stringify(normalized), /private@example|raw-session|invented/);

  const missing = status(); delete missing.reauthentication;
  const invalid = [
    missing,
    { ...status(), authenticated: false, account: null },
    status({ enabled: 'true' }),
    status({ accountContext: 'not-a-context' }),
    status({ accountContext: null }),
    status({ providers: [{ id: 'kakao', enabled: 'true' }] }),
    { ...status(), account: { provider: 'google', linkedProviders: [] } },
  ];
  for (const raw of invalid) {
    const value = normalizeAuthStatus(raw).reauthentication;
    assert.equal(value.enabled, false);
    assert.equal(value.providers.some(item => item.enabled), false);
  }
});

test('reauth start uses only the latest status context in a header and requests forced provider authentication', async () => {
  const calls = [];
  const api = createAuthApi({ fetcher: async (url, options) => {
    calls.push({ url, options });
    return response(url.endsWith('/status') ? status() : { url: REAUTH_URL });
  } });
  try {
    await api.status();
    assert.equal(await api.start('kakao', 'reauth', CONTEXT), REAUTH_URL);
    const call = calls.at(-1);
    assert.equal(call.url, '/api/auth/kakao/start');
    assert.equal(call.options.method, 'POST');
    assert.deepEqual(JSON.parse(call.options.body), { intent: 'reauth' });
    assert.equal(call.options.headers['X-Haru-Account'], CONTEXT);
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error');
    assert.ok(call.options.signal instanceof AbortSignal);
    assert.equal(call.options.headers.Cookie, undefined);
    assert.equal(call.options.headers.Authorization, undefined);
  } finally { api.destroy(); }
});

test('missing, stale and malformed contexts and unlinked providers fail before a reauth request is sent', async () => {
  const calls = [];
  const api = createAuthApi({ fetcher: async (url, options) => {
    calls.push({ url, options }); return response(url.endsWith('/status') ? status() : { url: REAUTH_URL });
  } });
  try {
    await assert.rejects(() => api.start('kakao', 'reauth', CONTEXT), rejected);
    assert.equal(calls.length, 0);
    await api.status();
    for (const [provider, context] of [
      ['kakao', undefined], ['kakao', 'bad'], ['kakao', NEXT_CONTEXT],
      ['kakao', CONTEXT.toUpperCase()], ['google', CONTEXT], ['chatgpt', CONTEXT], ['invented', CONTEXT],
    ]) await assert.rejects(() => api.start(provider, 'reauth', context), rejected);
    assert.equal(calls.length, 1);
  } finally { api.destroy(); }
});

test('a new status context invalidates an old reauth request without changing login or link payloads', async () => {
  let accountContext = CONTEXT;
  const calls = [];
  const api = createAuthApi({ fetcher: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/status')) return response(status({ accountContext }));
    return response({ url: JSON.parse(options.body).intent === 'reauth' ? REAUTH_URL : LOGIN_URL });
  } });
  try {
    await api.status(); accountContext = NEXT_CONTEXT; await api.status();
    await assert.rejects(() => api.start('kakao', 'reauth', CONTEXT), rejected);
    assert.equal(calls.length, 2);
    await api.start('kakao', 'reauth', NEXT_CONTEXT);
    for (const intent of ['login', 'link']) {
      assert.equal(await api.start('google', intent), LOGIN_URL);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), { intent });
      assert.equal(calls.at(-1).options.headers['X-Haru-Account'], undefined);
    }
  } finally { api.destroy(); }
});

for (const [provider, endpoint, extra] of [
  ['kakao', 'https://kauth.kakao.com/oauth/authorize', '&prompt=login'],
  ['naver', 'https://nid.naver.com/oauth2/authorize', '&auth_type=reauthenticate'],
]) {
  test(`${provider} reauth accepts its exact provider parameters and rejects missing, duplicate or wrong values`, async () => {
    const goodURL = endpoint + '?' + new URL(LOGIN_URL).searchParams.toString() + '&max_age=0' + extra;
    const accountStatus = status({
      providers: [{ id: provider, enabled: true, reason: 'ready' }],
    });
    accountStatus.account = { provider, linkedProviders: [provider] };
    const checkURL = async (url, valid) => {
      const api = createAuthApi({ fetcher: async path => response(path.endsWith('/status') ? accountStatus : { url }) });
      try {
        await api.status();
        if (valid) assert.equal(await api.start(provider, 'reauth', CONTEXT), url);
        else await assert.rejects(
          () => api.start(provider, 'reauth', CONTEXT),
          error => rejected(error) && error.code === 'INVALID_AUTH_REDIRECT',
          `${provider} must reject ${new URL(url).search}`,
        );
      } finally { api.destroy(); }
    };
    await checkURL(goodURL, true);
    const invalid = [
      goodURL.replace('&max_age=0', ''),
      goodURL.replace('&max_age=0', '&max_age=5'),
      goodURL.replace('&max_age=0', '&max_age='),
      goodURL + '&max_age=0',
      goodURL + '&max_age=5',
      goodURL.replace(new URL(endpoint).hostname, new URL(endpoint).hostname + '.attacker.example'),
      goodURL + '#private',
    ];
    if (provider === 'kakao') invalid.push(
      goodURL.replace('&prompt=login', ''),
      goodURL.replace('&prompt=login', '&prompt=consent'),
      goodURL + '&prompt=login',
      goodURL + '&prompt=none',
      goodURL + '&auth_type=reauthenticate',
    );
    if (provider === 'naver') invalid.push(
      goodURL.replace('&auth_type=reauthenticate', ''),
      goodURL.replace('&auth_type=reauthenticate', '&auth_type=reprompt'),
      goodURL + '&auth_type=reauthenticate',
      goodURL + '&auth_type=reprompt',
      goodURL + '&prompt=login',
    );
    for (const url of invalid) await checkURL(url, false);
  });
}

test('reauth network errors and rate limits never replay the sensitive start automatically', async () => {
  let clock = 0, starts = 0;
  const api = createAuthApi({ monotonic: () => clock, fetcher: async path => {
    if (path.endsWith('/status')) return response(status());
    starts++;
    if (starts === 1) throw new TypeError('response lost');
    return response({ code: 'RATE_LIMITED', message: '잠시 후 확인해 주세요.' }, 429, { 'Retry-After': '30' });
  } });
  try {
    await api.status();
    await assert.rejects(() => api.start('kakao', 'reauth', CONTEXT), rejected);
    assert.equal(starts, 1);
    await assert.rejects(() => api.start('kakao', 'reauth', CONTEXT), error => error.status === 429);
    await assert.rejects(() => api.start('kakao', 'reauth', CONTEXT), error => error.status === 429);
    assert.equal(starts, 2);
    clock = 31000;
    assert.equal(api.retryIn(), 0);
    assert.equal(starts, 2);
  } finally { api.destroy(); }
});

test('a refreshed account context rejects an already pending old-context reauth response', async () => {
  const gate = deferred(); let context = CONTEXT;
  const api = createAuthApi({ fetcher: async path => path.endsWith('/status') ? response(status({ accountContext: context })) : gate.promise });
  let pending;
  try {
    await api.status(); pending = api.start('kakao', 'reauth', CONTEXT);
    const expected = assert.rejects(pending, rejected);
    context = NEXT_CONTEXT; await api.status();
    gate.resolve(response({ url: REAUTH_URL })); await expected;
  } finally { gate.resolve(response({ url: REAUTH_URL })); api.destroy(); await pending?.catch(() => {}); }
});

test('a reauthenticated callback message does not claim that account privileges were already verified', () => {
  const notice = callbackNotice('?auth=reauthenticated');
  assert.ok(notice);
  assert.match(notice.text, /본인 확인/);
  assert.match(notice.text, /다시 확인/);
  assert.doesNotMatch(notice.text, /권한을 확인했|권한 확인 완료|본인 확인을 완료했/);
  assert.doesNotMatch(callbackNotice('?auth_error=%3Cscript%3Esecret').text, /script|secret/);
});


test('Google reauthentication stays disabled even if stale server metadata says ready, while login and link remain available', async () => {
  const supplied = status({ providers: [{ id: 'google', enabled: true, reason: 'ready' }] });
  supplied.account = { provider: 'google', linkedProviders: ['google'] };
  const normalized = normalizeAuthStatus(supplied);
  assert.equal(normalized.reauthentication.enabled, false);
  assert.equal(normalized.reauthentication.providers.find(item => item.id === 'google').enabled, false);
  assert.throws(() => validateLoginDestination(LOGIN_URL + '&max_age=0', 'google', 'reauth'), rejected);
  const calls = [];
  const api = createAuthApi({ fetcher: async (path, options) => {
    calls.push({ path, options });
    return response(path.endsWith('/status') ? supplied : { url: LOGIN_URL });
  } });
  try {
    await api.status();
    await assert.rejects(() => api.start('google', 'reauth', CONTEXT), rejected);
    assert.equal(calls.length, 1, 'No unsupported reauthentication request is sent');
    for (const intent of ['login', 'link']) {
      assert.equal(await api.start('google', intent), LOGIN_URL);
      assert.deepEqual(JSON.parse(calls.at(-1).options.body), { intent });
    }
  } finally { api.destroy(); }
});
