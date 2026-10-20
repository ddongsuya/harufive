import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameService, GameError } from '../server/game-service.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { calculatePerformance, dateKey, addDays } from '../legacy/v040/game-core.js';

function fixture(t, day = '2026-10-19') {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let timestamp = Date.parse(`${day}T09:00:00+09:00`), ids = 0, requests = 0;
  const service = createGameService({ db, now: () => timestamp, uuid: () => `opaque-${String(++ids).padStart(12, '0')}` });
  return {
    db, service,
    get now() { return timestamp; },
    set now(value) { timestamp = value; },
    tick(ms) { timestamp += ms; },
    request(values = {}) { return { ...values, requestId: `request-${String(++requests).padStart(10, '0')}` }; },
  };
}
function privateAttempt(f, id) {
  const row = f.db.rows('SELECT * FROM game_attempts WHERE id = ?', id)[0];
  return { row, active: JSON.parse(row.payload) };
}
async function ready(f, userId, response) {
  let current = response || await f.service.bootstrap(userId);
  if (current.state.active.phase === 'ready') {
    current = await f.service.memory(userId, f.request({ attemptId: current.state.active.id, questionId: current.state.active.currentQuestionId }));
  }
  if (current.state.active.phase === 'memorizing') {
    f.now = current.state.active.memoryUntil;
    current = await f.service.bootstrap(userId);
  }
  return current;
}
async function advance(f, userId, response, { correct = true, ms = 1000 } = {}) {
  const current = await ready(f, userId, response), attempt = current.state.active;
  const { active } = privateAttempt(f, attempt.id), question = active.questions[attempt.index];
  f.now = Math.max(f.now, attempt.issuedAt + ms);
  return f.service.answer(userId, f.request({ attemptId: attempt.id, questionId: question.id,
    index: attempt.index, selected: correct ? question.answer : (question.answer + 1) % 4 }));
}
async function complete(f, userId, { correct = 5, ms = 1000, mode = 'daily' } = {}) {
  let response = await f.service.start(userId, f.request({ mode }));
  while (response.state.active) {
    response = await advance(f, userId, response, { correct: response.state.active.index < correct, ms });
  }
  return response;
}
function expectCode(code) {
  return error => error instanceof GameError && error.code === code && error.status >= 400;
}
function verifyNoPrivateKeys(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    assert.ok(!['answer', 'explanation', 'solution', 'sourceId', 'templateId', 'seed', 'seedKey'].includes(key), `unexpected private key ${key}`);
    verifyNoPrivateKeys(child);
  }
}
function ledgerBalance(f, userId) {
  return f.db.rows('SELECT SUM(amount) AS balance FROM game_coin_ledger WHERE user_id = ?', userId)[0].balance;
}

test('authenticated profiles persist across devices and atomically receive one welcome grant and only a free rabbit', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.bootstrap(null), expectCode('AUTH_REQUIRED'));
  const responses = await Promise.all(Array.from({ length: 12 }, () => f.service.bootstrap('platform-private-user')));
  const first = responses[0];
  assert.equal(first.state.coins, 180);
  assert.deepEqual(first.state.owned.filter(id => id.startsWith('character-')), ['character-rabbit']);
  assert.equal(new Set(responses.map(response => response.state.playerId)).size, 1);
  assert.ok(!JSON.stringify(first).includes('platform-private-user'));
  assert.equal(f.db.rows("SELECT * FROM game_coin_ledger WHERE reference = 'welcome'").length, 1);
  assert.equal(ledgerBalance(f, 'platform-private-user'), 180);
  assert.equal(first.state.ranking.total, 0);
  assert.deepEqual(first.state.ranking.rows, []);
  const anotherDevice = createGameService({ db: f.db, now: () => f.now });
  const same = await anotherDevice.bootstrap('platform-private-user');
  assert.equal(same.state.playerId, first.state.playerId);
  assert.equal(same.state.coins, 180);
  await assert.rejects(f.service.equip('platform-private-user', f.request({ itemId: 'character-cat' })), expectCode('ITEM_NOT_OWNED'));
});

