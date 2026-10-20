import test from 'node:test';
import assert from 'node:assert/strict';
import { createPrivacyApi, PrivacyApiError, normalizePrivacyStatus, normalizePrivacyChildren, normalizePrivacyAccount, normalizeGuardianRequests } from '../public/game/privacy.js';

const CONTEXT = 'a'.repeat(64), NEXT_CONTEXT = 'b'.repeat(64), NOW = 1792454400000;
const status = (context = CONTEXT) => ({
  accountContext: context, playerId: 'public-player-one', account: { state: 'active', deletion: null },
  guardian: { guardianReady: false, providerConfigured: false, enrollmentOpen: false }, selfRecoveryReady: false,
  capabilities: { selfExport: true, childManagement: true, selfClosure: false, guardianEnrollment: false },
});
const children = () => ({ children: [{ childAccountId: 'child-one', label: '구름토끼', state: 'active', deletion: null }], hasMore: false });
const data = () => ({ format: 'haru-five-rights-export-v1', exportedAt: new Date(NOW).toISOString(), profile: null, access: { state: 'active' }, results: [], attempts: [], coinLedger: [], weeklyAwards: [], linkedProviders: [] });
const response = (body, code = 200, headers = {}) => Response.json(body, { status: code, headers });
const rejected = code => error => error instanceof PrivacyApiError && error.code === code;
function pending() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }

async function initialized(handler) {
  const calls = [];
  const api = createPrivacyApi({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url === '/api/privacy/status' && options.method === 'GET') return response(status());
    if (url === '/api/privacy/children') return response(children());
    return handler(url, options);
  } });
  await api.status(); await api.children();
  return { api, calls };
}

test('privacy normalization rejects invalid states, preserves exact flags, and strips unneeded private fields', () => {
  const normalized = normalizePrivacyStatus({ ...status(), email: 'private@example.test', token: 'secret', capabilities: { selfExport: 'true', childManagement: true, selfClosure: true, guardianEnrollment: true }, selfRecoveryReady: 'true', guardian: { guardianReady: 'true', providerConfigured: true, enrollmentOpen: true } });
  assert.deepEqual(normalized.capabilities, { selfExport: false, childManagement: true, selfClosure: false, guardianEnrollment: false });
  assert.equal(normalized.selfRecoveryReady, false);
  assert.equal(normalized.guardian.guardianReady, false);
  assert.doesNotMatch(JSON.stringify(normalized), /private@example|secret/);
  for (const bad of [{ ...status(), accountContext: 'bad' }, { ...status(), playerId: undefined }, { ...status(), playerId: 'x'.repeat(201) }, { ...status(), account: { state: 'invented' } }, { ...status(), account: { state: 'deleted', deletion: null } }]) assert.throws(() => normalizePrivacyStatus(bad), rejected('INVALID_PRIVACY_RESPONSE'));
  assert.equal(normalizePrivacyAccount({ state: 'deletion_pending', deletion: { status: 'pending', requestedAt: NOW, completedAt: null } }).deletion.awaitingPolicy, true);
  const list = normalizePrivacyChildren({ ...children(), secret: 'drop' });
  assert.deepEqual(list.children[0], { childAccountId: 'child-one', label: '구름토끼', state: 'active', deletion: null });
  for (const bad of [{ ...children(), hasMore: 'false' }, { children: [...children().children, ...children().children], hasMore: false }, { children: [{ ...children().children[0], state: 'deleted' }], hasMore: false }, { children: [{ ...children().children[0], label: 'x'.repeat(101) }], hasMore: false }]) assert.throws(() => normalizePrivacyChildren(bad), rejected('INVALID_PRIVACY_RESPONSE'));
  const requests = normalizeGuardianRequests({ requests: [{ requestId: 'request-one', status: 'pending', createdAt: NOW, expiresAt: NOW + 1000, policyVersion: 'v1', requestToken: 'secret', nonce: 'secret' }] });
  assert.doesNotMatch(JSON.stringify(requests), /secret|requestToken|nonce/);
});

