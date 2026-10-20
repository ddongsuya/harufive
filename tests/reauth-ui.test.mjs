import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';

const NOW = Date.parse('2026-10-20T00:00:00Z'), DAY = '2026-10-20', CONTEXT = 'a'.repeat(64);
const REAUTH_URL = 'https://kauth.kakao.com/oauth/authorize?response_type=code&state=fixture-state&nonce=fixture-nonce&code_challenge_method=S256&code_challenge=fixture-challenge&max_age=0&prompt=login';
const snapshot = playerId => ({
  serverNow: NOW, today: DAY, state: {
    playerId, name: playerId === 'player-a' ? '기존 계정 토끼' : '바뀐 계정 토끼', coins: 380,
    owned: CATALOG.filter(item => item.cost === 0).map(item => item.id), equipped: { ...DEFAULT_EQUIPPED },
    results: [], practiceHistory: [], practiceUsage: {}, awards: {}, active: null, createdAt: DAY,
    todayFields: ['logic', 'math', 'spatial', 'language', 'memory'],
    totals: { dailyCount: 0, questionCount: 0, correctCount: 0, practiceCount: 0 },
    ranking: { week: '2026-10-19', rows: [], me: null, rank: null, total: 0, participated: false, correct: 0, score: 0, totalTimeMs: null },
  },
});
function deferred() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
async function until(check) { for (let i = 0; i < 120; i++) { if (check()) return; await Promise.resolve(); } assert.ok(check()); }
const starts = h => h.calls.filter(call => call.url.endsWith('/start') && call.body?.intent === 'reauth');
const sensitive = h => h.calls.filter(call => /^\/api\/privacy\/(?:delete|withdraw|export)$/.test(call.url));
const markup = h => assert.deepEqual(auditMarkup(h.markup()).issues, []);

async function fixture({ enabled = false, fresh = false, hash = '', search = '', startHandler = null, reauthPlayerId = 'player-a' } = {}) {
  const control = { enabled, fresh, playerId: 'player-a', reauthPlayerId, context: CONTEXT, authenticated: true };
  const h = await releaseHarness({
    hash, search,
    handler: () => control.authenticated ? reply(snapshot(control.playerId)) : reply({ code: 'SIGN_IN_REQUIRED', message: '로그인해 주세요.' }, 401),
    authHandler: call => {
      if (call.url === '/api/auth/status') return reply({
        authenticated: control.authenticated, sites: { enabled: false },
        account: control.authenticated ? { provider: 'kakao', linkedProviders: ['kakao'] } : null,
        providers: ['google', 'kakao', 'naver'].map(id => ({ id, enabled: false, reason: 'not_configured' })),
        registration: { open: false },
        reauthentication: {
          enabled: control.enabled, accountContext: control.context, playerId: control.reauthPlayerId,
          providers: ['google', 'kakao', 'naver'].map(id => ({ id, enabled: control.enabled && id === 'kakao', reason: control.enabled && id === 'kakao' ? 'ready' : 'not_configured' })),
        },
      });
      if (call.url === '/api/auth/logout') { control.authenticated = false; return reply({ ok: true }); }
      assert.equal(call.url, '/api/auth/kakao/start');
      assert.deepEqual(call.body, { intent: 'reauth' });
      assert.equal(call.options.headers['X-Haru-Account'], control.context);
      return startHandler?.(call, control) ?? reply({ url: REAUTH_URL });
    },
    privacyHandler: call => {
      if (call.url === '/api/privacy/status' && call.options.method === 'GET') {
        if (!control.fresh) return reply({ code: 'REAUTH_REQUIRED', message: '최근 본인 확인이 필요해요.' }, 401);
        return reply({
          accountContext: control.context, playerId: control.playerId, account: { state: 'active', deletion: null },
          guardian: { guardianReady: false, providerConfigured: false, enrollmentOpen: false }, selfRecoveryReady: false,
          capabilities: { selfExport: true, childManagement: true, selfClosure: false, guardianEnrollment: false },
        });
      }
      assert.equal(call.url, '/api/privacy/children');
      return reply({ children: [], hasMore: false });
    },
  });
  return { h, control };
}
async function openPrivacy(h) { await h.click('nav', { view: 'profile' }); await h.click('privacy-open'); }
const reauthButton = (h, provider) => h.app.querySelectorAll('[data-action="auth-reauth"]').find(button => button.dataset.provider === provider);

