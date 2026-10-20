import { importSPKI, jwtVerify } from 'jose';
import { PrivacyError, accountAllowedSql, guardianAuthoritySql, accountSessionSql } from './privacy-contract.mjs';

export const GUARDIAN_SCOPES = Object.freeze(['account:create', 'game:play', 'game:records']);
export const GUARDIAN_LIMITS = Object.freeze({ requestMs: 5 * 24 * 60 * 60 * 1000, proofSeconds: 300, pendingPerGuardian: 5, pendingTotal: 1000, proofBytes: 16384 });
const encoder = new TextEncoder();
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const idPattern = /^[A-Za-z0-9:_-]{1,200}$/;

function fail(status, code) { throw new PrivacyError(status, code); }
function identifier(value) {
  if (typeof value !== 'string' || !idPattern.test(value)) fail(400, 'INVALID_REQUEST');
  return value;
}
function randomToken() {
  return btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}
async function digest(value) {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
  return [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
}
function configuration(env) {
  const key = env.HARU_GUARDIAN_ATTESTATION_PUBLIC_KEY;
  const issuer = env.HARU_GUARDIAN_ATTESTATION_ISSUER;
  const audience = env.HARU_GUARDIAN_ATTESTATION_AUDIENCE;
  const policyVersion = env.HARU_GUARDIAN_POLICY_VERSION;
  if (typeof key !== 'string' || key.length > 8192 || !key.startsWith('-----BEGIN PUBLIC KEY-----') ||
      ![issuer, audience, policyVersion].every(value => typeof value === 'string' && value.length > 0 && value.length <= 300 && value.trim() === value && !/[\r\n\u0000]/.test(value))) return null;
  try { if (new URL(issuer).protocol !== 'https:') return null; } catch { return null; }
  return { key, issuer, audience, policyVersion };
}
function requestView(row) {
  return { requestId: row.id, status: row.state, createdAt: row.created_at, expiresAt: row.expires_at, policyVersion: row.policy_version };
}
function guardianAccountAllowedSql(expression, sessionProof) {
  return `(EXISTS (SELECT 1 FROM auth_accounts AS guardian_account WHERE guardian_account.id = ${expression} AND guardian_account.disabled_at IS NULL)
    AND ${accountAllowedSql(expression)}
    AND NOT EXISTS (SELECT 1 FROM guardian_links AS guardian_child WHERE guardian_child.child_account_id = ${expression})
    AND ${accountSessionSql(expression, sessionProof)})`;
}

/**
 * This is a server-only contract for a future independently verified provider.
 * No provider is selected or simulated here, and no child enrollment HTTP route
 * is exposed. In particular, a signed-in adult is not proof of guardianship.
 */
export function createGuardianService({ db, env = {}, now = Date.now, sessionProof }) {
  const database = db.withSession?.('first-primary') || db;
  const config = configuration(env);
  const proof = sessionProof === undefined ? undefined : Object.freeze({ tokenHash: sessionProof?.tokenHash });
  const guardianAllowedSql = expression => guardianAccountAllowedSql(expression, proof);
  accountSessionSql('auth_accounts.id', proof); // Validate server proof before any access.
  let keyPromise;
  function time() {
    const value = Math.floor(now());
    if (!Number.isSafeInteger(value) || value < 0) fail(503, 'CLOCK_UNAVAILABLE');
    return value;
  }
  function statement(sql, ...values) { return database.prepare(sql).bind(...values); }
  async function requireGuardian(guardianId) {
    identifier(guardianId);
    const allowed = await statement(`SELECT 1 AS allowed FROM auth_accounts WHERE id = ? AND ${guardianAllowedSql('auth_accounts.id')}`, guardianId).first();
    if (!allowed) fail(403, 'GUARDIAN_ACCESS_DENIED');
  }
  async function verifierKey() {
    if (!config) fail(503, 'GUARDIAN_NOT_CONFIGURED');
    try { return await (keyPromise ||= importSPKI(config.key, 'RS256')); }
    catch { fail(503, 'GUARDIAN_NOT_CONFIGURED'); }
  }
  async function ownedRequest(guardianId, requestId) {
    await requireGuardian(guardianId);
    identifier(requestId);
    const row = await statement(`SELECT * FROM guardian_requests WHERE id = ? AND guardian_account_id = ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}`, requestId, guardianId).first();
    if (!row) fail(404, 'GUARDIAN_REQUEST_NOT_FOUND');
    if (row.expires_at <= time()) fail(410, 'GUARDIAN_REQUEST_EXPIRED');
    return row;
  }
  async function createRequest(guardianId) {
    await requireGuardian(guardianId);
    await verifierKey();
    const createdAt = time();
    const requestId = crypto.randomUUID();
    const requestToken = randomToken();
    const nonce = randomToken();
    const tokenHash = await digest(requestToken);
    const nonceHash = await digest(nonce);
    const result = await statement(`INSERT INTO guardian_requests (id, guardian_account_id, token_hash, nonce_hash, created_at, expires_at, policy_version, state)
      SELECT ?, candidate.guardian_id, ?, ?, ?, ?, ?, 'pending' FROM (SELECT ? AS guardian_id) candidate WHERE ${guardianAllowedSql('candidate.guardian_id')}
      AND (SELECT COUNT(*) FROM guardian_requests WHERE guardian_account_id = candidate.guardian_id) < ?
      AND (SELECT COUNT(*) FROM guardian_requests) < ?`, requestId, tokenHash, nonceHash, createdAt,
    createdAt + GUARDIAN_LIMITS.requestMs, config.policyVersion, guardianId, GUARDIAN_LIMITS.pendingPerGuardian, GUARDIAN_LIMITS.pendingTotal).run();
    if (!result.meta.changes) fail(409, 'GUARDIAN_REQUEST_UNAVAILABLE');
    return { requestId, requestToken, nonce, status: 'pending', createdAt, expiresAt: createdAt + GUARDIAN_LIMITS.requestMs, policyVersion: config.policyVersion };
  }
  async function listRequests(guardianId) {
    await requireGuardian(guardianId);
    const rows = await statement(`SELECT id, state, created_at, expires_at, policy_version FROM guardian_requests
      WHERE guardian_account_id = ? AND expires_at > ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}
      ORDER BY created_at DESC LIMIT 5`, guardianId, time()).all();
    return rows.results.map(requestView);
  }
  async function rotateRequestToken(guardianId, requestId) {
    const row = await ownedRequest(guardianId, requestId);
    if (row.state !== 'pending') fail(409, 'GUARDIAN_REQUEST_USED');
    const requestToken = randomToken();
    const nonce = randomToken();
    const tokenHash = await digest(requestToken);
    const nonceHash = await digest(nonce);
    const result = await statement(`UPDATE guardian_requests SET token_hash = ?, nonce_hash = ? WHERE id = ? AND guardian_account_id = ? AND state = 'pending' AND expires_at > ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}`,
      tokenHash, nonceHash, requestId, guardianId, time()).run();
    if (!result.meta.changes) fail(409, 'GUARDIAN_REQUEST_USED');
    return { ...requestView(row), requestToken, nonce };
  }
  async function approveRequest(guardianId, { requestId, requestToken, attestation } = {}) {
    const row = await ownedRequest(guardianId, requestId);
    const key = await verifierKey();
    if (row.policy_version !== config.policyVersion) fail(409, 'GUARDIAN_POLICY_CHANGED');
    if (typeof requestToken !== 'string' || !tokenPattern.test(requestToken) || await digest(requestToken) !== row.token_hash ||
        typeof attestation !== 'string' || attestation.length > GUARDIAN_LIMITS.proofBytes) fail(400, 'GUARDIAN_PROOF_REJECTED');
    let payload;
    try {
      ({ payload } = await jwtVerify(attestation, key, {
        algorithms: ['RS256'], issuer: config.issuer, audience: config.audience,
        typ: 'guardian-consent+jwt', requiredClaims: ['iat', 'exp', 'jti', 'sub'],
        maxTokenAge: GUARDIAN_LIMITS.proofSeconds, currentDate: new Date(time()), clockTolerance: 0,
      }));
    } catch { fail(400, 'GUARDIAN_PROOF_REJECTED'); }
    if (payload.requestId !== requestId || payload.guardianAccountId !== guardianId ||
      typeof payload.nonce !== 'string' || !tokenPattern.test(payload.nonce) || await digest(payload.nonce) !== row.nonce_hash ||
      payload.identityVerified !== true || payload.guardianAdultVerified !== true || payload.relationshipVerified !== true || payload.consentGiven !== true ||
      payload.policyVersion !== row.policy_version || !Array.isArray(payload.consentScopes) ||
      payload.consentScopes.length !== GUARDIAN_SCOPES.length || !GUARDIAN_SCOPES.every(scope => payload.consentScopes.includes(scope)) ||
      !Number.isSafeInteger(payload.iat) || !Number.isSafeInteger(payload.exp) || payload.exp <= payload.iat ||
      payload.exp - payload.iat > GUARDIAN_LIMITS.proofSeconds || payload.iat < Math.floor(row.created_at / 1000) || payload.exp * 1000 > row.expires_at ||
      typeof payload.sub !== 'string' || payload.sub.length < 1 || payload.sub.length > 500 || typeof payload.jti !== 'string' || payload.jti.length < 1 || payload.jti.length > 500) fail(400, 'GUARDIAN_PROOF_REJECTED');
    const proofHash = await digest(attestation);
    const jtiHash = await digest(`${config.issuer}\n${payload.jti}`);
    const subjectHash = await digest(`${config.issuer}\n${payload.sub}`);
    if (row.state === 'approved') {
      const same = await statement(`SELECT guardian_consents.id FROM guardian_consents JOIN guardian_requests ON guardian_requests.id = guardian_consents.id
        WHERE guardian_consents.id = ? AND guardian_consents.guardian_account_id = ? AND proof_hash = ? AND withdrawn_at IS NULL
        AND guardian_requests.state = 'approved' AND guardian_requests.expires_at > ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}`,
      requestId, guardianId, proofHash, time()).first();
      if (same) return requestView(row);
      fail(409, 'GUARDIAN_REQUEST_USED');
    }
    const operation = randomToken();
    const approvedAt = time();
    if (payload.exp * 1000 <= approvedAt) fail(400, 'GUARDIAN_PROOF_REJECTED');
    const batch = await database.batch([
      // Database time closes the queueing gap between JS verification and the
      // atomic UPDATE. It cannot accept a proof whose exp elapsed in transit.
      statement(`UPDATE guardian_requests SET state = 'approved', consume_token = ? WHERE id = ? AND guardian_account_id = ? AND state = 'pending' AND token_hash = ? AND nonce_hash = ? AND expires_at > ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}
        AND ? > unixepoch('now') AND ? <= unixepoch('now')
        AND CAST(expires_at / 1000 AS INTEGER) > unixepoch('now')
        AND NOT EXISTS (SELECT 1 FROM guardian_consents WHERE jti_hash = ? OR proof_hash = ?)`, operation, requestId, guardianId, row.token_hash, row.nonce_hash, approvedAt, payload.exp, payload.iat, jtiHash, proofHash),
      statement(`INSERT INTO guardian_consents (id, guardian_account_id, proof_hash, jti_hash, subject_hash, scopes, policy_version, approved_at)
        SELECT id, guardian_account_id, ?, ?, ?, ?, policy_version, ? FROM guardian_requests WHERE id = ? AND consume_token = ? AND state = 'approved'`,
      proofHash, jtiHash, subjectHash, JSON.stringify(GUARDIAN_SCOPES), approvedAt, requestId, operation),
      statement('UPDATE guardian_requests SET consume_token = NULL WHERE id = ? AND consume_token = ?', requestId, operation),
    ]);
    if (!batch[0].meta.changes) {
      // A duplicate callback may have read 'pending' before the first callback
      // committed. Re-read the exact proof under the current authorization.
      const same = await statement(`SELECT guardian_requests.id FROM guardian_requests JOIN guardian_consents ON guardian_consents.id = guardian_requests.id
        WHERE guardian_requests.id = ? AND guardian_requests.guardian_account_id = ? AND guardian_requests.state = 'approved'
        AND guardian_requests.expires_at > ? AND proof_hash = ? AND withdrawn_at IS NULL AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}`,
      requestId, guardianId, time(), proofHash).first();
      if (!same) fail(409, 'GUARDIAN_REQUEST_USED');
    }
    return requestView({ ...row, state: 'approved' });
  }
  async function rejectRequest(guardianId, requestId) {
    await requireGuardian(guardianId);
    identifier(requestId);
    const operation = randomToken();
    const batch = await database.batch([
      // Authorize once inside this transaction, then use a private operation
      // token for both removals. Re-evaluating a moving session deadline after
      // removing the proof could otherwise leave an unusable approved request.
      statement(`UPDATE guardian_requests SET consume_token = ? WHERE id = ? AND guardian_account_id = ?
        AND state IN ('pending', 'approved') AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}`, operation, requestId, guardianId),
      statement(`DELETE FROM guardian_consents WHERE id = ? AND guardian_account_id = ? AND child_account_id IS NULL
        AND EXISTS (SELECT 1 FROM guardian_requests WHERE id = ? AND consume_token = ?)`, requestId, guardianId, requestId, operation),
      statement('DELETE FROM guardian_requests WHERE id = ? AND consume_token = ?', requestId, operation),
    ]);
    return { removed: batch[2].meta.changes > 0 };
  }
  // Only a future trusted enrollment adapter may call this after its own child
  // identity binding. It never creates an auth account, identity, or player.
  async function bindChild(guardianId, { requestId, childId } = {}) {
    const request = await ownedRequest(guardianId, requestId);
    if (!config) fail(503, 'GUARDIAN_NOT_CONFIGURED');
    if (request.policy_version !== config.policyVersion) fail(409, 'GUARDIAN_POLICY_CHANGED');
    identifier(childId);
    if (guardianId === childId) fail(400, 'GUARDIAN_CHILD_INVALID');
    const operation = randomToken();
    const at = time();
    const batch = await database.batch([
      statement(`UPDATE guardian_requests SET state = 'consumed', consume_token = ? WHERE id = ? AND guardian_account_id = ? AND state = 'approved' AND expires_at > ? AND ${guardianAllowedSql('guardian_requests.guardian_account_id')}
        AND CAST(expires_at / 1000 AS INTEGER) > unixepoch('now')
        AND guardian_requests.policy_version = ?
        AND EXISTS (SELECT 1 FROM guardian_consents WHERE id = guardian_requests.id
          AND guardian_consents.guardian_account_id = guardian_requests.guardian_account_id
          AND guardian_consents.policy_version = ? AND child_account_id IS NULL AND withdrawn_at IS NULL)
        AND EXISTS (SELECT 1 FROM privacy_account_controls WHERE account_id = ? AND state = 'pending')
        AND EXISTS (SELECT 1 FROM auth_accounts WHERE id = ? AND disabled_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM game_players WHERE id = ?)
        AND NOT EXISTS (SELECT 1 FROM guardian_links WHERE child_account_id = ? OR guardian_account_id = ?)
        AND NOT EXISTS (SELECT 1 FROM guardian_requests AS child_request WHERE child_request.guardian_account_id = ?)`,
      operation, requestId, guardianId, at, config.policyVersion, config.policyVersion, childId, childId, childId, childId, childId, childId),
      statement(`INSERT INTO guardian_links (child_account_id, guardian_account_id, consent_id, state, linked_at)
        SELECT ?, guardian_account_id, id, 'active', ? FROM guardian_requests WHERE id = ? AND consume_token = ? AND state = 'consumed'`, childId, at, requestId, operation),
      statement(`UPDATE guardian_consents SET child_account_id = ? WHERE id = ? AND EXISTS
        (SELECT 1 FROM guardian_requests WHERE id = ? AND consume_token = ? AND state = 'consumed')`, childId, requestId, requestId, operation),
      statement(`UPDATE privacy_account_controls SET state = 'active', updated_at = ? WHERE account_id = ? AND state = 'pending' AND EXISTS
        (SELECT 1 FROM guardian_requests WHERE id = ? AND consume_token = ? AND state = 'consumed')`, at, childId, requestId, operation),
      statement('DELETE FROM guardian_requests WHERE id = ? AND consume_token = ? AND state = \'consumed\'', requestId, operation),
    ]);
    if (!batch[0].meta.changes) fail(409, 'GUARDIAN_CHILD_UNAVAILABLE');
    return { childId, status: 'active' };
  }
  async function authorizeGuardian(guardianId, childId) {
    identifier(guardianId); identifier(childId);
    const allowed = await statement(`SELECT 1 AS allowed FROM (SELECT ? AS guardian_id, ? AS child_id) actor
      WHERE ${guardianAuthoritySql('actor.child_id', 'actor.guardian_id')} AND ${accountSessionSql('actor.guardian_id', proof)}`, guardianId, childId).first();
    if (!allowed) fail(403, 'GUARDIAN_ACCESS_DENIED');
    return true;
  }
  async function purgeExpired() {
    const at = time();
    const batch = await database.batch([
      statement(`DELETE FROM guardian_consents WHERE child_account_id IS NULL AND EXISTS
        (SELECT 1 FROM guardian_requests WHERE guardian_requests.id = guardian_consents.id AND expires_at <= ?)`, at),
      statement('DELETE FROM guardian_requests WHERE expires_at <= ?', at),
    ]);
    return { expiredRequests: batch[1].meta.changes, expiredUnboundConsents: batch[0].meta.changes };
  }
  function status() {
    return { guardianReady: false, providerConfigured: !!config, enrollmentOpen: false };
  }
  return { createRequest, listRequests, rotateRequestToken, approveRequest, rejectRequest, bindChild, authorizeGuardian, purgeExpired, status };
}