test('all privacy methods use fixed same-origin paths and explicit status context, with selector-only child targets', async () => {
  const h = await initialized((url, options) => {
    if (url === '/api/privacy/export') return response(data());
    if (url === '/api/guardian/requests') return response({ requests: [] });
    const input = JSON.parse(options.body);
    if (url === '/api/privacy/status') return response({ state: 'active', deletion: null });
    if (url === '/api/privacy/withdraw') { assert.equal(input.confirmation, 'withdraw'); return response({ state: 'withdrawn', deletion: null }); }
    assert.equal(url, '/api/privacy/delete'); assert.equal(input.confirmation, 'delete');
    return response({ state: 'deletion_pending', deletion: { requestId: 'job-one', status: 'pending', requestedAt: NOW, completedAt: null } });
  });
  try {
    assert.deepEqual(await h.api.exportData({ accountContext: CONTEXT }), data());
    assert.equal((await h.api.childStatus({ accountContext: CONTEXT, childAccountId: 'child-one' })).state, 'active');
    await h.api.withdraw({ accountContext: CONTEXT, childAccountId: 'child-one' });
    await h.api.requestDeletion({ accountContext: CONTEXT, childAccountId: 'child-one' });
    await h.api.guardianRequests();
    for (const { url, options } of h.calls) {
      assert.ok(url.startsWith('/api/privacy/') || url === '/api/guardian/requests');
      assert.equal(options.credentials, 'same-origin'); assert.equal(options.cache, 'no-store'); assert.equal(options.redirect, 'error');
      assert.ok(options.signal instanceof AbortSignal);
      if (options.method === 'POST' || url === '/api/privacy/children' || url === '/api/guardian/requests') assert.equal(options.headers['X-Haru-Account'], CONTEXT);
      else assert.equal(options.headers['X-Haru-Account'], undefined);
      assert.equal(options.headers.Cookie, undefined); assert.equal(options.headers.Authorization, undefined);
    }
    const before = h.calls.length;
    assert.throws(() => h.api.requestDeletion({ accountContext: CONTEXT, childAccountId: 'stranger' }), rejected('INVALID_CHILD_SELECTION'));
    assert.throws(() => h.api.exportData({ accountContext: NEXT_CONTEXT }), rejected('PRIVACY_NOT_READY'));
    assert.throws(() => h.api.withdraw({ accountContext: CONTEXT, confirmation: 'delete' }), rejected('PRIVACY_NOT_READY'));
    assert.throws(() => h.api.childStatus({ accountContext: CONTEXT }), rejected('INVALID_CHILD_SELECTION'));
    assert.equal(h.calls.length, before);
  } finally { h.api.destroy(); }
});

test('401 and changed-account responses preserve status/code while invalidating previous context', async () => {
  for (const [httpStatus, code] of [[401, 'REAUTH_REQUIRED'], [409, 'ACCOUNT_CHANGED']]) {
    const h = await initialized(() => response({ code, message: '다시 확인해 주세요.' }, httpStatus));
    try {
      await assert.rejects(h.api.exportData({ accountContext: CONTEXT }), error => error.status === httpStatus && error.code === code && error.retryable === false);
      assert.throws(() => h.api.withdraw({ accountContext: CONTEXT }), rejected('PRIVACY_NOT_READY'));
    } finally { h.api.destroy(); }
  }
});

test('network and timeout failures do not manufacture success or automatically repeat a mutation', async () => {
  const h = await initialized(() => { throw new TypeError('network lost'); });
  try {
    await assert.rejects(h.api.withdraw({ accountContext: CONTEXT, childAccountId: 'child-one' }), rejected('PRIVACY_NETWORK_ERROR'));
    assert.equal(h.calls.filter(call => call.url === '/api/privacy/withdraw').length, 1);
  } finally { h.api.destroy(); }
  const api = createPrivacyApi({ timeoutMs: 5, fetchImpl: () => new Promise(() => {}) });
  try { await assert.rejects(api.status(), rejected('PRIVACY_TIMEOUT')); }
  finally { api.destroy(); }
});

test('rate limits retain Retry-After and block repeated network calls until the local cooldown ends', async () => {
  let time = 0, count = 0;
  const api = createPrivacyApi({ monotonic: () => time, fetchImpl: async () => {
    count++;
    return count === 1 ? response({ code: 'RATE_LIMITED' }, 429, { 'Retry-After': '7' }) : response(status());
  } });
  try {
    await assert.rejects(api.status(), error => error.status === 429 && error.retryAfter === 7);
    await assert.rejects(api.status(), error => error.code === 'RATE_LIMITED' && error.retryAfter === 7);
    assert.equal(count, 1); time = 7001;
    assert.equal((await api.status()).accountContext, CONTEXT); assert.equal(count, 2);
  } finally { api.destroy(); }
});

test('oversized, malformed, non-JSON and invalid UTF-8 responses are bounded and rejected', async () => {
  const fixtures = [
    [() => response(status(), 200, { 'Content-Length': String(256 * 1024 + 1) }), 'PRIVACY_RESPONSE_TOO_LARGE'],
    [() => response({ padding: 'x'.repeat(256 * 1024) }), 'PRIVACY_RESPONSE_TOO_LARGE'],
    [() => new Response('<html>login</html>', { headers: { 'Content-Type': 'text/html' } }), 'INVALID_PRIVACY_RESPONSE'],
    [() => new Response('{notjson', { headers: { 'Content-Type': 'application/json' } }), 'INVALID_PRIVACY_RESPONSE'],
    [() => new Response(new Uint8Array([0xff]), { headers: { 'Content-Type': 'application/json' } }), 'INVALID_PRIVACY_RESPONSE'],
  ];
  for (const [reply, code] of fixtures) {
    const api = createPrivacyApi({ fetchImpl: async () => reply() });
    try { await assert.rejects(api.status(), rejected(code)); } finally { api.destroy(); }
  }
});

