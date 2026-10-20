import { accountAllowedSql } from './privacy-contract.mjs';
/**
 * Server-authoritative game service. Only this module imports the private
 * question generators. Public responses are assembled using allow lists.
 *
 * D1 batches are atomic. Every multi-table player mutation starts with a
 * revision compare-and-swap; subsequent writes are gated by a fresh, private
 * transaction token. A losing CAS therefore cannot write a result or a coin.
 */
import {
  FIELDS, TIERS, dateKey, weekKey, addDays,
  scoreAnswers, calculatePerformance, rankTier,
} from '../legacy/v040/game-core.js';
import { generateQuestion } from '../legacy/v040/question-variants.js';
import { CATALOG, DAILY_COMPLETION_COINS } from '../legacy/v040/state.js';

const WELCOME_COINS = 180;
const DEFAULT_EQUIPMENT = Object.freeze({ character: 'rabbit', outfit: 'mint', hat: 'none', accessory: 'none', background: 'garden' });
const FREE_ITEMS = CATALOG.filter(item => item.cost === 0).map(item => item.id);
const MAX_CAS_ATTEMPTS = 12;
const MAX_RECENT_RESULTS = 90;
const MAX_ID_LENGTH = 200;
const GATE = `EXISTS (SELECT 1 FROM game_players WHERE id = ? AND mutation_token = ? AND ${accountAllowedSql('game_players.id')})`;

export class GameError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'GameError';
    this.status = status;
    this.code = code;
  }
}

function fail(status, code, message) { throw new GameError(status, code, message); }
function requireUser(userId) {
  if (typeof userId !== 'string' || !userId.trim() || userId.length > MAX_ID_LENGTH) {
    fail(401, 'AUTH_REQUIRED', '로그인한 뒤 다시 이용해 주세요.');
  }
  return userId;
}
function requireInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail(400, 'INVALID_REQUEST', '요청 내용을 확인해 주세요.');
  if (typeof input.requestId !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(input.requestId)) {
    fail(400, 'INVALID_REQUEST_ID', '요청 식별값이 올바르지 않아요. 다시 시도해 주세요.');
  }
}
function requireId(value, kind) {
  if (typeof value !== 'string' || !value || value.length > MAX_ID_LENGTH) fail(400, 'INVALID_ID', `${kind} 정보를 확인해 주세요.`);
}
function readJson(value) { return value == null ? null : JSON.parse(value); }
function endOfDay(day) { return Date.parse(`${addDays(day, 1)}T00:00:00+09:00`); }
function unpackPlayer(row) {
  if (!row) fail(503, 'PROFILE_UNAVAILABLE', '내 정보를 준비하지 못했어요. 잠시 후 다시 시도해 주세요.');
  return { ...row, owned: readJson(row.owned), equipped: readJson(row.equipped) };
}
function attemptPayload(row) { return row ? readJson(row.payload) : null; }
function selectedQuestion(question, { showContent = true, showCells = false, showAnswer = false } = {}) {
  const output = { id: question.id, field: question.field, level: question.level, points: 1000 };
  if (showContent) {
    output.prompt = question.prompt;
    output.options = [...question.options];
  }
  if (question.visual?.type === 'memory') {
    output.visual = { type: 'memory', columns: question.visual.columns, seconds: question.visual.seconds };
    if (showCells) output.visual.cells = [...question.visual.cells];
  }
  if (showAnswer) {
    output.answer = question.answer;
    output.explanation = question.explanation;
  }
  return output;
}
function exposeAttempt(row, timestamp) {
  if (!row || row.status !== 'active' || timestamp >= row.expires_at) return null;
  const active = attemptPayload(row);
  const question = active.questions[active.index];
  const memory = question.visual?.type === 'memory';
  const phase = memory && active.memoryUntil == null ? 'ready'
    : memory && timestamp < active.memoryUntil ? 'memorizing' : 'answering';
  const questions = Array(5).fill(null);
  questions[active.index] = selectedQuestion(question, {
    showContent: phase === 'answering', showCells: phase === 'memorizing',
  });
  return {
    id: row.id, mode: row.mode, date: row.day, index: active.index,
    questions, currentQuestionId: question.id, phase,
    issuedAt: active.issuedAt, memoryUntil: active.memoryUntil,
    expiresAt: row.expires_at, totalTimeMs: active.timings.reduce((sum, value) => sum + value, 0),
    answers: [...active.answers], timingVersion: 2, questionVersion: 3,
  };
}
function setCurrentClock(active, timestamp) {
  active.memoryUntil = null;
  active.issuedAt = active.questions[active.index].visual?.type === 'memory' ? null : timestamp;
}
function completedResult(row, active, timestamp) {
  const scored = scoreAnswers(active.questions, active.answers, active.timings);
  return {
    id: row.id, ...scored, date: row.day, mode: row.mode,
    questions: active.questions.map(question => selectedQuestion(question, { showContent: true, showCells: true, showAnswer: true })),
    questionVersion: 3, timingVersion: 2, completedAt: timestamp,
  };
}
function mapStanding(row, currentUserId) {
  const equipment = readJson(row.equipped);
  return {
    id: row.public_id, name: row.name, equipped: equipment,
    character: equipment.character, outfit: equipment.outfit,
    ...calculatePerformance(row.correct, row.total_time_ms),
    rank: row.rank, playedDays: row.played_days,
    isMe: row.user_id === currentUserId, sample: false,
  };
}
function awardToPublic(row) {
  const tier = TIERS.find(item => item.id === row.tier_id);
  return {
    week: row.week, ...calculatePerformance(row.correct, row.total_time_ms),
    playedDays: row.played_days, rank: row.rank, total: row.participants,
    tierId: row.tier_id, tierName: tier?.name || row.tier_id,
    coins: row.coins, awardedAt: dateKey(row.created_at),
  };
}

