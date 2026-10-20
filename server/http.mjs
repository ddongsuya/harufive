import { createGameService, GameError } from './game-service.mjs';

export const GAME_VERSION = '0.5.1';
export const BODY_LIMIT = 4096;
export const REQUESTS_PER_MINUTE = 120;

const ACTIONS = Object.freeze({
  bootstrap: { method: 'GET', service: 'bootstrap' },
  export: { method: 'GET', service: 'exportData' },
  start: { method: 'POST', keys: ['mode', 'requestId'] },
  memory: { method: 'POST', keys: ['attemptId', 'questionId', 'requestId'] },
  answer: { method: 'POST', keys: ['attemptId', 'questionId', 'index', 'selected', 'requestId'] },
  purchase: { method: 'POST', keys: ['itemId', 'requestId'] },
  equip: { method: 'POST', keys: ['itemId', 'requestId'] },
  rename: { method: 'POST', keys: ['name', 'requestId'] },
});

function json(payload, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'private, no-store',
      'Vary': 'Cookie',
      'X-Content-Type-Options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function rejected(status, code, message, extra = {}, headers = {}) {
  return json({ code, message, ...extra }, status, headers);
}

async function readBody(request, keys) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength != null && (!/^\d+$/.test(declaredLength) || Number(declaredLength) > BODY_LIMIT)) {
    throw new GameError(413, 'BODY_TOO_LARGE', '요청 내용이 너무 커요. 게임 화면에서 다시 시도해 주세요.');
  }
  const reader = request.body?.getReader();
  if (!reader) throw new GameError(400, 'INVALID_JSON', '요청 내용이 비어 있어요.');
  const chunks = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > BODY_LIMIT) {
        await reader.cancel();
        throw new GameError(413, 'BODY_TOO_LARGE', '요청 내용이 너무 커요. 게임 화면에서 다시 시도해 주세요.');
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new GameError(400, 'INVALID_JSON', '요청 내용을 읽지 못했어요. 다시 시도해 주세요.'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new GameError(400, 'INVALID_JSON', '요청 형식이 올바르지 않아요.');
  }
  if (Object.keys(body).some(key => !keys.includes(key))) {
    throw new GameError(400, 'UNEXPECTED_FIELD', '허용되지 않은 요청 정보가 포함되어 있어요.');
  }
  return body;
}

async function rateLimit(db, userId, timestamp, now) {
  const windowStart = Math.floor(timestamp / 60000) * 60000;
  const row = await db.prepare(`INSERT INTO game_rate_limits (user_id, window_start, request_count)
    VALUES (?, ?, 1)
    ON CONFLICT(user_id) DO UPDATE SET
      request_count = CASE WHEN excluded.window_start > game_rate_limits.window_start
        THEN 1 ELSE MIN(game_rate_limits.request_count + 1, ?) END,
      window_start = MAX(game_rate_limits.window_start, excluded.window_start)
    RETURNING request_count, window_start`).bind(userId, windowStart, REQUESTS_PER_MINUTE + 1).first();
  if (!row || row.request_count > REQUESTS_PER_MINUTE) {
    return Math.max(1, Math.ceil(((row?.window_start ?? windowStart) + 60000 - Math.floor(now())) / 1000));
  }
  return 0;
}

/**
 * Identity is supplied ONLY by a trusted server auth resolver in the route.
 * The resolver verifies a server session or the existing Sites identity. A
 * request field/header never chooses an account. An expected public player ID
 * only detects a stale tab after switching accounts and cannot grant access.
 * @param {Request} request
 * @param {{ action?: string, userId?: string, resolveUserId?: Function, db?: import('@cloudflare/workers-types').D1Database, now?: () => number, makeService?: Function }} [options]
 */
