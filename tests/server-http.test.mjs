import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { handleGameRequest, handleHealthRequest, BODY_LIMIT, REQUESTS_PER_MINUTE } from '../server/http.mjs';
import { GameError } from '../server/game-service.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

const ORIGIN = 'https://haru-five.example';
const START_TIME = Date.parse('2026-10-20T08:00:00+09:00');
function request(action = 'bootstrap', { method = 'GET', body, headers = {}, query = '', raw } = {}) {
  return new Request(`${ORIGIN}/api/game/${action}${query}`, {
    method,
    headers: { ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}), ...headers },
    ...(body !== undefined || raw !== undefined ? { body: raw ?? JSON.stringify(body), duplex: 'half' } : {}),
  });
}
function setup(t) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let timestamp = START_TIME;
  const expectedPlayers = new Map();
  const call = async (action, options = {}, userId = 'trusted-account-a') => {
    const headers = { ...(expectedPlayers.has(userId) && (options.method === 'POST' || action === 'export') ? { 'X-Haru-Player': expectedPlayers.get(userId) } : {}), ...options.headers };
    const response = await handleGameRequest(request(action, { ...options, headers }), { action, userId, db, now: () => timestamp });
    if (action === 'bootstrap' && response.ok) expectedPlayers.set(userId, (await response.clone().json()).state.playerId);
    return response;
  };
  return { db, call, now: () => timestamp, advance(ms) { timestamp += ms; } };
}

test('missing trusted identity cannot read or mutate even when external headers claim an account', async () => {
  const db = { prepare() { assert.fail('unauthenticated request reached the DB'); }, batch() { assert.fail('unauthenticated request reached the DB'); } };
  for (const action of ['bootstrap', 'export', 'start', 'purchase']) {
    const mutation = ['start', 'purchase'].includes(action);
    const req = request(action, {
      method: mutation ? 'POST' : 'GET',
      ...(mutation ? { body: { requestId: randomUUID(), userId: 'spoofed-account' } } : {}),
      headers: { 'oai-authenticated-user-id': 'spoofed-account', Cookie: 'userId=spoofed-account' },
    });
    const response = await handleGameRequest(req, { action, db });
    assert.equal(response.status, 401);
    const payload = await response.json();
    assert.equal(payload.code, 'SIGN_IN_REQUIRED');
    assert.equal(payload.signInUrl, '/signin-with-chatgpt?return_to=%2F');
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  }
});

test('cross-origin, opaque-origin and absent-origin writes are rejected before account creation', async t => {
  const { db } = setup(t);
  for (const origin of ['https://attacker.example', 'null', null]) {
    const req = request('start', { method: 'POST', body: { mode: 'daily', requestId: randomUUID() } });
    if (origin === null) req.headers.delete('Origin'); else req.headers.set('Origin', origin);
    const response = await handleGameRequest(req, { action: 'start', userId: 'trusted-account-a', db });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'ORIGIN_REJECTED');
  }
  const crossSiteGet = await handleGameRequest(request('bootstrap', { headers: { 'Sec-Fetch-Site': 'cross-site' } }), { action: 'bootstrap', userId: 'trusted-account-a', db });
  assert.equal(crossSiteGet.status, 403);
  assert.equal(db.rows('SELECT * FROM game_players').length, 0);
  assert.equal(db.rows('SELECT * FROM game_rate_limits').length, 0);
});

test('methods and action allowlist reject unsupported endpoints without mutations', async t => {
  const { call, db } = setup(t);
  for (const action of ['delete-account', '__proto__', 'constructor', 'answers']) {
    assert.equal((await call(action)).status, 404);
  }
  const badMethod = await call('start');
  assert.equal(badMethod.status, 405);
  assert.equal(badMethod.headers.get('Allow'), 'POST');
  assert.equal((await call('bootstrap', { method: 'POST', body: {} })).status, 405);
  assert.equal(db.rows('SELECT * FROM game_players').length, 0);
});