test('destroy aborts requests even when fetch ignores its signal and rejects late private responses', async () => {
  const held = pending(); let signal;
  const api = createPrivacyApi({ fetchImpl: (_url, options) => { signal = options.signal; return held.promise; } });
  const reading = api.status();
  const rejection = assert.rejects(reading, rejected('PRIVACY_ABORTED'));
  api.destroy(); assert.equal(signal.aborted, true); await rejection;
  held.resolve(response(status()));
  await assert.rejects(api.status(), rejected('PRIVACY_ABORTED'));
  assert.throws(() => api.exportData({ accountContext: CONTEXT }), rejected('PRIVACY_ABORTED'));
});

test('new account status discards an older response and clears the old child selector', async () => {
  const held = pending(); let calls = 0;
  const api = createPrivacyApi({ fetchImpl: async url => {
    if (url === '/api/privacy/children') return response(children());
    calls++;
    if (calls === 2) return held.promise;
    return response(status(calls === 1 ? CONTEXT : NEXT_CONTEXT));
  } });
  try {
    await api.status(); await api.children();
    const older = api.status();
    const rejection = assert.rejects(older, rejected('STALE_PRIVACY_RESPONSE'));
    assert.equal((await api.status()).accountContext, NEXT_CONTEXT);
    held.resolve(response(status(CONTEXT))); await rejection;
    assert.throws(() => api.withdraw({ accountContext: CONTEXT, childAccountId: 'child-one' }), rejected('PRIVACY_NOT_READY'));
    assert.throws(() => api.withdraw({ accountContext: NEXT_CONTEXT, childAccountId: 'child-one' }), rejected('INVALID_CHILD_SELECTION'));
  } finally { api.destroy(); }
});

test('a delayed child list or export from an earlier account cannot become the current selection or download', async () => {
  for (const action of ['children', 'export']) {
    const held = pending(); let reads = 0;
    const api = createPrivacyApi({ fetchImpl: async url => {
      if (url === '/api/privacy/status') return response(status(++reads === 1 ? CONTEXT : NEXT_CONTEXT));
      return held.promise;
    } });
    try {
      await api.status();
      const old = action === 'children' ? api.children() : api.exportData({ accountContext: CONTEXT });
      const rejection = assert.rejects(old, rejected('STALE_PRIVACY_RESPONSE'));
      await api.status();
      held.resolve(response(action === 'children' ? children() : data())); await rejection;
      assert.throws(() => api.childStatus({ accountContext: NEXT_CONTEXT, childAccountId: 'child-one' }), rejected('INVALID_CHILD_SELECTION'));
    } finally { api.destroy(); }
  }
});

test('child and guardian GET lists require the remembered status context and reject a switched cookie account', async () => {
  for (const method of ['children', 'guardianRequests']) {
    let cookieContext = CONTEXT, count = 0;
    const api = createPrivacyApi({ fetchImpl: async (url, options) => {
      count++;
      if (url === '/api/privacy/status') {
        assert.equal(options.headers['X-Haru-Account'], undefined);
        return response(status(cookieContext));
      }
      assert.equal(options.method, 'GET');
      assert.ok(CONTEXT === options.headers['X-Haru-Account'] || NEXT_CONTEXT === options.headers['X-Haru-Account']);
      if (options.headers['X-Haru-Account'] !== cookieContext) return response({ code: 'ACCOUNT_CHANGED' }, 409);
      return response(method === 'children' ? children() : { requests: [] });
    } });
    try {
      await assert.rejects(api[method](), rejected('PRIVACY_NOT_READY'));
      assert.equal(count, 0);
      await api.status();
      cookieContext = NEXT_CONTEXT;
      await assert.rejects(api[method](), error => error.status === 409 && error.code === 'ACCOUNT_CHANGED');
      const requests = count;
      await assert.rejects(api[method](), rejected('PRIVACY_NOT_READY'));
      assert.equal(count, requests);
      await api.status();
      const result = await api[method]();
      assert.ok(method === 'children' ? result.children.length === 1 : result.requests.length === 0);
    } finally { api.destroy(); }
  }
});

test('a guardian request list started before account refresh cannot expose its delayed result', async () => {
  const held = pending(); let readCount = 0;
  const api = createPrivacyApi({ fetchImpl: async (url, options) => {
    if (url === '/api/privacy/status') return response(status(++readCount === 1 ? CONTEXT : NEXT_CONTEXT));
    assert.equal(options.headers['X-Haru-Account'], CONTEXT);
    return held.promise;
  } });
  try {
    await api.status();
    const old = api.guardianRequests();
    const rejection = assert.rejects(old, rejected('STALE_PRIVACY_RESPONSE'));
    await api.status();
    held.resolve(response({ requests: [{ requestId: 'old-private-request', status: 'pending', createdAt: NOW, expiresAt: NOW + 1000, policyVersion: 'v1' }] }));
    await rejection;
  } finally { api.destroy(); }
});
