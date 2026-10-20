import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveObjectURL } from 'node:buffer';
import { releaseHarness, reply } from './helpers/release-controller-harness.mjs';
import { auditMarkup } from './helpers/markup-source.mjs';
import { CATALOG, DEFAULT_EQUIPPED } from '../public/game/state.js';

const NOW = Date.parse('2026-10-20T00:00:00Z'), DAY = '2026-10-20';
const CHILD = 'verified-child-account', CHILD_LABEL = '관리하는 별토끼';
const OLD_CONTEXT = 'a'.repeat(64), NEW_CONTEXT = 'b'.repeat(64);
const active = () => ({ state: 'active', deletion: null });
const pendingDeletion = () => ({
  state: 'deletion_pending',
  deletion: { requestId: 'deletion-receipt', status: 'pending', requestedAt: NOW, completedAt: null, awaitingPolicy: true },
});
const snapshot = (playerId = 'player-a') => ({
  serverNow: NOW, today: DAY,
  state: {
    playerId, name: playerId === 'player-a' ? '현재 계정 토끼' : '다른 계정 토끼',
    coins: 380, owned: CATALOG.filter(item => item.cost === 0).map(item => item.id), equipped: { ...DEFAULT_EQUIPPED },
    results: [], practiceHistory: [], practiceUsage: {}, awards: {}, active: null, createdAt: DAY,
    todayFields: ['logic', 'math', 'spatial', 'language', 'memory'],
    totals: { dailyCount: 0, questionCount: 0, correctCount: 0, practiceCount: 0 },
    ranking: { week: '2026-10-19', rows: [], me: null, rank: null, total: 0, participated: false, correct: 0, score: 0, totalTimeMs: null },
  },
});
const exportFixture = child => ({
  format: 'haru-five-rights-export-v1', exportedAt: new Date(NOW).toISOString(),
  profile: { displayName: child ? CHILD_LABEL : '현재 계정 토끼' }, access: active(),
  results: [], attempts: [], coinLedger: [], weeklyAwards: [], linkedProviders: [],
});
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}
async function until(check, message) {
  for (let i = 0; i < 120; i++) { if (check()) return; await Promise.resolve(); }
  assert.ok(check(), message);
}
const privacyCalls = h => h.calls.filter(call => /^\/api\/(?:privacy|guardian)\//.test(call.url));
const writes = (h, operation) => privacyCalls(h).filter(call => call.options.method === 'POST' && (!operation || call.url === '/api/privacy/' + operation));
const checkMarkup = h => assert.deepEqual(auditMarkup(h.markup()).issues, []);

async function fixture({ hash = '', authenticated = true, intercept = null, children = null } = {}) {
  const control = {
    authenticated, playerId: 'player-a', context: OLD_CONTEXT,
    children: children ?? [{ childAccountId: CHILD, label: CHILD_LABEL, ...active() }],
    selfRecoveryReady: false, capabilities: { selfExport: true, childManagement: true, selfClosure: false, guardianEnrollment: false },
  };
  const status = () => ({
    accountContext: control.context, playerId: control.playerId, account: active(),
    guardian: { guardianReady: false, providerConfigured: false, enrollmentOpen: false },
    selfRecoveryReady: control.selfRecoveryReady, capabilities: { ...control.capabilities },
  });
  const normal = call => {
    assert.equal(call.options.credentials, 'same-origin');
    assert.equal(call.options.cache, 'no-store');
    assert.equal(call.options.redirect, 'error');
    if (call.url === '/api/privacy/status' && call.options.method === 'GET') return reply(status());
    if (call.url === '/api/privacy/children') return reply({ children: structuredClone(control.children), hasMore: false });
    assert.equal(call.options.headers['X-Haru-Account'], control.context);
    const child = control.children.find(item => item.childAccountId === call.body?.childAccountId);
    if (call.url === '/api/privacy/export') return reply(exportFixture(!!child));
    if (call.url === '/api/privacy/status') {
      assert.ok(child); return reply({ state: child.state, deletion: child.deletion });
    }
    if (call.url === '/api/privacy/withdraw' || call.url === '/api/privacy/delete') {
      assert.ok(child, 'self closure must never be sent by this UI');
      const operation = call.url.split('/').at(-1);
      assert.deepEqual(call.body, { childAccountId: child.childAccountId, confirmation: operation });
      Object.assign(child, operation === 'withdraw' ? { state: 'withdrawn', deletion: null } : pendingDeletion());
      return reply({ state: child.state, deletion: child.deletion });
    }
    throw new Error(`Unexpected privacy endpoint: ${call.url}`);
  };
  const h = await releaseHarness({
    hash,
    handler: () => control.authenticated ? reply(snapshot(control.playerId)) : reply({ code: 'SIGN_IN_REQUIRED', message: '로그인해 주세요.' }, 401),
    authHandler: call => {
      if (call.url === '/api/auth/logout') { control.authenticated = false; return reply({ ok: true }); }
      assert.equal(call.url, '/api/auth/status');
      return reply({
        authenticated: control.authenticated, sites: { enabled: false },
        account: control.authenticated ? { provider: 'google', linkedProviders: ['google'] } : null,
        providers: ['kakao', 'google', 'naver'].map(id => ({ id, enabled: false, reason: 'not_configured' })),
        registration: { open: false },
      });
    },
    privacyHandler: call => intercept?.(call, { control, status, normal }) ?? normal(call),
  });
  return { h, control, status };
}
async function openPrivacy(h) {
  await h.click('nav', { view: 'profile' });
  await h.click('privacy-open');
}
async function selectChild(h) {
  await openPrivacy(h);
  await h.click('privacy-child', { child: CHILD });
}

test('public privacy and guardian destinations explain readiness without collecting data', async () => {
  for (const hash of ['#privacy', '#guardian']) {
    const { h } = await fixture({ hash, authenticated: false });
    try {
      assert.match(h.app.innerHTML, /limjm900202@gmail\.com/);
      assert.match(h.app.innerHTML, /준비/);
      assert.equal(privacyCalls(h).length, 0);
      assert.equal(h.app.querySelectorAll('input').length, 0);
      assert.equal(h.app.querySelectorAll('textarea').length, 0);
      assert.equal(h.writes.length, 0);
      if (hash === '#guardian') {
        assert.equal(h.app.querySelector('[data-action="guardian-start"]').disabled, true);
        assert.equal(await h.click('guardian-start'), false);
      }
      checkMarkup(h);
    } finally { h.restore(); }
  }
});

test('opening information management shows loading then fetches fresh status before the child list', async () => {
  const gate = deferred();
  const { h, status } = await fixture({ intercept: call => call.url === '/api/privacy/status' && call.options.method === 'GET' ? gate.promise : undefined });
  let opened;
  try {
    await h.click('nav', { view: 'profile' });
    opened = h.click('privacy-open');
    await until(() => privacyCalls(h).length > 0, 'opening must request fresh status');
    assert.match(h.app.innerHTML, /확인|불러오|준비/);
    assert.doesNotMatch(h.app.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(privacyCalls(h).length, 1);
    gate.resolve(reply(status())); await opened;
    assert.deepEqual(privacyCalls(h).map(call => [call.url, call.options.method]), [
      ['/api/privacy/status', 'GET'], ['/api/privacy/children', 'GET'],
    ]);
    assert.match(h.app.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(h.app.querySelector('[data-action="privacy-self-delete"]').disabled, true);
    assert.equal(await h.click('privacy-self-delete'), false);
    assert.equal(writes(h).length, 0); assert.equal(h.writes.length, 0);
    checkMarkup(h);
  } finally { gate.resolve(reply(status())); await opened; h.restore(); }
});

test('own export rechecks the current account and child list before downloading a rights file', async () => {
  const { h } = await fixture();
  try {
    await openPrivacy(h); await h.click('privacy-export', { target: 'self' });
    assert.equal(h.downloads.length, 1);
    assert.deepEqual(writes(h, 'export').map(call => call.body), [{}]);
    const calls = privacyCalls(h);
    assert.deepEqual(calls.slice(-2).map(call => [call.url, call.options.method]), [
      ['/api/privacy/status', 'GET'], ['/api/privacy/children', 'GET'],
    ]);
    const file = resolveObjectURL(h.downloads[0].url);
    assert.ok(file);
    assert.deepEqual(JSON.parse(await file.text()), exportFixture(false));
    assert.match(h.downloads[0].filename, /\.json$/);
    assert.equal(h.writes.length, 0);
    checkMarkup(h);
  } finally { for (const item of h.downloads) URL.revokeObjectURL(item.url); h.restore(); }
});

test('verified child selection scopes export and requires separate confirmation for withdrawal and deletion', async () => {
  const { h } = await fixture();
  try {
    await selectChild(h);
    await h.click('privacy-export', { target: 'child' });
    assert.deepEqual(writes(h, 'export').map(call => call.body), [{ childAccountId: CHILD }]);
    assert.equal(h.downloads.length, 1);
    await h.click('privacy-withdraw');
    assert.equal(h.modal.open, true); assert.match(h.modal.innerHTML, new RegExp(CHILD_LABEL));
    assert.match(h.modal.innerHTML, /철회/); assert.equal(writes(h, 'withdraw').length, 0);
    checkMarkup(h);
    await h.click('close-modal', {}, true);
    assert.equal(writes(h, 'withdraw').length, 0);
    await h.click('privacy-withdraw');
    await h.click('privacy-confirm', { operation: 'withdraw' }, true);
    assert.equal(writes(h, 'withdraw').length, 1);
    assert.match(h.app.innerHTML, /동의를 철회했어요/);
    await h.click('privacy-delete');
    assert.equal(h.modal.open, true); assert.match(h.modal.innerHTML, new RegExp(CHILD_LABEL));
    assert.match(h.modal.innerHTML, /삭제/); assert.match(h.modal.innerHTML, /접수|대기|완료되지/);
    assert.equal(writes(h, 'delete').length, 0);
    await h.click('privacy-confirm', { operation: 'delete' }, true);
    assert.equal(writes(h, 'delete').length, 1);
    assert.match(h.app.innerHTML, /삭제 요청을 접수했어요/);
    assert.doesNotMatch(h.app.innerHTML, /삭제를 완료했어요|삭제 완료됐|삭제되었습니다/);
    assert.equal(h.writes.length, 0);
    checkMarkup(h);
  } finally { for (const item of h.downloads) URL.revokeObjectURL(item.url); h.restore(); }
});

test('an uncertain deletion response is checked through reads and never automatically submitted again', async () => {
  const { h } = await fixture({ intercept: (call, { normal }) => {
    if (call.url !== '/api/privacy/delete') return undefined;
    normal(call); throw new TypeError('response lost after server commit');
  } });
  try {
    await selectChild(h); await h.click('privacy-delete');
    await h.click('privacy-confirm', { operation: 'delete' }, true);
    assert.equal(writes(h, 'delete').length, 1);
    assert.match(h.app.innerHTML, /확인하지 못|확인할 수 없|처리 결과/);
    assert.ok(h.app.querySelector('[data-action="privacy-refresh"]'));
    await h.click('privacy-refresh'); await h.focus(); await h.advance(60000);
    assert.equal(writes(h, 'delete').length, 1);
    assert.equal(h.downloads.length, 0);
    assert.doesNotMatch(h.app.innerHTML, /삭제를 완료했어요|삭제되었습니다/);
    checkMarkup(h);
  } finally { h.restore(); }
});

test('an old information response cannot restore a screen after navigation', async () => {
  const gate = deferred();
  const { h, status } = await fixture({ intercept: call => call.url === '/api/privacy/status' && call.options.method === 'GET' ? gate.promise : undefined });
  let opened;
  try {
    await h.click('nav', { view: 'profile' }); opened = h.click('privacy-open');
    await until(() => privacyCalls(h).length > 0);
    await h.click('nav', { view: 'home' });
    gate.resolve(reply(status())); await opened;
    assert.equal(location.hash, '#home');
    assert.doesNotMatch(h.app.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(privacyCalls(h).filter(call => call.url === '/api/privacy/children').length, 0);
    assert.equal(h.downloads.length, 0); assert.equal(h.modal.open, false);
  } finally { gate.resolve(reply(status())); await opened; h.restore(); }
});

test('a status for a different public player never exposes that account children', async () => {
  const { h } = await fixture({ intercept: (call, { status }) => call.url === '/api/privacy/status' && call.options.method === 'GET'
    ? reply({ ...status(), playerId: 'player-b' }) : undefined });
  try {
    await openPrivacy(h);
    assert.doesNotMatch(h.app.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(privacyCalls(h).filter(call => call.url === '/api/privacy/children').length, 0);
    assert.equal(writes(h).length, 0);
    assert.match(h.app.innerHTML, /다시|바뀌|확인/);
  } finally { h.restore(); }
});

test('switching accounts during export blocks the old download and any child action', async () => {
  const gate = deferred();
  const { h, control } = await fixture({ intercept: call => call.url === '/api/privacy/export' ? gate.promise : undefined });
  let exporting;
  try {
    await selectChild(h); exporting = h.click('privacy-export', { target: 'child' });
    await until(() => writes(h, 'export').length === 1);
    control.playerId = 'player-b'; control.context = NEW_CONTEXT; control.children = [];
    await h.focus();
    gate.resolve(reply(exportFixture(true))); await exporting;
    assert.equal(h.downloads.length, 0);
    assert.doesNotMatch(h.app.innerHTML + h.modal.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(writes(h, 'withdraw').length + writes(h, 'delete').length, 0);
  } finally { gate.resolve(reply(exportFixture(true))); await exporting; h.restore(); }
});

test('the final export account-context recheck rejects a session change even before game state refreshes', async () => {
  let statusReads = 0;
  const { h, control } = await fixture({ intercept: (call, { status }) => {
    if (call.url === '/api/privacy/status' && call.options.method === 'GET') {
      statusReads++;
      if (statusReads > 1) return reply({ ...status(), accountContext: NEW_CONTEXT });
    }
    return undefined;
  } });
  try {
    await openPrivacy(h); await h.click('privacy-export', { target: 'self' });
    assert.equal(control.context, OLD_CONTEXT);
    assert.equal(h.downloads.length, 0);
    assert.ok(statusReads >= 2);
    assert.match(h.app.innerHTML, /바뀌|다시|확인/);
    assert.equal(writes(h, 'export').length, 1);
  } finally { h.restore(); }
});

test('an account switch closes an outstanding child confirmation and rejects a queued old confirmation event', async () => {
  const { h, control } = await fixture();
  try {
    await selectChild(h); await h.click('privacy-delete');
    const oldConfirm = h.modal.querySelector('[data-action="privacy-confirm"]');
    assert.ok(oldConfirm);
    control.playerId = 'player-b'; control.context = NEW_CONTEXT; control.children = [];
    await h.focus();
    assert.equal(h.modal.open, false);
    await h.modal.fire('click', { target: oldConfirm });
    assert.equal(writes(h, 'delete').length, 0);
    assert.doesNotMatch(h.app.innerHTML + h.modal.innerHTML, new RegExp(CHILD_LABEL));
  } finally { h.restore(); }
});

test('logout during an outstanding export keeps the response out of the screen and downloads', async () => {
  const gate = deferred();
  const { h } = await fixture({ intercept: call => call.url === '/api/privacy/export' ? gate.promise : undefined });
  let exporting;
  try {
    await openPrivacy(h); exporting = h.click('privacy-export', { target: 'self' });
    await until(() => writes(h, 'export').length === 1);
    await h.click('auth-logout');
    gate.resolve(reply(exportFixture(false))); await exporting;
    assert.equal(h.downloads.length, 0);
    assert.doesNotMatch(h.app.innerHTML + h.modal.innerHTML, /현재 계정 토끼|관리하는 별토끼/);
    assert.equal(h.modal.open, false); assert.equal(h.writes.length, 0);
  } finally { gate.resolve(reply(exportFixture(false))); await exporting; h.restore(); }
});

test('hiding the page invalidates an outstanding export without replaying a sensitive request', async () => {
  const gate = deferred();
  const { h } = await fixture({ intercept: call => call.url === '/api/privacy/export' ? gate.promise : undefined });
  let exporting;
  try {
    await selectChild(h); exporting = h.click('privacy-export', { target: 'child' });
    await until(() => writes(h, 'export').length === 1);
    h.document.hidden = true; await h.document.fire('visibilitychange');
    gate.resolve(reply(exportFixture(true))); await exporting;
    assert.equal(h.downloads.length, 0); assert.equal(h.modal.open, false);
    assert.doesNotMatch(h.app.innerHTML + h.modal.innerHTML, new RegExp(CHILD_LABEL));
    assert.equal(writes(h, 'export').length, 1);
  } finally { gate.resolve(reply(exportFixture(true))); await exporting; h.restore(); }
});

test('Escape and outside-click dismissal invalidate the previous child confirmation', async () => {
  for (const dismiss of ['escape', 'outside']) {
    const { h } = await fixture();
    try {
      await selectChild(h); await h.click('privacy-delete');
      const oldConfirm = h.modal.querySelector('[data-action="privacy-confirm"]');
      if (dismiss === 'escape') {
        await h.modal.fire('cancel', { preventDefault() {} });
        h.modal.close(); // Native dialog dismissal follows an uncancelled Escape event.
      } else await h.modal.fire('click', { target: h.modal, clientX: -1, clientY: -1 });
      assert.equal(h.modal.open, false);
      await h.modal.fire('click', { target: oldConfirm });
      assert.equal(writes(h, 'delete').length, 0, dismiss + ' must cancel the outstanding approval');
      await h.click('privacy-delete');
      assert.equal(h.modal.open, true);
      assert.equal(writes(h, 'delete').length, 0, 'a new approval is required after dismissal');
      checkMarkup(h);
    } finally { h.restore(); }
  }
});

test('destroying the controller invalidates an outstanding export', async () => {
  const gate = deferred();
  const { h } = await fixture({ intercept: call => call.url === '/api/privacy/export' ? gate.promise : undefined });
  let exporting, restored = false;
  try {
    await openPrivacy(h); exporting = h.click('privacy-export', { target: 'self' });
    await until(() => writes(h, 'export').length === 1);
    h.restore(); restored = true;
    gate.resolve(reply(exportFixture(false))); await exporting;
    assert.equal(h.downloads.length, 0);
  } finally { gate.resolve(reply(exportFixture(false))); await exporting; if (!restored) h.restore(); }
});

test('child labels are escaped and raw provider availability never enables unfinished enrollment or self closure', async () => {
  const { h, control } = await fixture({ children: [{ childAccountId: CHILD, label: '<img src=x onerror=alert(1)>', ...active() }] });
  try {
    control.capabilities.selfClosure = true;
    await openPrivacy(h);
    assert.equal(h.app.querySelector('[data-action="privacy-self-delete"]').disabled, true);
    assert.doesNotMatch(h.app.innerHTML, /<img src=x/);
    assert.match(h.app.innerHTML, /&lt;img/);
    await h.click('guardian-open');
    assert.equal(h.app.querySelector('[data-action="guardian-start"]').disabled, true);
    assert.equal(writes(h).length, 0); assert.equal(h.app.querySelectorAll('input').length, 0);
    checkMarkup(h);
  } finally { h.restore(); }
});