test('one server-generated daily attempt, no future questions or secret metadata, and no local result import', async t => {
  const f = fixture(t);
  const attempts = await Promise.all(Array.from({ length: 12 }, () => f.service.start('alice', f.request({ mode: 'daily', coins: 999999, score: 5099, date: '2099-01-01' }))));
  const response = attempts[0], active = response.state.active;
  assert.equal(new Set(attempts.map(item => item.state.active.id)).size, 1);
  assert.equal(f.db.rows("SELECT * FROM game_attempts WHERE user_id = 'alice'").length, 1);
  assert.equal(response.state.coins, 180);
  assert.deepEqual(response.state.results, []);
  assert.equal(active.date, '2026-10-19');
  assert.equal(active.questions.length, 5);
  assert.equal(active.questions.filter(Boolean).length, 1);
  verifyNoPrivateKeys(response);
  const secret = privateAttempt(f, active.id).active;
  for (const question of secret.questions.slice(1)) assert.ok(!JSON.stringify(response).includes(question.id));
  f.tick(2500);
  const resumed = await f.service.bootstrap('alice');
  assert.equal(resumed.state.active.id, active.id);
  assert.equal(resumed.state.active.issuedAt, active.issuedAt);
  const bob = await f.service.start('bob', f.request({ mode: 'daily' }));
  assert.notEqual(bob.state.active.id, active.id);
  assert.notDeepEqual(privateAttempt(f, bob.state.active.id).active.questions.map(q => q.prompt), secret.questions.map(q => q.prompt));
  await assert.rejects(f.service.answer('bob', f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: 0, selected: 0 })), expectCode('ATTEMPT_NOT_FOUND'));
  assert.equal(f.service.importData, undefined);
});

test('memory exposes only the array for a fixed period, then only the question; preparations and exposure earn no timing penalty', async t => {
  const f = fixture(t);
  let response = await f.service.start('memory-user', f.request({ mode: 'daily' }));
  while (response.state.active?.phase !== 'ready') response = await advance(f, 'memory-user', response);
  const prepared = response.state.active, question = prepared.questions[prepared.index];
  assert.equal(question.visual.type, 'memory');
  assert.equal(question.prompt, undefined);
  assert.equal(question.options, undefined);
  assert.equal(question.visual.cells, undefined);
  assert.equal(prepared.issuedAt, null);
  f.tick(13000);
  const memoryRequest = f.request({ attemptId: prepared.id, questionId: prepared.currentQuestionId });
  response = await f.service.memory('memory-user', memoryRequest);
  const shown = response.state.active;
  assert.equal(shown.phase, 'memorizing');
  assert.ok(shown.questions[shown.index].visual.cells.length > 0);
  assert.equal(shown.questions[shown.index].prompt, undefined);
  assert.equal(shown.questions[shown.index].options, undefined);
  const until = shown.memoryUntil;
  f.tick(500);
  const repeated = await f.service.memory('memory-user', f.request({ attemptId: prepared.id, questionId: prepared.currentQuestionId }));
  assert.equal(repeated.state.active.memoryUntil, until);
  await assert.rejects(f.service.answer('memory-user', f.request({ attemptId: prepared.id, questionId: prepared.currentQuestionId, index: prepared.index, selected: 0 })), expectCode('QUESTION_NOT_READY'));
  f.now = until + 1700;
  response = await f.service.bootstrap('memory-user');
  const answering = response.state.active, exposed = answering.questions[answering.index];
  assert.equal(answering.phase, 'answering');
  assert.equal(answering.issuedAt, until);
  assert.ok(exposed.prompt && exposed.options.length === 4);
  assert.equal(exposed.visual.cells, undefined);
  const answer = privateAttempt(f, prepared.id).active.questions[prepared.index].answer;
  response = await f.service.answer('memory-user', f.request({ attemptId: prepared.id, questionId: prepared.currentQuestionId, index: prepared.index, selected: answer }));
  assert.equal(privateAttempt(f, prepared.id).active.timings[prepared.index], 1700);
  if (response.state.active) verifyNoPrivateKeys(response.state.active);
});