const WEEK_TOTALS = `WITH totals AS (
  SELECT user_id, SUM(correct) AS correct, SUM(total_time_ms) AS total_time_ms,
         COUNT(*) AS played_days
  FROM game_results WHERE week = ? AND mode = 'daily' AND ${accountAllowedSql('game_results.user_id')} GROUP BY user_id
), ranked AS (
  SELECT *, RANK() OVER (ORDER BY correct DESC,
    CASE WHEN correct = 0 THEN 0 ELSE total_time_ms END ASC) AS rank,
    COUNT(*) OVER () AS participants FROM totals
)`;
const TIER_CASE = `CASE ${[...TIERS].reverse().map(tier => `WHEN rank * 100 <= participants * ${tier.ceiling} THEN '${tier.id}'`).join(' ')} END`;
const REWARD_CASE = `CASE ${[...TIERS].reverse().map(tier => `WHEN rank * 100 <= participants * ${tier.ceiling} THEN ${tier.reward}`).join(' ')} END`;

/**
 * requestReceivedAt is supplied only by the trusted HTTP handler, after the
 * complete answer body arrives and before server-side database work. Services
 * constructed with it are request-scoped. It is never read from client JSON.
 * @param {{ db?: import('@cloudflare/workers-types').D1Database, now?: () => number, uuid?: () => string, requestReceivedAt?: number }} [options]
 */