test('JSON parser rejects unexpected authority fields, malformed structures and wrong content type', async t => {
  const { call, db } = setup(t);
  for (const extra of [{ score: 999999 }, { userId: 'another-account' }, { elapsedMs: 1 }, { coins: 999 }, { day: '2026-10-21' }]) {
    const response = await call('start', { method: 'POST', body: { mode: 'daily', requestId: randomUUID(), ...extra } });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'UNEXPECTED_FIELD');
  }
  for (const raw of ['{', 'null', '[]', '42', '"text"']) {
    const response = await call('start', { method: 'POST', raw });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).code, 'INVALID_JSON');
  }
  const textForm = await call('start', { method: 'POST', raw: 'mode=daily', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
  assert.equal(textForm.status, 415);
  assert.equal(db.rows('SELECT * FROM game_players').length, 0);
});

test('body limit applies to streamed bytes even if Content-Length is missing or dishonest', async t => {
  const { call } = setup(t);
  for (const headers of [{}, { 'Content-Length': '2' }, { 'Content-Length': String(BODY_LIMIT + 1) }]) {
    const response = await call('rename', { method: 'POST', raw: JSON.stringify({ name: 'a'.repeat(BODY_LIMIT + 1), requestId: randomUUID() }), headers });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'BODY_TOO_LARGE');
  }
  const encoded = new TextEncoder().encode('a'.repeat(BODY_LIMIT / 2));
  const stream = new ReadableStream({ start(controller) { controller.enqueue(encoded); controller.enqueue(encoded); controller.enqueue(encoded); controller.close(); } });
  assert.equal((await call('rename', { method: 'POST', raw: stream })).status, 413);
});

test('HTTP start is authenticated, resumes persisted questions and does not expose answer banks', async t => {
  const { call, db } = setup(t);
  const first = await call('bootstrap');
  assert.equal(first.status, 200);
  const initial = await first.json();
  assert.equal(initial.state.coins, 180);
  assert.equal(initial.state.ranking.total, 0);
  assert.deepEqual(initial.state.owned.filter(id => id.startsWith('character-')), ['character-rabbit']);
  assert.notEqual(initial.state.playerId, 'trusted-account-a');
  const body = { mode: 'daily', requestId: randomUUID() };
  const started = await call('start', { method: 'POST', body });
  assert.equal(started.status, 200);
  const active = (await started.json()).state.active;
  assert.ok(active.id);
  assert.equal(active.questions.filter(Boolean).length, 1);
  for (const key of ['answer', 'explanation', 'seed', 'sourceId', 'solution']) {
    assert.ok(!JSON.stringify(active).includes(`"${key}"`));
  }
  const retry = await call('start', { method: 'POST', body });
  assert.equal((await retry.json()).state.active.id, active.id);
  assert.equal(db.rows('SELECT * FROM game_attempts').length, 1);
});

test('data export selects the trusted account even if a query or header claims another one', async t => {
  const { call } = setup(t);
  await call('bootstrap');
  await call('bootstrap', {}, 'trusted-account-b');
  await call('rename', { method: 'POST', body: { name: '첫번째계정', requestId: randomUUID() } }, 'trusted-account-a');
  await call('rename', { method: 'POST', body: { name: '두번째계정', requestId: randomUUID() } }, 'trusted-account-b');
  const response = await call('export', { query: '?userId=trusted-account-b', headers: { 'oai-authenticated-user-id': 'trusted-account-b' } });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition'), /attachment/);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const payload = await response.json();
  assert.equal(payload.export.profile.name, '첫번째계정');
  assert.ok(!JSON.stringify(payload).includes('두번째계정'));
  assert.ok(!JSON.stringify(payload).includes('trusted-account-'));
});

async function readyFirstQuestion(f) {
  await f.call('bootstrap');
  let response = await f.call('start', { method: 'POST', body: { mode: 'daily', requestId: randomUUID() } });
  let active = (await response.json()).state.active;
  if (active.phase === 'ready') {
    response = await f.call('memory', { method: 'POST', body: { attemptId: active.id, questionId: active.currentQuestionId, requestId: randomUUID() } });
    active = (await response.json()).state.active;
    f.advance(active.memoryUntil - f.now());
  }
  return active;
}