test('first answer survives same/different concurrent submissions and request IDs cannot change meaning', async t => {
  const f = fixture(t);
  let response = await f.service.start('race-user', f.request({ mode: 'daily' }));
  response = await ready(f, 'race-user', response);
  const active = response.state.active;
  f.tick(2000);
  const input = f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: active.index, selected: 0 });
  const answers = await Promise.all(Array.from({ length: 20 }, () => f.service.answer('race-user', input)));
  assert.ok(answers.every(item => item.state.active.index === 1));
  assert.deepEqual(privateAttempt(f, active.id).active.answers, [0]);
  assert.deepEqual(privateAttempt(f, active.id).active.timings, [2000]);
  await assert.rejects(f.service.answer('race-user', { ...input, selected: 1 }), expectCode('REQUEST_ID_REUSED'));
  await assert.rejects(f.service.answer('race-user', f.request({ ...input, requestId: undefined, selected: 1 })), expectCode('ANSWER_ALREADY_LOCKED'));
  const next = answers[0].state.active;
  const safe = await ready(f, 'race-user', { ...answers[0], state: { ...answers[0].state, active: next } });
  f.tick(1200);
  const basis = { attemptId: next.id, questionId: safe.state.active.currentQuestionId, index: safe.state.active.index };
  const competing = await Promise.allSettled([0, 1].map(selected => f.service.answer('race-user', f.request({ ...basis, selected }))));
  assert.equal(competing.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(competing.filter(item => item.status === 'rejected' && item.reason.code === 'ANSWER_ALREADY_LOCKED').length, 1);
  assert.equal(privateAttempt(f, active.id).active.answers.length, 2);
});

test('twenty final-answer retries create one result and one completion grant; client score and time are ignored', async t => {
  const f = fixture(t);
  let response = await f.service.start('finish-user', f.request({ mode: 'daily' }));
  while (response.state.active.index < 4) response = await advance(f, 'finish-user', response, { correct: true, ms: 1000 });
  response = await ready(f, 'finish-user', response);
  const active = response.state.active, question = privateAttempt(f, active.id).active.questions[4];
  f.tick(3000);
  const input = f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: 4, selected: question.answer, elapsedMs: 0, correct: 0, coins: 90000, score: 90000 });
  const responses = await Promise.all(Array.from({ length: 20 }, () => f.service.answer('finish-user', input)));
  for (const completed of responses) {
    assert.equal(completed.state.active, null);
    assert.equal(completed.state.coins, 200);
    assert.equal(completed.state.results.length, 1);
    assert.equal(completed.state.results[0].correct, 5);
    assert.equal(completed.state.results[0].totalTimeMs, 7000);
    assert.equal(completed.state.results[0].score, calculatePerformance(5, 7000).score);
    assert.ok(completed.state.results[0].details.every(detail => detail.explanation && Number.isInteger(detail.answer)));
    assert.ok(!JSON.stringify(completed).includes('solution'));
  }
  assert.equal(f.db.rows("SELECT * FROM game_results WHERE user_id = 'finish-user'").length, 1);
  assert.equal(f.db.rows("SELECT * FROM game_coin_ledger WHERE user_id = 'finish-user' AND reason = 'daily'").length, 1);
  assert.equal(ledgerBalance(f, 'finish-user'), 200);
});

test('trusted complete-body receipt time excludes later server work while issue and expiry clocks stay current', async t => {
  const f = fixture(t);
  let response = await f.service.start('receipt-time-user', f.request({ mode: 'daily' }));
  response = await ready(f, 'receipt-time-user', response);
  const active = response.state.active;
  const receivedAt = active.issuedAt + 1000;
  f.now = receivedAt + 8000;
  const requestScoped = createGameService({ db: f.db, now: () => f.now, requestReceivedAt: receivedAt });
  const answered = await requestScoped.answer('receipt-time-user', f.request({
    attemptId: active.id, questionId: active.currentQuestionId, index: active.index, selected: 0,
  }));
  assert.equal(privateAttempt(f, active.id).active.timings[0], 1000);
  assert.ok(answered.state.active.phase === 'ready' || answered.state.active.issuedAt >= f.now);
  for (const requestReceivedAt of [-1, 1.1, null, '100', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, f.now + 1]) {
    assert.throws(() => createGameService({ db: f.db, now: () => f.now, requestReceivedAt }), expectCode('CLOCK_UNAVAILABLE'));
  }
  const current = await ready(f, 'receipt-time-user', answered);
  const beforeMidnight = f.now;
  f.now = current.state.active.expiresAt;
  const delayed = createGameService({ db: f.db, now: () => f.now, requestReceivedAt: beforeMidnight });
  await assert.rejects(delayed.answer('receipt-time-user', f.request({
    attemptId: current.state.active.id, questionId: current.state.active.currentQuestionId,
    index: current.state.active.index, selected: 0,
  })), expectCode('ATTEMPT_EXPIRED'));
});

