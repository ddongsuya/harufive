import { resolvePrivacyIdentity } from './auth-service.mjs';
import { createAccountLifecycle } from './account-lifecycle.mjs';
import { createGuardianService } from './guardian-service.mjs';
import { PrivacyError, accountAllowedSql, accountSessionSql } from './privacy-contract.mjs';

export const PRIVACY_LIMITS = Object.freeze({ bodyBytes: 24576, freshSessionMs: 15 * 60000, requestsPerMinute: 30 });
const RIGHTS = Object.freeze({
  status: ['childAccountId'], export: ['childAccountId'],
  withdraw: ['childAccountId', 'confirmation'], delete: ['childAccountId', 'confirmation'],
});
const GUARDIAN = Object.freeze({
  create: [], rotate: ['requestId'], approve: ['requestId', 'requestToken', 'attestation'], reject: ['requestId'],
});
const fail = (status, code, message) => { throw new PrivacyError(status, code, message); };
const json = (payload, status = 200, headers = {}) => Response.json(payload, {
  status, headers: { 'Cache-Control': 'private, no-store', Vary: 'Cookie', 'X-Content-Type-Options': 'nosniff', ...headers },
});

async function readBody(request, allowed) {
  if (request.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !== 'application/json') fail(415, 'JSON_REQUIRED');
  const declared = request.headers.get('Content-Length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > PRIVACY_LIMITS.bodyBytes)) fail(413, 'BODY_TOO_LARGE');
  const reader = request.body?.getReader();
  if (!reader) fail(400, 'INVALID_JSON');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > PRIVACY_LIMITS.bodyBytes) { await reader.cancel(); fail(413, 'BODY_TOO_LARGE'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { fail(400, 'INVALID_JSON'); }
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'INVALID_JSON');
  if (Object.keys(body).some(key => !allowed.includes(key))) fail(400, 'UNEXPECTED_FIELD');
  return body;
}

async function quota(db, userId, at, sessionProof) {
  // Share the account's game quota so alternating endpoints cannot evade it.
  const window = Math.floor(at / 60000) * 60000;
  const row = await db.prepare(`INSERT INTO game_rate_limits (user_id, window_start, request_count)
    SELECT candidate.id, ?, 1 FROM (SELECT ? AS id) candidate WHERE ${accountAllowedSql('candidate.id')} AND ${accountSessionSql('candidate.id', sessionProof)}
    ON CONFLICT(user_id) DO UPDATE SET
      request_count = CASE WHEN excluded.window_start > game_rate_limits.window_start THEN 1
        ELSE MIN(game_rate_limits.request_count + 1, ?) END,
      window_start = MAX(game_rate_limits.window_start, excluded.window_start)
    WHERE ${accountAllowedSql('game_rate_limits.user_id')} AND ${accountSessionSql('game_rate_limits.user_id', sessionProof)}
    RETURNING request_count`).bind(window, userId, 121).first();
  if (!row) fail(403, 'ACCOUNT_RESTRICTED');
  if (row.request_count > PRIVACY_LIMITS.requestsPerMinute) fail(429, 'RATE_LIMITED', '잠시 뒤 다시 시도해 주세요.');
}

/** Existing-account server APIs only. Enrollment and permanent deletion are not
 * public routes. Purge policy is deliberately never accepted from a request.
 * Withdrawal revokes all game sessions; the returned receipt confirms intake,
 * not erasure. A withdrawn child remains accessible to its verified guardian.
 */
export async function handlePrivacyRequest(request, { namespace, action, db, env = {}, now = Date.now } = {}) {
  try {
    const readStatus = namespace === 'privacy' && action === 'status' && request.method === 'GET';
    const readRequests = namespace === 'guardian' && action === 'requests';
    const definition = namespace === 'privacy' ? RIGHTS : namespace === 'guardian' ? GUARDIAN : {};
    if (!readStatus && !readRequests && !Object.hasOwn(definition, action)) fail(404, 'NOT_FOUND');
    const method = readStatus || readRequests ? 'GET' : 'POST';
    if (request.method !== method) return json({ code: 'METHOD_NOT_ALLOWED' }, 405, { Allow: method });
    const url = new URL(request.url);
    let origin;
    try {
      const configured = new URL(env.HARU_AUTH_ORIGIN);
      if (configured.protocol !== 'https:' || configured.pathname !== '/' || configured.search || configured.hash ||
          configured.username || configured.password || env.HARU_AUTH_ORIGIN !== env.HARU_AUTH_ORIGIN.trim()) throw new Error();
      origin = configured.origin;
    } catch { fail(503, 'AUTH_NOT_CONFIGURED'); }
    if (url.origin !== origin || request.headers.get('Sec-Fetch-Site') === 'cross-site' ||
        (request.headers.has('Origin') && request.headers.get('Origin') !== origin) ||
        (method === 'POST' && request.headers.get('Origin') !== origin)) fail(403, 'ORIGIN_REJECTED');
    if (url.search) fail(400, 'UNEXPECTED_FIELD');
    const body = method === 'POST' ? await readBody(request, definition[action]) : {};
    const identity = await resolvePrivacyIdentity(request, { db, env, now });
    if (!identity) fail(401, 'SIGN_IN_REQUIRED', '로그인 상태를 다시 확인해 주세요.');
    const age = Math.floor(now()) - identity.authenticatedAt;
    if (!Number.isSafeInteger(age) || age < 0 || age >= PRIVACY_LIMITS.freshSessionMs) {
      fail(401, 'REAUTH_REQUIRED', '정보 관리를 위해 다시 로그인해 주세요.');
    }
    if (method === 'POST' && request.headers.get('X-Haru-Account') !== identity.accountContext) {
      fail(409, 'ACCOUNT_CHANGED', '계정 정보 화면을 다시 열고 시도해 주세요.');
    }
    const database = db.withSession?.('first-primary') || db;
    const sessionProof = { tokenHash: identity.sessionHash };
    await quota(database, identity.userId, Math.floor(now()), sessionProof);
    const lifecycle = createAccountLifecycle({ db: database, now, sessionProof });
    const guardian = createGuardianService({ db: database, env, now, sessionProof });
    if (readStatus) return json({
      accountContext: identity.accountContext,
      account: await lifecycle.getStatus({ actorId: identity.userId, accountId: identity.userId }),
      guardian: guardian.status(),
      selfRecoveryReady: false,
    });
    if (readRequests) return json({ requests: await guardian.listRequests(identity.userId) });
    if (namespace === 'guardian') {
      const actor = identity.userId;
      const result = action === 'create' ? await guardian.createRequest(actor)
        : action === 'rotate' ? await guardian.rotateRequestToken(actor, body.requestId)
        : action === 'approve' ? await guardian.approveRequest(actor, body)
        : await guardian.rejectRequest(actor, body.requestId);
      return json(result);
    }
    if (body.childAccountId !== undefined && (typeof body.childAccountId !== 'string' || !body.childAccountId || body.childAccountId.length > 200)) fail(400, 'INVALID_REQUEST');
    const input = { actorId: identity.userId, accountId: body.childAccountId ?? identity.userId };
    if ((action === 'withdraw' || action === 'delete') && body.confirmation !== action) fail(400, 'CONFIRMATION_REQUIRED');
    const result = action === 'status' ? await lifecycle.getStatus(input)
      : action === 'export' ? await lifecycle.exportData(input)
      : action === 'withdraw' ? await lifecycle.withdraw(input)
      : await lifecycle.requestDeletion(input);
    return json(result, 200, action === 'export' ? { 'Content-Disposition': 'attachment; filename="haru-five-my-data.json"' } : {});
  } catch (error) {
    if (error instanceof PrivacyError) return json({ code: error.code, message: error.message }, error.status);
    return json({ code: 'SERVICE_UNAVAILABLE', message: '정보 관리 기능을 준비하고 있어요. 잠시 뒤 다시 확인해 주세요.' }, 503);
  }
}
