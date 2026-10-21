import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createGameService, GameError } from '../server/game-service.mjs';
import { handleGameRequest } from '../server/http.mjs';
import { AUTH_COOKIES, resolveGameIdentity } from '../server/auth-service.mjs';
import { createAccountLifecycle } from '../server/account-lifecycle.mjs';

const ORIGIN = 'https://haru-five.example.test';
const START_TIME = Date.parse('2026-10-20T09:00:00+09:00');
const TEST_PURGE_POLICY = {
  version: 1,
  policyId: 'integration-test-policy',
  eraseGameAndAccountData: true,
  eraseGuardianEvidence: true,
  retainMinimalClosureRecords: true,
  closureRetention: 'integration test closure retention',
  receiptRetention: 'integration test receipt retention',
  backupReplayProcedure: 'integration test restores must reapply account closures',
};

function fixture(t) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let timestamp = START_TIME;
  let serial = 0;
  const now = () => timestamp;
  const uuid = () => `privacy-integration-${String(++serial).padStart(12, '0')}`;
  const f = {
    db, now,
    game: createGameService({ db, now, uuid }),
    lifecycle: createAccountLifecycle({ db, now, uuid, purgePolicy: TEST_PURGE_POLICY }),
    tick(ms = 1000) { timestamp += ms; },
    setTime(value) { timestamp = value; },
    request(input = {}) { return { ...input, requestId: uuid() }; },
    account(id, state = 'active') {
      db.sqlite.prepare('INSERT INTO auth_accounts (id, created_at) VALUES (?, ?)').run(id, timestamp);
      if (state !== null) db.sqlite.prepare(
        'INSERT INTO privacy_account_controls (account_id, state, updated_at) VALUES (?, ?, ?)',
      ).run(id, state, timestamp);
      return id;
    },
    session(accountId, fill = 7) {
      const token = Buffer.alloc(32, fill).toString('base64url');
      const hash = createHash('sha256').update(token).digest('hex');
      db.sqlite.prepare(`INSERT INTO auth_sessions
        (token_hash, account_id, provider, created_at, expires_at)
        VALUES (?, ?, 'google', ?, ?)`).run(hash, accountId, timestamp, timestamp + 86400000);
      return {
        hash,
        request: new Request(`${ORIGIN}/`, { headers: { Cookie: `${AUTH_COOKIES.session}=${token}` } }),
      };
    },
  };
  return f;
}

function expectRestricted(error) {
  return error instanceof GameError && error.status === 403 && error.code === 'ACCOUNT_RESTRICTED';
}

function beforeNext(db, hook, predicate, intervention) {
  let fired = false;
  db[hook] = async input => {
    if (!predicate(input)) return;
    fired = true;
    db[hook] = null;
    await intervention();
  };
  return () => assert.equal(fired, true, 'The request must reach the intended transaction boundary');
}

function privateAttempt(f, id) {
  const row = f.db.rows('SELECT * FROM game_attempts WHERE id = ?', id)[0];
  return { row, active: row && JSON.parse(row.payload) };
}

async function ready(f, userId, response) {
  let current = response;
  if (current.state.active.phase === 'ready') {
    current = await f.game.memory(userId, f.request({
      attemptId: current.state.active.id,
      questionId: current.state.active.currentQuestionId,
    }));
  }
  if (current.state.active.phase === 'memorizing') {
    f.setTime(current.state.active.memoryUntil);
    current = await f.game.bootstrap(userId);
  }
  return current;
}

async function advance(f, userId, response, { correct = true } = {}) {
  const current = await ready(f, userId, response);
  const active = current.state.active;
  const question = privateAttempt(f, active.id).active.questions[active.index];
  f.tick();
  return f.game.answer(userId, f.request({
    attemptId: active.id, questionId: active.currentQuestionId, index: active.index,
    selected: correct ? question.answer : (question.answer + 1) % 4,
  }));
}

async function complete(f, userId, correct = 5) {
  let response = await f.game.start(userId, f.request({ mode: 'daily' }));
  while (response.state.active) {
    response = await advance(f, userId, response, { correct: response.state.active.index < correct });
  }
  return response;
}

async function closeAccount(f, accountId, mode) {
  const input = { actorId: accountId, accountId };
  if (mode === 'withdrawn') await f.lifecycle.withdraw(input);
  else {
    await f.lifecycle.requestDeletion(input);
    if (mode === 'deleted') await f.lifecycle.processDeletionJobs({ limit: 25 });
  }
  assert.equal(f.db.rows(
    'SELECT state FROM privacy_account_controls WHERE account_id = ?', accountId,
  )[0]?.state, mode);
}