test('an actual SQL error rolls back attempt, result, receipt, balance and ledger together', async t => {
  const f = fixture(t);
  let response = await f.service.start('rollback-user', f.request({ mode: 'daily' }));
  while (response.state.active.index < 4) response = await advance(f, 'rollback-user', response);
  response = await ready(f, 'rollback-user', response);
  const active = response.state.active, question = privateAttempt(f, active.id).active.questions[4];
  f.tick(1000);
  const input = f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: 4, selected: question.answer });
  f.db.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.includes('INSERT INTO game_results'))) {
      statements.push(f.db.prepare('INSERT INTO table_that_does_not_exist VALUES (1)'));
    }
  };
  await assert.rejects(f.service.answer('rollback-user', input), /no such table/);
  f.db.beforeBatch = null;
  assert.equal(privateAttempt(f, active.id).active.answers.length, 4);
  assert.equal(f.db.rows('SELECT * FROM game_results').length, 0);
  assert.equal(f.db.rows('SELECT * FROM game_mutation_receipts WHERE request_id = ?', input.requestId).length, 0);
  assert.equal(ledgerBalance(f, 'rollback-user'), 180);
  const successful = await f.service.answer('rollback-user', input);
  assert.equal(successful.state.coins, 200);
  assert.equal(successful.state.results.length, 1);
});

test('practice is one free set after the official daily, with no official score, radar, or coin changes', async t => {
  const f = fixture(t);
  await assert.rejects(f.service.start('practice-user', f.request({ mode: 'practice' })), expectCode('DAILY_REQUIRED'));
  for (const mode of ['preview', 'ad', 'ranked']) await assert.rejects(f.service.start('practice-user', f.request({ mode })), expectCode('INVALID_MODE'));
  const daily = await complete(f, 'practice-user', { correct: 3 });
  const practiced = await complete(f, 'practice-user', { mode: 'practice' });
  assert.equal(practiced.state.practiceHistory.length, 1);
  assert.deepEqual(practiced.state.results, daily.state.results);
  assert.deepEqual(practiced.state.ranking, daily.state.ranking);
  assert.equal(practiced.state.coins, daily.state.coins);
  assert.deepEqual(practiced.state.practiceUsage[dateKey(f.now)], { free: 1, ad: 0 });
  assert.equal(practiced.state.totals.dailyCount, 1);
  assert.equal(practiced.state.totals.practiceCount, 1);
  await assert.rejects(f.service.start('practice-user', f.request({ mode: 'practice' })), expectCode('PRACTICE_USED'));
});

test('concurrent purchases cannot overspend and purchasing an owned character never charges again', async t => {
  const f = fixture(t);
  await f.service.bootstrap('shop-user');
  const purchase = await Promise.allSettled(['outfit-lilac', 'outfit-peach'].map(itemId => f.service.purchase('shop-user', f.request({ itemId }))));
  assert.equal(purchase.filter(item => item.status === 'fulfilled').length, 1);
  assert.equal(purchase.filter(item => item.status === 'rejected' && item.reason.code === 'INSUFFICIENT_COINS').length, 1);
  let snapshot = await f.service.bootstrap('shop-user');
  assert.ok(snapshot.state.coins >= 0);
  assert.equal(snapshot.state.coins, ledgerBalance(f, 'shop-user'));
  const bought = snapshot.state.owned.find(item => ['outfit-lilac', 'outfit-peach'].includes(item));
  const balance = snapshot.state.coins;
  const retries = Array.from({ length: 16 }, () => f.request({ itemId: bought }));
  const repeatedPurchases = await Promise.allSettled(retries.map(input => f.service.purchase('shop-user', input)));
  for (let index = 0; index < repeatedPurchases.length; index += 1) {
    if (repeatedPurchases[index].status === 'rejected') {
      assert.equal(repeatedPurchases[index].reason.code, 'BUSY');
      await f.service.purchase('shop-user', retries[index]);
    }
  }
  snapshot = await f.service.bootstrap('shop-user');
  assert.equal(snapshot.state.coins, balance);
  assert.equal(snapshot.state.owned.filter(item => item === bought).length, 1);
  // A complete week gives enough legitimate coins to collect the cat.
  const collector = fixture(t);
  for (let day = 0; day < 7; day += 1) {
    collector.now = Date.parse(`${addDays('2026-10-19', day)}T09:00:00+09:00`);
    await complete(collector, 'collector');
  }
  const cat = await collector.service.purchase('collector', collector.request({ itemId: 'character-cat' }));
  assert.equal(cat.state.coins, 20);
  assert.equal(cat.state.equipped.character, 'cat');
  const repeat = await collector.service.purchase('collector', collector.request({ itemId: 'character-cat' }));
  assert.equal(repeat.state.coins, 20);
  assert.equal(ledgerBalance(collector, 'collector'), 20);
});