export async function handleGameRequest(request, { action, userId, resolveUserId, db, now = Date.now, makeService = createGameService } = {}) {
  const validIdentity = id => typeof id === 'string' && !!id.trim() && id.length <= 200;
  const signInRequired = () => rejected(401, 'SIGN_IN_REQUIRED', '로그인하고 나만의 기록을 이어가세요.', {
      signInUrl: '/signin-with-chatgpt?return_to=%2F',
    });
  if (!validIdentity(userId) && typeof resolveUserId !== 'function') {
    return signInRequired();
  }
  const definition = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : null;
  if (!definition) return rejected(404, 'NOT_FOUND', '요청한 기능을 찾지 못했어요.');
  if (request.method !== definition.method) {
    return rejected(405, 'METHOD_NOT_ALLOWED', '허용되지 않은 요청 방식이에요.', {}, { Allow: definition.method });
  }
  const origin = request.headers.get('Origin');
  const fetchSite = request.headers.get('Sec-Fetch-Site');
  if (fetchSite === 'cross-site' || (origin != null && origin !== new URL(request.url).origin) ||
      (definition.method === 'POST' && origin == null)) {
    return rejected(403, 'ORIGIN_REJECTED', '게임 화면을 다시 열고 시도해 주세요.');
  }
  if (definition.method === 'POST' && request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return rejected(415, 'JSON_REQUIRED', '이 요청은 JSON 형식이어야 해요.');
  }
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    return rejected(503, 'SERVICE_UNAVAILABLE', '기록 저장소를 준비하고 있어요. 잠시 후 다시 이용해 주세요.');
  }
  try {
    const body = definition.method === 'POST' ? await readBody(request, definition.keys) : undefined;
    const timestamp = Math.floor(now());
    if (!Number.isSafeInteger(timestamp) || timestamp < 0) throw new Error('clock_unavailable');
    // Read the complete answer before a potentially slow D1 auth lookup, so
    // auth database latency is not added to the player's answer time.
    if (typeof resolveUserId === 'function') userId = await resolveUserId();
    if (!validIdentity(userId)) return signInRequired();
    const expectedPlayer = request.headers.get('X-Haru-Player');
    if (definition.method === 'POST' || action === 'export') {
      const owner = expectedPlayer && expectedPlayer.length <= 200
        ? await db.prepare('SELECT public_id FROM game_players WHERE id = ?').bind(userId).first()
        : null;
      if (!owner || owner.public_id !== expectedPlayer) {
        return rejected(409, 'ACCOUNT_CHANGED', '로그인한 계정이나 화면 버전이 바뀌었어요. 화면을 새로 열어 현재 기록을 확인한 뒤 다시 시도해 주세요.');
      }
    }
    const retryAfter = await rateLimit(db, userId, timestamp, now);
    if (retryAfter) {
      return rejected(429, 'RATE_LIMITED', `요청이 잠시 몰렸어요. ${retryAfter}초 뒤 다시 시도해 주세요.`, {}, { 'Retry-After': String(retryAfter) });
    }
    // The complete answer body has arrived. Exclude the database quota lookup
    // from the score clock, while a slowly streamed body still consumes time.
    const service = makeService({ db, now, requestReceivedAt: timestamp });
    const result = await service[definition.service || action](userId, body);
    return json(result, 200, action === 'export' ? { 'Content-Disposition': 'attachment; filename="haru-five-my-data.json"' } : {});
  } catch (error) {
    if (error instanceof GameError && Number.isInteger(error.status) && error.status >= 400 && error.status < 500) {
      return rejected(error.status, error.code, error.message);
    }
    // Never return SQL errors, account identifiers, answers or exception stacks.
    return rejected(503, 'SERVICE_UNAVAILABLE', '서버와 연결하지 못했어요. 잠시 후 같은 요청으로 다시 확인해 주세요.');
  }
}

export async function handleHealthRequest(db) {
  try {
    if (!db) throw new Error('storage_unavailable');
    const row = await db.prepare(`SELECT COUNT(*) AS count FROM sqlite_schema
      WHERE type = 'table' AND name IN ('game_players', 'game_attempts', 'game_results',
      'game_mutation_receipts', 'game_coin_ledger', 'game_closed_weeks', 'game_weekly_awards', 'game_rate_limits',
      'auth_accounts', 'auth_identities', 'auth_sessions', 'auth_oauth_transactions', 'auth_rate_limits')`).first();
    if (row?.count !== 13) throw new Error('schema_unavailable');
    await db.prepare(`SELECT t.claim_token, s.binding_hash FROM auth_oauth_transactions t
      LEFT JOIN auth_sessions s ON s.binding_hash = t.binding_hash LIMIT 0`).all();
    return json({ status: 'ok', version: GAME_VERSION, database: 'ready' });
  } catch {
    return json({ status: 'unavailable', version: GAME_VERSION, database: 'unavailable' }, 503);
  }
}