test('answer timing excludes a delayed server-side rate-limit query', async t => {
  const f = setup(t), active = await readyFirstQuestion(f);
  f.advance(1200);
  f.db.beforeQuery = ({ sql }) => {
    if (sql.includes('INSERT INTO game_rate_limits')) {
      f.advance(5000);
      f.db.beforeQuery = null;
    }
  };
  const response = await f.call('answer', { method: 'POST', body: { attemptId: active.id, questionId: active.currentQuestionId, index: 0, selected: 0, requestId: randomUUID() } });
  assert.equal(response.status, 200);
  const stored = JSON.parse(f.db.rows('SELECT payload FROM game_attempts WHERE id = ?', active.id)[0].payload);
  assert.equal(stored.timings[0], 1200, 'quota-query latency cannot penalize this answer');
});

test('authentication database latency cannot add to an already received answer time', async t => {
  const f = setup(t), active = await readyFirstQuestion(f);
  const publicId = f.db.rows('SELECT public_id FROM game_players WHERE id = ?', 'trusted-account-a')[0].public_id;
  f.advance(1250);
  const response = await handleGameRequest(request('answer', {
    method: 'POST', headers: { 'X-Haru-Player': publicId },
    body: { attemptId: active.id, questionId: active.currentQuestionId, index: 0, selected: 0, requestId: randomUUID() },
  }), {
    action: 'answer', db: f.db, now: f.now,
    resolveUserId: async () => { f.advance(7000); return 'trusted-account-a'; },
  });
  assert.equal(response.status, 200);
  const stored = JSON.parse(f.db.rows('SELECT payload FROM game_attempts WHERE id = ?', active.id)[0].payload);
  assert.equal(stored.timings[0], 1250);
});

test('old tabs and missing player context cannot mutate or export a newly selected account', async t => {
  const { call, db } = setup(t);
  const a = await (await call('bootstrap')).json();
  const b = await (await call('bootstrap', {}, 'trusted-account-b')).json();
  for (const expected of [null, a.state.playerId]) {
    const headers = expected ? { 'X-Haru-Player': expected } : {};
    const mutation = await handleGameRequest(request('rename', { method: 'POST', headers, body: { name: '바뀌면안됨', requestId: randomUUID() } }), {
      action: 'rename', db, userId: 'trusted-account-b', now: () => START_TIME,
    });
    assert.equal(mutation.status, 409);assert.equal((await mutation.json()).code, 'ACCOUNT_CHANGED');
    const exported = await handleGameRequest(request('export', { headers }), { action: 'export', db, userId: 'trusted-account-b' });
    assert.equal(exported.status, 409);assert.ok(!JSON.stringify(await exported.json()).includes(b.state.playerId));
  }
  assert.equal(db.rows('SELECT name FROM game_players WHERE id = ?', 'trusted-account-b')[0].name, b.state.name);
  assert.equal(db.rows('SELECT COUNT(*) AS count FROM game_mutation_receipts')[0].count, 0);
  const valid = await call('rename', { method: 'POST', body: { name: '본인변경', requestId: randomUUID() } }, 'trusted-account-b');
  assert.equal(valid.status, 200);
});

test('holding back the final answer bytes does consume thinking time', async t => {
  const f = setup(t), active = await readyFirstQuestion(f);
  f.advance(1200);
  const prefix = JSON.stringify({ attemptId: active.id, questionId: active.currentQuestionId, index: 0, requestId: randomUUID() }).slice(0, -1) + ',"selected":';
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) { controller.enqueue(encoder.encode(prefix)); },
    pull(controller) { f.advance(5000); controller.enqueue(encoder.encode('0}')); controller.close(); },
  });
  const response = await f.call('answer', { method: 'POST', raw: stream });
  assert.equal(response.status, 200);
  const stored = JSON.parse(f.db.rows('SELECT payload FROM game_attempts WHERE id = ?', active.id)[0].payload);
  assert.equal(stored.timings[0], 6200, 'opening an incomplete POST is not answer submission');
});