test('stale privacy authentication keeps the existing game account and exposes disabled reauth guidance in standalone mode', async () => {
  const { h } = await fixture();
  try {
    await openPrivacy(h);
    assert.match(h.app.innerHTML, /본인 확인/);
    assert.match(h.app.innerHTML, /limjm900202@gmail\.com/);
    for (const provider of ['google', 'kakao', 'naver']) {
      assert.ok(reauthButton(h, provider)); assert.equal(reauthButton(h, provider).disabled, true);
      assert.equal(await h.click('auth-reauth', { provider }), false);
    }
    assert.equal(starts(h).length, 0); assert.equal(sensitive(h).length, 0);
    assert.equal(h.navigations.length, 0); assert.equal(h.writes.length, 0);
    assert.equal(h.app.querySelector('[data-action="privacy-self-delete"]').disabled, true);
    await h.click('nav', { view: 'profile' });
    assert.match(h.app.innerHTML, /기존 계정 토끼/); assert.match(h.app.innerHTML, /380/);
    markup(h);
  } finally { h.restore(); }
});

test('only an enabled linked reauth provider starts with explicit current-account context', async () => {
  const { h } = await fixture({ enabled: true });
  try {
    await openPrivacy(h);
    assert.equal(reauthButton(h, 'kakao').disabled, false);
    for (const provider of ['google', 'naver']) assert.equal(reauthButton(h, provider).disabled, true);
    await h.click('auth-reauth', { provider: 'kakao' });
    assert.equal(starts(h).length, 1);
    assert.deepEqual(h.navigations, [{ url: REAUTH_URL, target: '_top' }]);
    assert.equal(sensitive(h).length, 0); assert.equal(h.writes.length, 0);
    markup(h);
  } finally { h.restore(); }
});

test('reauth metadata for another game account cannot start an authorization redirect', async () => {
  const { h } = await fixture({ enabled: true, reauthPlayerId: 'player-b' });
  try {
    await openPrivacy(h);
    assert.equal(reauthButton(h, 'kakao').disabled, true);
    assert.equal(await h.click('auth-reauth', { provider: 'kakao' }), false);
    assert.equal(starts(h).length, 0); assert.equal(h.navigations.length, 0);
  } finally { h.restore(); }
});

test('the callback returns to privacy and rechecks permissions before enabling any operation', async () => {
  for (const fresh of [false, true]) {
    const { h } = await fixture({ enabled: true, fresh, hash: '#privacy', search: '?auth=reauthenticated' });
    try {
      assert.equal(location.search, ''); assert.equal(location.hash, '#privacy');
      assert.match(h.app.innerHTML, /본인 확인/); assert.match(h.app.innerHTML, /다시 확인/);
      const reads = h.calls.filter(call => call.url.startsWith('/api/privacy/'));
      assert.deepEqual(reads.map(call => call.url), fresh ? ['/api/privacy/status', '/api/privacy/children'] : ['/api/privacy/status']);
      assert.equal(h.app.querySelector('[data-action="privacy-export"]').disabled, !fresh);
      assert.equal(h.app.querySelector('[data-action="privacy-self-delete"]').disabled, true);
      assert.equal(starts(h).length, 0); assert.equal(sensitive(h).length, 0);
      assert.equal(h.navigations.length, 0); assert.equal(h.downloads.length, 0);
      markup(h);
    } finally { h.restore(); }
  }
});

