// SQL expressions passed here are server-owned identifiers/placeholders only.
// Never interpolate client input into an SQL expression.
export class PrivacyError extends Error {
  constructor(status, code, message = '요청을 처리할 권한이나 준비 상태를 확인해 주세요.') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

export function accountAllowedSql(accountExpression) {
  return `(NOT EXISTS (SELECT 1 FROM privacy_account_controls AS privacy_gate WHERE privacy_gate.account_id = ${accountExpression} AND privacy_gate.state != 'active')
    AND NOT EXISTS (SELECT 1 FROM auth_accounts AS privacy_auth WHERE privacy_auth.id = ${accountExpression} AND privacy_auth.disabled_at IS NOT NULL))`;
}

// Withdrawal closes gameplay; the established family link continues to allow
// the guardian to exercise rights for that child until the records are purged.
export function guardianAuthoritySql(accountExpression, guardianExpression) {
  return `(EXISTS (SELECT 1 FROM guardian_links AS privacy_link WHERE privacy_link.child_account_id = ${accountExpression}
      AND privacy_link.guardian_account_id = ${guardianExpression} AND privacy_link.state IN ('active', 'withdrawn'))
    AND EXISTS (SELECT 1 FROM auth_accounts AS privacy_guardian WHERE privacy_guardian.id = ${guardianExpression} AND privacy_guardian.disabled_at IS NULL)
    AND ${accountAllowedSql(guardianExpression)})`;
}

// Only a server-resolved session hash may be supplied. Undefined is reserved
// for trusted internal services/maintenance; HTTP must always pass proof.
export function accountSessionSql(accountExpression, sessionProof) {
  if (sessionProof === undefined) return '1 = 1';
  if (!sessionProof || typeof sessionProof.tokenHash !== 'string' || !/^[a-f0-9]{64}$/.test(sessionProof.tokenHash)) {
    throw new PrivacyError(403, 'SESSION_PROOF_INVALID');
  }
  // Literal insertion is safe only after the exact lowercase-hex validation.
  // Only a verified provider authentication time grants recent-auth rights.
  // Session creation is not proof of reauthentication; legacy NULL stays denied.
  // Conservative second boundaries may close access up to 999ms early.
  return `EXISTS (SELECT 1 FROM auth_sessions AS privacy_session
    WHERE privacy_session.account_id = ${accountExpression}
      AND privacy_session.token_hash = '${sessionProof.tokenHash}'
      AND privacy_session.revoked_at IS NULL
      AND CAST(privacy_session.expires_at / 1000 AS INTEGER) > unixepoch('now')
      AND typeof(privacy_session.authenticated_at) = 'integer'
      AND privacy_session.authenticated_at >= 0
      AND privacy_session.authenticated_at <= unixepoch('now') * 1000
      AND CAST((privacy_session.authenticated_at + 900000) / 1000 AS INTEGER) > unixepoch('now'))`;
}