test('withdrawal between a final-answer read and CAS prevents result, coins and receipt writes', async t => {
  const f = fixture(t);
  const userId = f.account('final-answer-account');
  let response = await f.game.start(userId, f.request({ mode: 'daily' }));
  while (response.state.active.index < 4) response = await advance(f, userId, response);
  response = await ready(f, userId, response);
  const active = response.state.active;
  const question = privateAttempt(f, active.id).active.questions[4];
  const input = f.request({
    attemptId: active.id, questionId: active.currentQuestionId, index: 4, selected: question.answer,
  });
  f.tick();
  const assertIntervened = beforeNext(f.db, 'beforeBatch',
    statements => statements.some(statement => statement.sql.includes('INSERT INTO game_results')
      && statement.values.includes(active.id)),
    () => closeAccount(f, userId, 'withdrawn'));

  await assert.rejects(f.game.answer(userId, input), expectRestricted);
  assertIntervened();
  assert.equal(f.db.rows('SELECT * FROM game_results WHERE user_id = ?', userId).length, 0);
  assert.equal(f.db.rows(
    "SELECT * FROM game_coin_ledger WHERE user_id = ? AND reason = 'daily'", userId,
  ).length, 0);
  assert.equal(f.db.rows(
    'SELECT * FROM game_mutation_receipts WHERE user_id = ? AND request_id = ?', userId, input.requestId,
  ).length, 0);
  assert.equal(f.db.rows('SELECT coins FROM game_players WHERE id = ?', userId)[0].coins, 180);
  assert.equal(privateAttempt(f, active.id).active.answers.length, 4);
});

test('withdrawal between a purchase read and CAS prevents debit, ownership and receipt writes', async t => {
  const f = fixture(t);
  const userId = f.account('purchase-account');
  await f.game.bootstrap(userId);
  const before = f.db.rows('SELECT coins, owned, equipped FROM game_players WHERE id = ?', userId)[0];
  const input = f.request({ itemId: 'outfit-lilac' });
  const assertIntervened = beforeNext(f.db, 'beforeBatch',
    statements => statements.some(statement => statement.sql.includes('INSERT INTO game_coin_ledger')
      && statement.values.includes('purchase:outfit-lilac')),
    () => closeAccount(f, userId, 'withdrawn'));

  await assert.rejects(f.game.purchase(userId, input), expectRestricted);
  assertIntervened();
  assert.deepEqual(f.db.rows('SELECT coins, owned, equipped FROM game_players WHERE id = ?', userId)[0], before);
  assert.equal(f.db.rows(
    "SELECT * FROM game_coin_ledger WHERE user_id = ? AND reason = 'purchase'", userId,
  ).length, 0);
  assert.equal(f.db.rows(
    'SELECT * FROM game_mutation_receipts WHERE user_id = ? AND request_id = ?', userId, input.requestId,
  ).length, 0);
});

for (const mode of ['withdrawn', 'deletion_pending', 'deleted']) {
  test(`${mode} committed after bootstrap starts prevents profile recreation and welcome grants`, async t => {
    const f = fixture(t);
    const userId = f.account(`profile-${mode}`);
    const assertIntervened = beforeNext(f.db, 'beforeBatch',
      statements => statements.some(statement => statement.sql.includes('INSERT OR IGNORE INTO game_players')
        && statement.values.includes(userId)),
      () => closeAccount(f, userId, mode));

    await assert.rejects(f.game.bootstrap(userId), expectRestricted);
    assertIntervened();
    assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', userId).length, 0);
    assert.equal(f.db.rows('SELECT * FROM game_coin_ledger WHERE user_id = ?', userId).length, 0);
    await assert.rejects(f.game.bootstrap(userId), expectRestricted);
    assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', userId).length, 0);
  });
}