test('an account-changed reauth start error leaves privacy operations unavailable and never opens a provider', async () => {
  const { h } = await fixture({ enabled: true, startHandler: () => reply({ code: 'ACCOUNT_CHANGED', message: '계정이 바뀌었어요. 다시 확인해 주세요.' }, 409) });
  try {
    await openPrivacy(h); await h.click('auth-reauth', { provider: 'kakao' });
    assert.equal(starts(h).length, 1); assert.equal(h.navigations.length, 0);
    assert.match(h.app.innerHTML + h.modal.innerHTML, /바뀌|다시 확인/);
    assert.equal(h.app.querySelector('[data-action="privacy-export"]').disabled, true);
    assert.equal(sensitive(h).length, 0);
    markup(h);
  } finally { h.restore(); }
});

test('returning after a cancelled reauth request reacquires auth context before an explicit new attempt', async () => {
  const gate = deferred(); let requests = 0;
  const { h } = await fixture({ enabled: true, startHandler: () => ++requests === 1 ? gate.promise : reply({ url: REAUTH_URL }) });
  let first;
  try {
    await openPrivacy(h); first = h.click('auth-reauth', { provider: 'kakao' });
    await until(() => starts(h).length === 1);
    await h.click('nav', { view: 'home' });
    gate.resolve(reply({ url: REAUTH_URL })); await first;
    assert.equal(h.navigations.length, 0);
    await openPrivacy(h);
    assert.equal(starts(h).length, 1, 're-entry alone must not restart provider authentication');
    await h.click('auth-reauth', { provider: 'kakao' });
    assert.equal(starts(h).length, 2);
    assert.deepEqual(h.navigations, [{ url: REAUTH_URL, target: '_top' }]);
    assert.ok(h.calls.filter(call => call.url === '/api/auth/status').length >= 2);
  } finally { gate.resolve(reply({ url: REAUTH_URL })); await first; h.restore(); }
});

test('a session or account change discovered on click blocks start before any provider request', async () => {
  for (const changed of ['context', 'player']) {
    const { h, control } = await fixture({ enabled: true });
    try {
      await openPrivacy(h);
      assert.equal(reauthButton(h, 'kakao').disabled, false);
      if (changed === 'context') control.context = 'b'.repeat(64);
      else control.reauthPlayerId = 'player-b';
      await h.click('auth-reauth', { provider: 'kakao' });
      assert.equal(starts(h).length, 0);
      assert.equal(h.navigations.length, 0);
      assert.equal(sensitive(h).length, 0);
      assert.match(h.app.innerHTML, /바뀌|다시|확인/);
    } finally { h.restore(); }
  }
});

for (const invalidation of ['navigation', 'hidden', 'account change', 'destroy']) {
  test(`a delayed reauth redirect is discarded after ${invalidation}`, async () => {
    const gate = deferred();
    const { h, control } = await fixture({ enabled: true, startHandler: () => gate.promise });
    let pending, restored = false;
    try {
      await openPrivacy(h); pending = h.click('auth-reauth', { provider: 'kakao' });
      await until(() => starts(h).length === 1);
      if (invalidation === 'navigation') await h.click('nav', { view: 'home' });
      if (invalidation === 'hidden') { h.document.hidden = true; await h.document.fire('visibilitychange'); }
      if (invalidation === 'account change') {
        control.playerId = 'player-b'; control.reauthPlayerId = 'player-b'; control.context = 'b'.repeat(64);
        await h.focus();
      }
      if (invalidation === 'destroy') { h.restore(); restored = true; }
      gate.resolve(reply({ url: REAUTH_URL })); await pending;
      assert.equal(h.navigations.length, 0);
      assert.equal(h.modal.open, false);
      assert.equal(sensitive(h).length, 0);
    } finally { gate.resolve(reply({ url: REAUTH_URL })); await pending; if (!restored) h.restore(); }
  });
}