test('real weekly rankings prioritize correct answers, exact time ties share rank, and zero-correct users always tie', async t => {
  const f = fixture(t);
  await complete(f, 'fast-four', { correct: 4, ms: 1000 });
  await complete(f, 'tied-four', { correct: 4, ms: 1000 });
  await complete(f, 'slow-four', { correct: 4, ms: 2000 });
  await complete(f, 'five-correct', { correct: 5, ms: 10000 });
  await complete(f, 'zero-fast', { correct: 0, ms: 1 });
  await complete(f, 'zero-slow', { correct: 0, ms: 9000 });
  await f.service.bootstrap('unplayed');
  const leaderboard = (await f.service.bootstrap('five-correct')).state.ranking;
  assert.equal(leaderboard.total, 6);
  assert.deepEqual(leaderboard.rows.map(row => row.rank), [1, 2, 2, 4, 5, 5]);
  assert.equal(leaderboard.me.correct, 5);
  assert.equal(leaderboard.me.rank, 1);
  assert.ok(leaderboard.rows.every(row => row.sample === false));
  const unplayed = await f.service.bootstrap('unplayed');
  assert.equal(unplayed.state.ranking.me, null);
  assert.equal(unplayed.state.ranking.participated, false);
});

test('weekly snapshots and rewards freeze once across retries and across more than one week', async t => {
  const f = fixture(t, '2026-10-25');
  await complete(f, 'weekly-one', { correct: 5 });
  await complete(f, 'weekly-two', { correct: 4 });
  f.now = Date.parse('2026-10-26T00:00:00+09:00');
  const responses = await Promise.all(Array.from({ length: 14 }, (_, index) => f.service.bootstrap(index % 2 ? 'weekly-one' : 'weekly-two')));
  const first = responses.find(response => response.state.awards['2026-10-19'].rank === 1);
  const award = first.state.awards['2026-10-19'];
  assert.equal(award.total, 2);
  assert.equal(first.state.coins, 200 + award.coins);
  assert.equal(first.state.ranking.total, 0);
  assert.equal(f.db.rows("SELECT * FROM game_closed_weeks WHERE week = '2026-10-19'").length, 1);
  assert.equal(f.db.rows("SELECT * FROM game_weekly_awards WHERE week = '2026-10-19'").length, 2);
  assert.equal(f.db.rows("SELECT * FROM game_coin_ledger WHERE reference = 'weekly:2026-10-19'").length, 2);
  await complete(f, 'weekly-one', { correct: 3 });
  f.now = Date.parse('2026-11-02T00:00:00+09:00');
  const second = await f.service.bootstrap('weekly-one');
  assert.deepEqual(second.state.awards['2026-10-19'], award);
  assert.ok(second.state.awards['2026-10-26']);
  assert.equal(second.state.coins, ledgerBalance(f, 'weekly-one'));
  assert.equal(second.state.totals.dailyCount, 2);
});

test('the closed-week database fence rejects a Sunday final answer delayed until after Monday settlement', async t => {
  const f = fixture(t, '2026-10-25');
  await complete(f, 'settled-player', { correct: 3 });
  let response = await f.service.start('late-player', f.request({ mode: 'daily' }));
  while (response.state.active.index < 4) response = await advance(f, 'late-player', response);
  response = await ready(f, 'late-player', response);
  const active = response.state.active, question = privateAttempt(f, active.id).active.questions[4];
  f.tick(1000);
  let release, signal;
  const blocked = new Promise(resolve => { signal = resolve; });
  const resume = new Promise(resolve => { release = resolve; });
  let intercept = true;
  f.db.beforeBatch = async statements => {
    if (intercept && statements.some(statement => statement.sql.includes('INSERT INTO game_results') && statement.values.includes(active.id))) {
      intercept = false;
      signal();
      await resume;
    }
  };
  const pending = f.service.answer('late-player', f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: 4, selected: question.answer }));
  await blocked;
  f.now = Date.parse('2026-10-26T00:00:01+09:00');
  const settled = await f.service.bootstrap('settled-player');
  assert.equal(settled.state.awards['2026-10-19'].total, 1);
  release();
  await assert.rejects(pending, expectCode('WEEK_CLOSED'));
  f.db.beforeBatch = null;
  assert.equal(f.db.rows("SELECT * FROM game_results WHERE user_id = 'late-player'").length, 0);
  assert.equal(ledgerBalance(f, 'late-player'), 180);
  assert.equal(f.db.rows("SELECT * FROM game_weekly_awards WHERE week = '2026-10-19'").length, 1);
  const stable = await f.service.bootstrap('settled-player');
  assert.deepEqual(stable.state.awards['2026-10-19'], settled.state.awards['2026-10-19']);
});