test('deletion before a queued HTTP quota write prevents recreation of rate-limit and game rows', async t => {
  const f = fixture(t);
  const userId = f.account('quota-account');
  const first = await handleGameRequest(new Request(`${ORIGIN}/api/game/bootstrap`), {
    action: 'bootstrap', userId, db: f.db, now: f.now,
  });
  assert.equal(first.status, 200);
  assert.equal(f.db.rows('SELECT * FROM game_rate_limits WHERE user_id = ?', userId).length, 1);
  const assertIntervened = beforeNext(f.db, 'beforeQuery',
    ({ sql, values }) => sql.includes('INSERT INTO game_rate_limits') && values.includes(userId),
    () => closeAccount(f, userId, 'deleted'));

  const response = await handleGameRequest(new Request(`${ORIGIN}/api/game/bootstrap`), {
    action: 'bootstrap', userId, db: f.db, now: f.now,
  });
  assertIntervened();
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'ACCOUNT_RESTRICTED');
  assert.equal(f.db.rows('SELECT * FROM game_rate_limits WHERE user_id = ?', userId).length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', userId).length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_coin_ledger WHERE user_id = ?', userId).length, 0);
});

test('withdrawal immediately before rank aggregation excludes the account and weekly awards', async t => {
  const f = fixture(t);
  const retiring = f.account('retiring-ranked-account');
  const remaining = f.account('remaining-ranked-account');
  const retiredResult = await complete(f, retiring, 5);
  const activeResult = await complete(f, remaining, 3);
  assert.equal(activeResult.state.ranking.total, 2);
  assert.equal(activeResult.state.ranking.me.rank, 2);
  const assertIntervened = beforeNext(f.db, 'beforeBatch',
    statements => statements.some(statement => statement.sql.includes('FROM ranked r')),
    () => closeAccount(f, retiring, 'withdrawn'));

  const current = await f.game.bootstrap(remaining);
  assertIntervened();
  assert.equal(current.state.ranking.total, 1);
  assert.equal(current.state.ranking.me.rank, 1);
  assert.deepEqual(current.state.ranking.rows.map(row => row.id), [activeResult.state.playerId]);
  assert.ok(!current.state.ranking.rows.some(row => row.id === retiredResult.state.playerId));
  // Withdrawal retains game records until deletion, so exclusion must be a
  // server-side eligibility check, not an accidental consequence of purging.
  assert.equal(f.db.rows('SELECT * FROM game_results WHERE user_id = ?', retiring).length, 1);
  f.setTime(Date.parse('2026-10-26T00:00:01+09:00'));
  const settled = await f.game.bootstrap(remaining);
  assert.equal(settled.state.awards['2026-10-19'].total, 1);
  assert.equal(settled.state.awards['2026-10-19'].rank, 1);
  assert.equal(f.db.rows('SELECT * FROM game_weekly_awards WHERE user_id = ?', retiring).length, 0);
});

test('withdrawal invalidates an existing opaque session while another account remains signed in', async t => {
  const f = fixture(t);
  const closing = f.account('closing-session-account');
  const remaining = f.account('remaining-session-account');
  const closedSession = f.session(closing, 3);
  const liveSession = f.session(remaining, 4);
  const options = { db: f.db, now: f.now };
  assert.equal((await resolveGameIdentity(closedSession.request, options)).userId, closing);

  await closeAccount(f, closing, 'withdrawn');
  assert.equal(await resolveGameIdentity(closedSession.request, options), null);
  assert.equal((await resolveGameIdentity(liveSession.request, options)).userId, remaining);
  assert.notEqual(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', closedSession.hash)[0].revoked_at, null);
});

test('non-active controls reject still-live sessions and profiles even before revocation cleanup', async t => {
  const f = fixture(t);
  for (const [index, state] of ['pending', 'withdrawn', 'deletion_pending', 'deleted'].entries()) {
    const userId = f.account(`controlled-${state}`, state);
    const session = f.session(userId, 10 + index);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, null);
    assert.equal(await resolveGameIdentity(session.request, { db: f.db, now: f.now }), null, state);
    await assert.rejects(f.game.bootstrap(userId), expectRestricted);
    assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', userId).length, 0, state);
    assert.equal(f.db.rows('SELECT * FROM game_coin_ledger WHERE user_id = ?', userId).length, 0, state);
  }
});

test('disabled auth accounts cannot recreate profiles while eligible legacy accounts still work', async t => {
  const f = fixture(t);
  const disabled = f.account('disabled-without-control', null);
  f.db.sqlite.prepare('UPDATE auth_accounts SET disabled_at = ? WHERE id = ?').run(f.now(), disabled);
  await assert.rejects(f.game.bootstrap(disabled), expectRestricted);
  assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', disabled).length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_coin_ledger WHERE user_id = ?', disabled).length, 0);
  const legacy = await f.game.bootstrap('eligible-legacy-account');
  assert.equal(legacy.state.coins, 180);
  assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', 'eligible-legacy-account').length, 1);
});