export function createGameService({ db, now = Date.now, uuid = () => globalThis.crypto.randomUUID(), requestReceivedAt } = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    fail(503, 'STORAGE_UNAVAILABLE', '기록 저장소를 준비하고 있어요. 잠시 후 다시 이용해 주세요.');
  }
  // Strong/sequential reads are required for CAS retries and read-after-write.
  const database = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const clock = () => {
    const value = Math.floor(now());
    if (!Number.isSafeInteger(value) || value < 0) fail(503, 'CLOCK_UNAVAILABLE', '서버 시간을 확인하지 못했어요.');
    return value;
  };
  if (requestReceivedAt !== undefined && (!Number.isSafeInteger(requestReceivedAt)
      || requestReceivedAt < 0 || requestReceivedAt > clock())) {
    fail(503, 'CLOCK_UNAVAILABLE', '답 제출 시각을 확인하지 못했어요. 같은 요청으로 다시 시도해 주세요.');
  }
  const prepare = (sql, values = []) => database.prepare(sql).bind(...values);
  const first = (sql, values = []) => prepare(sql, values).first();
  const all = async (sql, values = []) => (await prepare(sql, values).all()).results || [];
  const requireAllowed = row => {
    if (!row) fail(403, 'ACCOUNT_RESTRICTED', '동의 철회 또는 탈퇴 처리 중인 계정이에요.');
    return row;
  };
  const loadPlayer = async userId => unpackPlayer(requireAllowed(await first(
    `SELECT * FROM game_players WHERE id = ? AND ${accountAllowedSql('game_players.id')}`, [userId])));
  const gateArgs = (userId, token) => [userId, token];

  async function ensureProfile(userId, timestamp) {
    await database.batch([
      prepare(`INSERT OR IGNORE INTO game_players
        (id, public_id, name, coins, owned, equipped, active_id, revision, mutation_token, created_day, created_at)
        SELECT candidate.id, ?, ?, ?, ?, ?, NULL, 0, NULL, ?, ? FROM (SELECT ? AS id) candidate WHERE ${accountAllowedSql('candidate.id')}`,
      [uuid(), '구름토끼', WELCOME_COINS, JSON.stringify(FREE_ITEMS), JSON.stringify(DEFAULT_EQUIPMENT), dateKey(timestamp), timestamp, userId]),
      prepare(`INSERT OR IGNORE INTO game_coin_ledger (user_id, reference, reason, amount, created_at)
        SELECT id, 'welcome', 'welcome', ?, created_at FROM game_players WHERE id = ? AND ${accountAllowedSql('game_players.id')}`, [WELCOME_COINS, userId]),
    ]);
  }

  async function closePastWeeks(timestamp) {
    const currentWeek = weekKey(dateKey(timestamp));
    const weeks = await all(`SELECT candidate.week FROM (
      SELECT DISTINCT week FROM game_attempts WHERE week < ?
      UNION SELECT ? AS week
    ) candidate WHERE NOT EXISTS (SELECT 1 FROM game_closed_weeks c WHERE c.week = candidate.week)
    ORDER BY candidate.week LIMIT 12`, [currentWeek, addDays(currentWeek, -7)]);
    for (const entry of weeks) {
      const token = uuid();
      await database.batch([
        prepare('INSERT OR IGNORE INTO game_closed_weeks (week, close_token, closed_at, rules_version) VALUES (?, ?, ?, 1)', [entry.week, token, timestamp]),
        prepare(`INSERT INTO game_weekly_awards
          (user_id, week, correct, total_time_ms, played_days, rank, participants, tier_id, coins, created_at)
          ${WEEK_TOTALS}
          SELECT user_id, ?, correct, total_time_ms, played_days, rank, participants,
            ${TIER_CASE}, ${REWARD_CASE}, ? FROM ranked
          WHERE EXISTS (SELECT 1 FROM game_closed_weeks WHERE week = ? AND close_token = ?)`,
        [entry.week, entry.week, timestamp, entry.week, token]),
      ]);
    }
  }

  function playerUpdate(player, next, token, extraWhere = '', extraValues = []) {
    return prepare(`UPDATE game_players SET name = ?, coins = ?, owned = ?, equipped = ?, active_id = ?,
      revision = revision + 1, mutation_token = ?
      WHERE id = ? AND revision = ? AND ${accountAllowedSql('game_players.id')} ${extraWhere}`,
    [next.name, next.coins, JSON.stringify(next.owned), JSON.stringify(next.equipped), next.active_id,
      token, player.id, player.revision, ...extraValues]);
  }

  async function expireAttempt(userId, timestamp) {
    for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
      const player = await loadPlayer(userId);
      if (!player.active_id) return;
      const attempt = await first('SELECT * FROM game_attempts WHERE id = ? AND user_id = ?', [player.active_id, userId]);
      if (attempt && attempt.status === 'active' && timestamp < attempt.expires_at) return;
      const token = uuid();
      const statements = [playerUpdate(player, { ...player, active_id: null }, token)];
      if (attempt?.status === 'active') statements.push(prepare(`UPDATE game_attempts SET status = 'expired'
        WHERE id = ? AND user_id = ? AND ${GATE}`, [attempt.id, userId, ...gateArgs(userId, token)]));
      const result = await database.batch(statements);
      if (result[0].meta.changes === 1) return;
    }
    fail(409, 'BUSY', '다른 창의 변경을 반영 중이에요. 잠시 후 다시 시도해 주세요.');
  }

  async function claimWeeklyAwards(userId, timestamp) {
    for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
      const player = await loadPlayer(userId);
      const pending = await all(`SELECT a.* FROM game_weekly_awards a
        WHERE a.user_id = ? AND NOT EXISTS (SELECT 1 FROM game_coin_ledger l
          WHERE l.user_id = a.user_id AND l.reference = 'weekly:' || a.week)
        ORDER BY a.week LIMIT 40`, [userId]);
      if (!pending.length) return;
      const token = uuid();
      const amount = pending.reduce((sum, award) => sum + award.coins, 0);
      const statements = [playerUpdate(player, { ...player, coins: player.coins + amount }, token)];
      for (const award of pending) statements.push(prepare(`INSERT INTO game_coin_ledger
        (user_id, reference, reason, amount, created_at) SELECT ?, ?, 'weekly', ?, ? WHERE ${GATE}`,
      [userId, `weekly:${award.week}`, award.coins, timestamp, ...gateArgs(userId, token)]));
      const result = await database.batch(statements);
      if (result[0].meta.changes === 1 && pending.length < 40) return;
    }
    fail(409, 'BUSY', '주간 보상을 반영 중이에요. 다시 접속하면 이어서 처리해요.');
  }

  async function maintainUser(userId) {
    requireUser(userId);
    const timestamp = clock();
    await ensureProfile(userId, timestamp);
    await loadPlayer(userId);
    await closePastWeeks(timestamp);
    await expireAttempt(userId, timestamp);
    await claimWeeklyAwards(userId, timestamp);
  }

  async function snapshot(userId) {
    const timestamp = clock(), today = dateKey(timestamp), week = weekKey(today);
    const recent = addDays(today, -(MAX_RECENT_RESULTS - 1));
    const queries = await database.batch([
      prepare(`SELECT * FROM game_players WHERE id = ? AND ${accountAllowedSql('game_players.id')}`, [userId]),
      prepare(`SELECT a.* FROM game_attempts a JOIN game_players p ON p.active_id = a.id
        WHERE p.id = ? AND a.user_id = ?`, [userId, userId]),
      prepare(`SELECT result FROM game_results WHERE user_id = ? AND mode = 'daily' AND day >= ? AND day <= ? ORDER BY day DESC LIMIT 90`, [userId, recent, today]),
      prepare(`SELECT result FROM game_results WHERE user_id = ? AND mode = 'practice' AND day >= ? AND day <= ? ORDER BY day DESC LIMIT 90`, [userId, recent, today]),
      prepare('SELECT * FROM game_weekly_awards WHERE user_id = ? ORDER BY week DESC', [userId]),
      prepare(`SELECT COUNT(CASE WHEN mode = 'daily' THEN 1 END) AS daily_count,
        COALESCE(SUM(CASE WHEN mode = 'daily' THEN correct ELSE 0 END), 0) AS correct_count,
        COUNT(CASE WHEN mode = 'practice' THEN 1 END) AS practice_count FROM game_results WHERE user_id = ?`, [userId]),
      prepare(`${WEEK_TOTALS} SELECT r.*, p.public_id, p.name, p.equipped FROM ranked r
        JOIN game_players p ON p.id = r.user_id
        WHERE r.user_id IN (SELECT user_id FROM ranked ORDER BY rank, user_id LIMIT 100)
          OR r.user_id = ? ORDER BY r.rank, p.public_id`, [week, userId]),
      prepare('SELECT day FROM game_attempts WHERE user_id = ? AND mode = ? AND day = ?', [userId, 'practice', today]),
    ]);
    const rows = queries.map(query => query.results || []);
    const player = unpackPlayer(requireAllowed(rows[0][0]));
    const standings = rows[6].map(row => mapStanding(row, userId));
    const me = standings.find(row => row.isMe) || null;
    const total = rows[6][0]?.participants || 0;
    const empty = { ...calculatePerformance(0, null), playedDays: 0 };
    const ranking = {
      week, rows: standings.slice(0, 100), me,
      ...(me || empty), rank: me?.rank ?? null, total, participated: !!me,
      tier: me ? rankTier(me.rank, total) : null,
    };
    const counts = rows[5][0];
    return {
      state: {
        version: 2, economyVersion: 3, playerId: player.public_id, name: player.name,
        coins: player.coins, owned: player.owned, equipped: player.equipped,
        results: rows[2].map(row => readJson(row.result)).reverse(),
        practiceHistory: rows[3].map(row => readJson(row.result)).reverse(),
        practiceUsage: rows[7].length ? { [today]: { free: 1, ad: 0 } } : {},
        awards: Object.fromEntries(rows[4].map(row => [row.week, awardToPublic(row)])),
        active: exposeAttempt(rows[1][0], timestamp), createdAt: player.created_day,
        ranking, todayFields: fieldsForDay(today),
        totals: { dailyCount: counts.daily_count, questionCount: counts.daily_count * 5,
          correctCount: counts.correct_count, practiceCount: counts.practice_count },
      },
      serverNow: timestamp, today,
    };
  }

  function fieldsForDay(day) {
    const index = Math.floor(Date.parse(`${day}T00:00:00Z`) / 86400000);
    return Array.from({ length: 5 }, (_, offset) => FIELDS[((index + offset + 1) % 6 + 6) % 6].id);
  }

  async function mutate(userId, input, operation, details, build) {
    requireUser(userId);
    requireInput(input);
    const receivedAt = requestReceivedAt ?? clock();
    const fingerprint = JSON.stringify({ operation, ...details });
    await maintainUser(userId);
    for (let retry = 0; retry < MAX_CAS_ATTEMPTS; retry += 1) {
      const receipt = await first('SELECT fingerprint FROM game_mutation_receipts WHERE user_id = ? AND request_id = ?', [userId, input.requestId]);
      if (receipt) {
        if (receipt.fingerprint !== fingerprint) fail(409, 'REQUEST_ID_REUSED', '이미 사용한 요청 식별값이에요. 새로운 요청으로 다시 시도해 주세요.');
        return snapshot(userId);
      }
      const player = await loadPlayer(userId);
      const token = uuid();
      const plan = await build(player, token, receivedAt);
      const next = plan.next || player;
      const statements = [playerUpdate(player, next, token,
        `${plan.extraWhere || ''} AND NOT EXISTS (SELECT 1 FROM game_mutation_receipts WHERE user_id = ? AND request_id = ?)`,
        [...(plan.extraValues || []), userId, input.requestId])];
      statements.push(prepare(`INSERT INTO game_mutation_receipts (user_id, request_id, fingerprint, created_at)
        SELECT ?, ?, ?, ? WHERE ${GATE}`, [userId, input.requestId, fingerprint, receivedAt, ...gateArgs(userId, token)]));
      statements.push(...(plan.statements || []));
      if (plan.expiresAt != null && clock() >= plan.expiresAt) fail(409, 'ATTEMPT_EXPIRED', '하루가 바뀌어 이전 도전이 마감됐어요. 오늘의 도전을 시작해 주세요.');
      const result = await database.batch(statements);
      if (result[0].meta.changes === 1) return snapshot(userId);
      if (plan.week && await first('SELECT week FROM game_closed_weeks WHERE week = ?', [plan.week])) {
        fail(409, 'WEEK_CLOSED', '이전 주의 도전이 마감됐어요. 오늘의 도전을 시작해 주세요.');
      }
    }
    fail(409, 'BUSY', '다른 창의 변경을 반영 중이에요. 같은 요청으로 다시 시도해 주세요.');
  }

  async function bootstrap(userId) {
    await maintainUser(userId);
    return snapshot(userId);
  }

  async function start(userId, input) {
    requireInput(input);
    if (!['daily', 'practice'].includes(input.mode)) fail(400, 'INVALID_MODE', '공식 도전 또는 무료 연습을 선택해 주세요.');
    return mutate(userId, input, 'start', { mode: input.mode }, async (player, token) => {
      const timestamp = clock(), day = dateKey(timestamp), week = weekKey(day);
      if (player.active_id) return { next: player };
      const existing = await first('SELECT * FROM game_attempts WHERE user_id = ? AND day = ? AND mode = ?', [userId, day, input.mode]);
      if (existing) {
        if (existing.status === 'active' && timestamp < existing.expires_at) return { next: { ...player, active_id: existing.id } };
        if (input.mode === 'daily') return { next: player };
        fail(409, 'PRACTICE_USED', '오늘의 무료 연습을 모두 즐겼어요. 내일 다시 만나요.');
      }
      if (input.mode === 'practice' && !await first(`SELECT attempt_id FROM game_results WHERE user_id = ? AND day = ? AND mode = 'daily'`, [userId, day])) {
        fail(409, 'DAILY_REQUIRED', '오늘의 공식 도전을 마치면 무료 연습이 열려요.');
      }
      const attemptId = uuid();
      // Each question receives independent randomness. A revealed item must not
      // provide the seed needed to reconstruct any future question in the set.
      const questions = fieldsForDay(day).map((field, index) => ({
        ...generateQuestion(field, index + 1, `${input.mode}:${uuid()}`), id: uuid(),
      }));
      const payload = { index: 0, questions, answers: [], timings: [], issuedAt: null, memoryUntil: null };
      setCurrentClock(payload, timestamp);
      const expiresAt = endOfDay(day);
      return {
        next: { ...player, active_id: attemptId }, expiresAt,
        week: input.mode === 'daily' ? week : null,
        extraWhere: input.mode === 'daily' ? 'AND NOT EXISTS (SELECT 1 FROM game_closed_weeks WHERE week = ?)' : '',
        extraValues: input.mode === 'daily' ? [week] : [],
        statements: [prepare(`INSERT INTO game_attempts
          (id, user_id, day, week, mode, status, payload, expires_at, created_at, completed_at)
          SELECT ?, ?, ?, ?, ?, 'active', ?, ?, ?, NULL WHERE ${GATE}`,
        [attemptId, userId, day, week, input.mode, JSON.stringify(payload), expiresAt, timestamp, ...gateArgs(userId, token)])],
      };
    });
  }

  async function ownedAttempt(userId, attemptId) {
    requireId(attemptId, '도전');
    const row = await first('SELECT * FROM game_attempts WHERE id = ? AND user_id = ?', [attemptId, userId]);
    if (!row) fail(404, 'ATTEMPT_NOT_FOUND', '진행 중인 도전을 찾을 수 없어요.');
    return row;
  }
  function assertCurrent(player, row, timestamp) {
    if (row.status !== 'active' || timestamp >= row.expires_at) fail(409, 'ATTEMPT_EXPIRED', '이 도전은 마감됐어요. 오늘의 도전을 확인해 주세요.');
    if (player.active_id !== row.id) fail(409, 'ATTEMPT_CHANGED', '다른 창에서 진행한 내용을 확인해 주세요.');
  }

  async function memory(userId, input) {
    requireInput(input); requireId(input.attemptId, '도전'); requireId(input.questionId, '문제');
    return mutate(userId, input, 'memory', { attemptId: input.attemptId, questionId: input.questionId }, async (player, token) => {
      const row = await ownedAttempt(userId, input.attemptId), timestamp = clock();
      assertCurrent(player, row, timestamp);
      const active = attemptPayload(row), question = active.questions[active.index];
      if (question.id !== input.questionId) fail(409, 'QUESTION_CHANGED', '현재 표시된 문제를 다시 확인해 주세요.');
      if (question.visual?.type !== 'memory') fail(400, 'NOT_MEMORY', '기억 배열을 사용하는 문제가 아니에요.');
      if (active.memoryUntil != null) return { next: player };
      active.memoryUntil = timestamp + question.visual.seconds * 1000;
      active.issuedAt = active.memoryUntil;
      return {
        next: player, expiresAt: row.expires_at,
        statements: [prepare(`UPDATE game_attempts SET payload = ? WHERE id = ? AND user_id = ? AND ${GATE}`,
          [JSON.stringify(active), row.id, userId, ...gateArgs(userId, token)])],
      };
    });
  }

  async function answer(userId, input) {
    requireInput(input); requireId(input.attemptId, '도전'); requireId(input.questionId, '문제');
    if (!Number.isInteger(input.index) || input.index < 0 || input.index > 4 || !Number.isInteger(input.selected) || input.selected < 0 || input.selected > 3) {
      fail(400, 'INVALID_ANSWER', '현재 문제의 보기 중 하나를 선택해 주세요.');
    }
    return mutate(userId, input, 'answer', { attemptId: input.attemptId, questionId: input.questionId, index: input.index, selected: input.selected }, async (player, token, receivedAt) => {
      const row = await ownedAttempt(userId, input.attemptId), active = attemptPayload(row);
      const requestedQuestion = active.questions[input.index];
      if (requestedQuestion?.id !== input.questionId) fail(409, 'QUESTION_CHANGED', '현재 표시된 문제를 다시 확인해 주세요.');
      if (input.index < active.answers.length) {
        if (active.answers[input.index] === input.selected) return { next: player };
        fail(409, 'ANSWER_ALREADY_LOCKED', '이미 확정한 답은 바꿀 수 없어요.');
      }
      assertCurrent(player, row, clock());
      if (input.index !== active.index) fail(409, 'QUESTION_ORDER', '현재 문제를 먼저 풀어 주세요.');
      const question = active.questions[active.index];
      if (active.issuedAt == null || receivedAt < active.issuedAt) fail(409, 'QUESTION_NOT_READY', '배열을 모두 본 다음 답을 골라 주세요.');
      active.answers.push(input.selected);
      active.timings.push(receivedAt - active.issuedAt);
      const finished = active.answers.length === 5;
      const next = { ...player };
      const statements = [];
      if (finished) {
        next.active_id = null;
        if (row.mode === 'daily') next.coins += DAILY_COMPLETION_COINS;
      } else {
        active.index += 1;
        setCurrentClock(active, clock());
      }
      statements.push(prepare(`UPDATE game_attempts SET payload = ?, status = ?, completed_at = ?
        WHERE id = ? AND user_id = ? AND ${GATE}`,
      [JSON.stringify(active), finished ? 'complete' : 'active', finished ? receivedAt : null, row.id, userId, ...gateArgs(userId, token)]));
      if (finished) {
        const result = completedResult(row, active, receivedAt);
        statements.push(prepare(`INSERT INTO game_results
          (attempt_id, user_id, day, week, mode, correct, total_time_ms, score_cent, result, completed_at)
          SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE ${GATE}`,
        [row.id, userId, row.day, row.week, row.mode, result.correct, result.totalTimeMs, Math.round(result.score * 100), JSON.stringify(result), receivedAt, ...gateArgs(userId, token)]));
        if (row.mode === 'daily') statements.push(prepare(`INSERT INTO game_coin_ledger
          (user_id, reference, reason, amount, created_at) SELECT ?, ?, 'daily', ?, ? WHERE ${GATE}`,
        [userId, `daily:${row.day}`, DAILY_COMPLETION_COINS, receivedAt, ...gateArgs(userId, token)]));
      }
      return {
        next, statements, expiresAt: row.expires_at,
        week: row.mode === 'daily' ? row.week : null,
        extraWhere: row.mode === 'daily' ? 'AND NOT EXISTS (SELECT 1 FROM game_closed_weeks WHERE week = ?)' : '',
        extraValues: row.mode === 'daily' ? [row.week] : [],
      };
    });
  }

  function catalogItem(itemId) {
    requireId(itemId, '상품');
    const item = CATALOG.find(candidate => candidate.id === itemId);
    if (!item) fail(404, 'ITEM_NOT_FOUND', '상품을 찾을 수 없어요.');
    return item;
  }
  async function purchase(userId, input) {
    requireInput(input);
    const item = catalogItem(input.itemId);
    return mutate(userId, input, 'purchase', { itemId: item.id }, async (player, token, timestamp) => {
      const next = { ...player, equipped: { ...player.equipped, [item.slot]: item.value } };
      if (player.owned.includes(item.id)) return { next };
      if (player.coins < item.cost) fail(409, 'INSUFFICIENT_COINS', '코인이 조금 더 필요해요. 오늘의 도전을 완료해 보세요.');
      next.coins -= item.cost;
      next.owned = [...player.owned, item.id];
      return {
        next,
        statements: [prepare(`INSERT INTO game_coin_ledger (user_id, reference, reason, amount, created_at)
          SELECT ?, ?, 'purchase', ?, ? WHERE ${GATE}`,
        [userId, `purchase:${item.id}`, -item.cost, timestamp, ...gateArgs(userId, token)])],
      };
    });
  }
  async function equip(userId, input) {
    requireInput(input);
    const item = catalogItem(input.itemId);
    return mutate(userId, input, 'equip', { itemId: item.id }, async player => {
      if (!player.owned.includes(item.id)) fail(403, 'ITEM_NOT_OWNED', '먼저 이 친구나 아이템을 구매해 주세요.');
      return { next: { ...player, equipped: { ...player.equipped, [item.slot]: item.value } } };
    });
  }
  async function rename(userId, input) {
    requireInput(input);
    const name = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
    if (!/^[가-힣ㄱ-ㅎㅏ-ㅣA-Za-z0-9 ]{2,12}$/.test(name)) fail(400, 'INVALID_NAME', '한글·영문·숫자와 공백으로 2~12글자를 입력해 주세요.');
    return mutate(userId, input, 'rename', { name }, async player => ({ next: { ...player, name } }));
  }

  async function exportData(userId) {
    await maintainUser(userId);
    const response = await snapshot(userId);
    const data = await database.batch([
      prepare(`SELECT id FROM game_players WHERE id = ? AND ${accountAllowedSql('game_players.id')}`, [userId]),
      prepare('SELECT result FROM game_results WHERE user_id = ? ORDER BY day, mode', [userId]),
      prepare('SELECT reference, reason, amount, created_at AS createdAt FROM game_coin_ledger WHERE user_id = ? ORDER BY created_at, reference', [userId]),
      prepare('SELECT day, mode, status, created_at AS createdAt, completed_at AS completedAt FROM game_attempts WHERE user_id = ? ORDER BY day, mode', [userId]),
    ]);
    requireAllowed(data[0].results[0]);
    return {
      ...response,
      export: {
        format: 'haru-five-account-v1', exportedAt: new Date(response.serverNow).toISOString(),
        profile: { playerId: response.state.playerId, name: response.state.name, coins: response.state.coins,
          owned: response.state.owned, equipped: response.state.equipped, createdAt: response.state.createdAt },
        results: data[1].results.map(row => readJson(row.result)),
        awards: response.state.awards, coinLedger: data[2].results, attempts: data[3].results,
      },
    };
  }

  return Object.freeze({ bootstrap, start, memory, answer, purchase, equip, rename, exportData });
}