test('KST midnight expires an unfinished day without score or completion coins', async t => {
  const f = fixture(t);
  let response = await f.service.start('midnight-user', f.request({ mode: 'daily' }));
  response = await ready(f, 'midnight-user', response);
  const active = response.state.active;
  f.now = Date.parse('2026-10-20T00:00:00+09:00');
  await assert.rejects(f.service.answer('midnight-user', f.request({ attemptId: active.id, questionId: active.currentQuestionId, index: active.index, selected: 0 })), expectCode('ATTEMPT_EXPIRED'));
  const newDay = await f.service.start('midnight-user', f.request({ mode: 'daily' }));
  assert.notEqual(newDay.state.active.id, active.id);
  assert.equal(newDay.state.active.date, '2026-10-20');
  assert.equal(newDay.state.coins, 180);
  assert.deepEqual(newDay.state.results, []);
  assert.equal(privateAttempt(f, active.id).row.status, 'expired');
});

test('account export contains only the owner records and never unfinished answers, source seeds, or another account identity', async t => {
  const f = fixture(t);
  await complete(f, 'export-owner', { correct: 4 });
  await complete(f, 'other-account', { correct: 5 });
  const other = await f.service.rename('other-account', f.request({ name: '다른사람' }));
  await f.service.start('export-owner', f.request({ mode: 'practice' }));
  const exported = await f.service.exportData('export-owner');
  assert.equal(exported.export.results.length, 1);
  assert.equal(exported.export.results[0].correct, 4);
  assert.equal(exported.export.attempts.length, 2);
  assert.equal(exported.export.coinLedger.reduce((sum, entry) => sum + entry.amount, 0), exported.state.coins);
  const text = JSON.stringify(exported.export);
  assert.ok(!text.includes('other-account'));
  assert.ok(!text.includes(other.state.playerId));
  assert.ok(!text.includes('다른사람'));
  assert.ok(!text.includes('solution'));
  assert.ok(!text.includes('sourceId'));
  assert.ok(!text.includes('payload'));
  assert.ok(!text.includes('fingerprint'));
});

test('bootstrap returns at most the last 90 KST days while lifetime totals and the owner export retain all completions', async t => {
  const f = fixture(t);
  let expectedCorrect = 0;
  for (let day = 0; day < 92; day += 1) {
    f.now = Date.parse(`${addDays('2026-10-19', day)}T09:00:00+09:00`);
    const correct = day % 6;
    expectedCorrect += correct;
    await complete(f, 'history-user', { correct, ms: 1 });
  }
  const snapshot = await f.service.bootstrap('history-user');
  assert.equal(snapshot.state.results.length, 90);
  assert.equal(snapshot.state.results[0].date, '2026-10-21');
  assert.equal(snapshot.state.results.at(-1).date, dateKey(f.now));
  assert.deepEqual(snapshot.state.totals, { dailyCount: 92, questionCount: 460, correctCount: expectedCorrect, practiceCount: 0 });
  const exported = await f.service.exportData('history-user');
  assert.equal(exported.export.results.length, 92);
  assert.equal(exported.export.results[0].date, '2026-10-19');
  assert.equal(exported.state.coins, ledgerBalance(f, 'history-user'));
});

test('leaderboard returns only the first 100 public rows plus a separate accurate owner row below that cutoff', async t => {
  const f = fixture(t);
  for (let player = 0; player < 105; player += 1) {
    await complete(f, `private-platform-${player}`, { correct: player === 104 ? 4 : 5, ms: player + 1 });
  }
  const response = await f.service.bootstrap('private-platform-104');
  const ranking = response.state.ranking;
  assert.equal(ranking.total, 105);
  assert.equal(ranking.rows.length, 100);
  assert.equal(ranking.rows.at(-1).rank, 100);
  assert.equal(ranking.me.rank, 105);
  assert.equal(ranking.me.id, response.state.playerId);
  assert.equal(ranking.rank, 105);
  assert.ok(ranking.rows.every(row => !row.isMe));
  assert.ok(!JSON.stringify(response).includes('private-platform-'));
});