test('per-account SQL limit admits exactly 120 concurrent requests, isolates accounts and resets each minute', async t => {
  const { db } = setup(t);
  let timestamp = START_TIME + 10000;
  let invocations = 0;
  const makeService = () => ({ async bootstrap() { invocations += 1; return { state: {}, serverNow: timestamp, today: '2026-10-20' }; } });
  const invoke = (userId = 'rate-account-a') => handleGameRequest(request(), { action: 'bootstrap', userId, db, now: () => timestamp, makeService });
  const responses = await Promise.all(Array.from({ length: REQUESTS_PER_MINUTE + 8 }, () => invoke()));
  assert.equal(responses.filter(response => response.status === 200).length, REQUESTS_PER_MINUTE);
  assert.equal(responses.filter(response => response.status === 429).length, 8);
  const limited = responses.find(response => response.status === 429);
  assert.equal(limited.headers.get('Retry-After'), '50');
  assert.equal((await limited.json()).code, 'RATE_LIMITED');
  assert.equal(invocations, REQUESTS_PER_MINUTE);
  assert.equal((await invoke('rate-account-b')).status, 200);
  timestamp += 50000;
  assert.equal((await invoke()).status, 200);
  const rows = db.rows('SELECT * FROM game_rate_limits ORDER BY user_id');
  assert.equal(rows.length, 2);
  assert.equal(rows[0].request_count, 1);
});

test('a late previous-minute query cannot reset the current request limit', async t => {
  const { db } = setup(t);
  let timestamp = START_TIME + 10000;
  let releaseOld, markBlocked;
  const blocked = new Promise(resolve => { markBlocked = resolve; });
  const gate = new Promise(resolve => { releaseOld = resolve; });
  let intercepted = false;
  db.beforeQuery = async ({ sql }) => {
    if (sql.includes('INSERT INTO game_rate_limits') && !intercepted) {
      intercepted = true;
      markBlocked();
      await gate;
    }
  };
  const invoke = () => handleGameRequest(request(), {
    action: 'bootstrap', userId: 'minute-boundary-account', db, now: () => timestamp,
    makeService: () => ({ bootstrap: async () => ({ state: {}, serverNow: timestamp, today: '2026-10-20' }) }),
  });
  const oldRequest = invoke();
  await blocked;
  timestamp += 60000;
  const current = await Promise.all(Array.from({ length: REQUESTS_PER_MINUTE }, invoke));
  assert.ok(current.every(response => response.status === 200));
  releaseOld();
  const late = await oldRequest;
  assert.equal(late.status, 429);
  assert.equal(late.headers.get('Retry-After'), '50');
  assert.equal((await invoke()).status, 429);
  const row = db.rows('SELECT * FROM game_rate_limits')[0];
  assert.equal(row.window_start, START_TIME + 60000);
  assert.equal(row.request_count, REQUESTS_PER_MINUTE + 1);
});

test('expected input failures stay readable while unexpected DB errors reveal no internals', async t => {
  const { db } = setup(t);
  const options = { action: 'bootstrap', userId: 'trusted-account-a', db, now: () => START_TIME };
  const expected = await handleGameRequest(request(), { ...options, makeService: () => ({ bootstrap() { throw new GameError(409, 'BUSY', '다시 확인해 주세요.'); } }) });
  assert.equal(expected.status, 409);
  assert.equal((await expected.json()).code, 'BUSY');
  const failed = await handleGameRequest(request(), { ...options, makeService: () => ({ bootstrap() { throw new Error('SQL SELECT answer FROM secret_question WHERE user_id=private-identity'); } }) });
  assert.equal(failed.status, 503);
  const text = await failed.text();
  assert.ok(!/SQL|SELECT|secret_question|private-identity|stack/.test(text));
  assert.equal((await handleGameRequest(request(), { action: 'bootstrap', userId: 'trusted-account-a' })).status, 503);
});

test('health checks all migrated tables and exposes no player details', async t => {
  const { db } = setup(t);
  const response = await handleHealthRequest(db);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ok', version: '0.5.1', database: 'ready' });
  assert.equal((await handleHealthRequest(null)).status, 503);
  db.sqlite.exec('DROP TABLE game_rate_limits');
  assert.equal((await handleHealthRequest(db)).status, 503);
});
