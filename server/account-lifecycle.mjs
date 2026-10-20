import { PrivacyError, guardianAuthoritySql, accountSessionSql, accountAllowedSql } from './privacy-contract.mjs';

const PAGE_LIMIT = 100;
export const MANAGED_CHILD_LIMIT = 100;
const ID = /^[^\u0000-\u001f\u007f]{1,200}$/;
const noAccess = () => new PrivacyError(403, 'RIGHTS_UNAVAILABLE', '이 계정의 정보 관리 권한을 확인해 주세요.');
const actorAuthority = `rights.actor_id = rights.account_id
  OR ${guardianAuthoritySql('rights.account_id', 'rights.actor_id')}`;
const authoritySql = sessionProof => `EXISTS (
  SELECT 1 FROM (SELECT ? AS actor_id, ? AS account_id) rights
  WHERE (${actorAuthority}) AND ${accountSessionSql('rights.actor_id', sessionProof)}
)`;
const closedAuthoritySql = sessionProof => `EXISTS (
  SELECT 1 FROM (SELECT ? AS actor_id, ? AS account_id, ? AS actor_proof) rights
  WHERE ((${actorAuthority}) OR EXISTS (SELECT 1 FROM privacy_deletion_jobs
    WHERE account_id = rights.account_id AND status = 'complete' AND requested_by = rights.actor_proof))
    AND ${accountSessionSql('rights.actor_id', sessionProof)}
)`;
const targetExists = `(
  EXISTS (SELECT 1 FROM auth_accounts WHERE id = ?)
  OR EXISTS (SELECT 1 FROM game_players WHERE id = ?)
)`;
const noChildren = `NOT EXISTS (
  SELECT 1 FROM guardian_links child_link
  WHERE child_link.guardian_account_id = ? AND child_link.state IN ('active','withdrawn')
    AND NOT EXISTS (SELECT 1 FROM privacy_account_controls child_control
      WHERE child_control.account_id = child_link.child_account_id AND child_control.state = 'deleted')
)`;
const objectJson = value => value == null ? null : JSON.parse(value);
const actorProof = async actorId => {
  const bytes = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(actorId)));
  return `sha256:${Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('')}`;
};

function validPolicy(policy) {
  return policy?.version === 1 && policy.eraseGameAndAccountData === true &&
    policy.eraseGuardianEvidence === true && policy.retainMinimalClosureRecords === true &&
    ['policyId', 'closureRetention', 'receiptRetention', 'backupReplayProcedure']
      .every(key => typeof policy[key] === 'string' && policy[key].trim().length >= 8 && policy[key].length <= 2000);
}

/** Account rights for an actor verified by the trusted server adapter.
 * Never pass a client-selected actor ID or a client-supplied purge policy here.
 * A withdrawn child remains manageable through its verified guardian relation.
 * Purge completion means removal from this live database, not from backups.
 */
export function createAccountLifecycle({
  db, now = Date.now, uuid = () => crypto.randomUUID(), purgePolicy, sessionProof,
} = {}) {
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function') {
    throw new PrivacyError(503, 'STORAGE_UNAVAILABLE', '정보 관리 저장소를 준비하고 있어요.');
  }
  const database = typeof db.withSession === 'function' ? db.withSession('first-primary') : db;
  const authority = authoritySql(sessionProof);
  const closedAuthority = closedAuthoritySql(sessionProof);
  const prepare = (sql, values = []) => database.prepare(sql).bind(...values);
  const first = (sql, values = []) => prepare(sql, values).first();
  const clock = () => {
    const at = Math.floor(now());
    if (!Number.isSafeInteger(at) || at < 0) throw new PrivacyError(503, 'CLOCK_UNAVAILABLE');
    return at;
  };

  async function authorize({ actorId, accountId }, { closed = false } = {}) {
    if (typeof actorId !== 'string' || !ID.test(actorId) || typeof accountId !== 'string' || !ID.test(accountId)) throw noAccess();
    const allowed = await first(`SELECT 1 AS allowed WHERE ${closed ? closedAuthority : authority}`,
      [actorId, accountId, ...(closed ? [await actorProof(actorId)] : [])]);
    if (!allowed) throw noAccess();
    const target = await first(`SELECT 1 AS found WHERE ${targetExists}
      ${closed ? "OR EXISTS (SELECT 1 FROM privacy_account_controls WHERE account_id = ? AND state = 'deleted')" : ''}`,
    [accountId, accountId, ...(closed ? [accountId] : [])]);
    if (!target) throw noAccess();
  }

  async function assertNoChildren(accountId) {
    if (!await first(`SELECT 1 AS allowed WHERE ${noChildren}`, [accountId])) {
      throw new PrivacyError(409, 'GUARDIAN_HAS_CHILDREN', '연결된 어린이 계정의 보호자 관리 방법을 먼저 정해 주세요.');
    }
  }

  function cancelAuth(accountId, at, proofSql, proofValues) {
    // Capture flow bindings before revoking/deleting sessions. Login flows are
    // not necessarily account-bound, while linking flows always are.
    return [
      prepare(`DELETE FROM auth_oauth_transactions
        WHERE (account_id = ? OR binding_hash IN
          (SELECT binding_hash FROM auth_sessions WHERE account_id = ? AND binding_hash IS NOT NULL))
          AND ${proofSql}`, [accountId, accountId, ...proofValues]),
      prepare(`UPDATE auth_accounts SET disabled_at = COALESCE(disabled_at, ?)
        WHERE id = ? AND ${proofSql}`, [at, accountId, ...proofValues]),
      prepare(`UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, ?)
        WHERE account_id = ? AND ${proofSql}`, [at, accountId, ...proofValues]),
    ];
  }

  function assertClosure(accountId, at, deletion) {
    // SQLite evaluates time per statement. A fresh-session deadline crossing
    // during a batch must not commit just its first control update while later
    // gated writes become no-ops. JSON's checked parser provides a read-only
    // SQL assertion: malformed JSON raises an error and rolls back the batch.
    // No first write means no assertion is needed; the caller returns 403.
    return prepare(`SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM privacy_account_controls WHERE account_id = ? AND updated_at = ?
          AND state IN ('withdrawn','deletion_pending'))
      OR (
        NOT EXISTS (SELECT 1 FROM auth_accounts WHERE id = ? AND disabled_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM auth_sessions WHERE account_id = ? AND revoked_at IS NULL)
        AND NOT EXISTS (SELECT 1 FROM auth_oauth_transactions
          WHERE account_id = ? OR binding_hash IN
            (SELECT binding_hash FROM auth_sessions WHERE account_id = ? AND binding_hash IS NOT NULL))
        AND NOT EXISTS (SELECT 1 FROM guardian_links WHERE child_account_id = ? AND state != 'withdrawn')
        AND NOT EXISTS (SELECT 1 FROM guardian_consents WHERE child_account_id = ? AND withdrawn_at IS NULL)
        ${deletion ? "AND EXISTS (SELECT 1 FROM privacy_deletion_jobs WHERE account_id = ? AND status IN ('pending','complete'))" : ''}
      ) THEN 1 ELSE json('') END AS closure_complete`,
    [accountId, at, accountId, accountId, accountId, accountId, accountId, accountId, ...(deletion ? [accountId] : [])]);
  }

  const stateResult = row => ({
    state: row?.state || 'active',
    deletion: row?.id ? {
      requestId: row.id, status: row.status, requestedAt: row.requested_at,
      completedAt: row.completed_at,
      scope: 'live-database',
      ...(row.status === 'pending' ? { awaitingPolicy: !validPolicy(purgePolicy) } : { backupReplayRequired: true }),
    } : null,
  });

  async function getStatus(input) {
    await authorize(input, { closed: true });
    const row = await first(`SELECT c.state, j.id, j.status, j.requested_at, j.completed_at
      FROM (SELECT ? AS id) target
      LEFT JOIN privacy_account_controls c ON c.account_id = target.id
      LEFT JOIN privacy_deletion_jobs j ON j.account_id = target.id
      WHERE ${closedAuthority}`,
    [input.accountId, input.actorId, input.accountId, await actorProof(input.actorId)]);
    if (!row) throw noAccess();
    return stateResult(row);
  }

  async function getProfileContext({ actorId } = {}) {
    if (typeof actorId !== 'string' || !ID.test(actorId)) throw noAccess();
    const row = await first(`SELECT player.public_id
      FROM auth_accounts actor LEFT JOIN game_players player ON player.id = actor.id
      WHERE actor.id = ? AND actor.disabled_at IS NULL
        AND ${accountAllowedSql('actor.id')} AND ${accountSessionSql('actor.id', sessionProof)}`, [actorId]);
    if (!row) throw noAccess();
    return { playerId: row.public_id ?? null };
  }

  async function listChildren({ actorId } = {}) {
    if (typeof actorId !== 'string' || !ID.test(actorId)) throw noAccess();
    const actorGuard = `guardian_actor.id = ? AND guardian_actor.disabled_at IS NULL
      AND ${accountAllowedSql('guardian_actor.id')} AND ${accountSessionSql('guardian_actor.id', sessionProof)}`;
    const proof = () => prepare(`SELECT 1 AS allowed FROM auth_accounts guardian_actor WHERE ${actorGuard}`, [actorId]);
    // A single read batch owns the actor and family snapshot. The final proof
    // also rejects a session deadline crossed while constructing the list.
    const result = await database.batch([
      proof(),
      prepare(`SELECT child_link.child_account_id,
          COALESCE(NULLIF(TRIM(substr(player.name, 1, 80)), ''), '연결된 어린이') AS label,
          COALESCE(control.state, CASE WHEN child_link.state = 'withdrawn' OR child.disabled_at IS NOT NULL
            THEN 'withdrawn' ELSE 'active' END) AS state,
          job.status AS deletion_status, job.requested_at, job.completed_at
        FROM auth_accounts guardian_actor
        JOIN guardian_links child_link ON child_link.guardian_account_id = guardian_actor.id
        LEFT JOIN auth_accounts child ON child.id = child_link.child_account_id
        LEFT JOIN game_players player ON player.id = child_link.child_account_id
        LEFT JOIN privacy_account_controls control ON control.account_id = child_link.child_account_id
        LEFT JOIN privacy_deletion_jobs job ON job.account_id = child_link.child_account_id
        WHERE ${actorGuard} AND child_link.state IN ('active','withdrawn')
          AND ${guardianAuthoritySql('child_link.child_account_id', 'guardian_actor.id')}
          AND (child.id IS NOT NULL OR player.id IS NOT NULL)
          AND COALESCE(control.state, 'active') != 'deleted'
          AND COALESCE(job.status, 'pending') != 'complete'
        ORDER BY child_link.linked_at, child_link.child_account_id LIMIT ?`,
      [actorId, MANAGED_CHILD_LIMIT + 1]),
      proof(),
    ]);
    if (!result[0].results.length || !result[2].results.length) throw noAccess();
    const rows = result[1].results;
    return {
      children: rows.slice(0, MANAGED_CHILD_LIMIT).map(row => ({
        childAccountId: row.child_account_id, label: row.label, state: row.state,
        deletion: row.deletion_status ? {
          status: row.deletion_status, requestedAt: row.requested_at, completedAt: row.completed_at,
        } : null,
      })),
      hasMore: rows.length > MANAGED_CHILD_LIMIT,
    };
  }

  async function committedStatus(accountId) {
    // Only called after a batch has proved current session authority and
    // committed its operation. Self-withdrawal has now revoked that session;
    // returning its minimal intake receipt must not require using it again.
    return stateResult(await first(`SELECT c.state, j.id, j.status, j.requested_at, j.completed_at
      FROM privacy_account_controls c LEFT JOIN privacy_deletion_jobs j ON j.account_id = c.account_id
      WHERE c.account_id = ?`, [accountId]));
  }

  async function withdraw(input) {
    await authorize(input, { closed: true });
    const current = await getStatus(input);
    if (current.state === 'deleted') return current;
    await assertNoChildren(input.accountId);
    const at = clock();
    const { actorId, accountId } = input;
    const proofSql = `${authority} AND ${noChildren} AND ${targetExists}`;
    const proofValues = [actorId, accountId, accountId, accountId, accountId];
    const statements = [
      prepare(`INSERT INTO privacy_account_controls (account_id, state, updated_at)
        SELECT ?, 'withdrawn', ? WHERE ${proofSql}
        ON CONFLICT(account_id) DO UPDATE SET
          state = CASE WHEN privacy_account_controls.state IN ('pending','active')
            THEN 'withdrawn' ELSE privacy_account_controls.state END,
          updated_at = excluded.updated_at`, [accountId, at, ...proofValues]),
      prepare(`UPDATE guardian_links SET state = 'withdrawn'
        WHERE child_account_id = ? AND ${proofSql}`, [accountId, ...proofValues]),
      prepare(`UPDATE guardian_consents SET withdrawn_at = COALESCE(withdrawn_at, ?)
        WHERE child_account_id = ? AND ${proofSql}`, [at, accountId, ...proofValues]),
      ...cancelAuth(accountId, at, proofSql, proofValues),
      assertClosure(accountId, at, false),
    ];
    const result = await database.batch(statements);
    if (!result[0].meta.changes) {
      await assertNoChildren(accountId);
      throw noAccess();
    }
    return committedStatus(accountId);
  }

  async function requestDeletion(input) {
    await authorize(input, { closed: true });
    const current = await getStatus(input);
    if (current.deletion) return current;
    await assertNoChildren(input.accountId);
    const at = clock();
    const { actorId, accountId } = input;
    const proofSql = `${authority} AND ${noChildren} AND ${targetExists}`;
    const proofValues = [actorId, accountId, accountId, accountId, accountId];
    const result = await database.batch([
      prepare(`INSERT INTO privacy_account_controls (account_id, state, updated_at)
        SELECT ?, 'deletion_pending', ? WHERE ${proofSql}
        ON CONFLICT(account_id) DO UPDATE SET
          state = CASE WHEN privacy_account_controls.state != 'deleted'
            THEN 'deletion_pending' ELSE 'deleted' END,
          updated_at = excluded.updated_at`, [accountId, at, ...proofValues]),
      prepare(`INSERT INTO privacy_deletion_jobs
        (id, account_id, requested_by, requested_at, completed_at, status)
        SELECT ?, ?, ?, ?, NULL, 'pending' WHERE ${proofSql}
          AND EXISTS (SELECT 1 FROM privacy_account_controls WHERE account_id = ? AND state = 'deletion_pending')
        ON CONFLICT(account_id) DO NOTHING`,
      [uuid(), accountId, await actorProof(actorId), at, ...proofValues, accountId]),
      prepare(`UPDATE guardian_links SET state = 'withdrawn'
        WHERE child_account_id = ? AND ${proofSql}`, [accountId, ...proofValues]),
      prepare(`UPDATE guardian_consents SET withdrawn_at = COALESCE(withdrawn_at, ?)
        WHERE child_account_id = ? AND ${proofSql}`, [at, accountId, ...proofValues]),
      ...cancelAuth(accountId, at, proofSql, proofValues),
      assertClosure(accountId, at, true),
    ]);
    if (!result[0].meta.changes) {
      await assertNoChildren(accountId);
      throw noAccess();
    }
    return committedStatus(accountId);
  }

  async function exportData(input) {
    await authorize(input);
    const { actorId, accountId } = input;
    // All reads share one database snapshot. No profile creation, score
    // settlement, welcome coins, provider subjects, or private question payload.
    const guarded = (sql, values = []) => prepare(`${sql} AND ${authority}`, [...values, actorId, accountId]);
    const result = await database.batch([
      prepare(`SELECT 1 AS allowed WHERE ${authority} AND ${targetExists}`, [actorId, accountId, accountId, accountId]),
      guarded('SELECT public_id, name, coins, owned, equipped, created_at FROM game_players WHERE id = ?', [accountId]),
      guarded('SELECT result FROM game_results WHERE user_id = ?', [accountId]),
      guarded('SELECT day, mode, status, created_at, completed_at FROM game_attempts WHERE user_id = ?', [accountId]),
      guarded('SELECT reference, reason, amount, created_at FROM game_coin_ledger WHERE user_id = ?', [accountId]),
      guarded('SELECT week, correct, total_time_ms, played_days, rank, participants, tier_id, coins, created_at FROM game_weekly_awards WHERE user_id = ?', [accountId]),
      guarded('SELECT provider, linked_at FROM auth_identities WHERE account_id = ?', [accountId]),
      guarded('SELECT state, updated_at FROM privacy_account_controls WHERE account_id = ?', [accountId]),
    ]);
    if (!result[0].results.length) throw noAccess();
    const profile = result[1].results[0];
    return {
      format: 'haru-five-rights-export-v1', exportedAt: new Date(clock()).toISOString(),
      profile: profile ? {
        playerId: profile.public_id, name: profile.name, coins: profile.coins,
        owned: objectJson(profile.owned), equipped: objectJson(profile.equipped), createdAt: profile.created_at,
      } : null,
      results: result[2].results.map(row => objectJson(row.result)),
      attempts: result[3].results, coinLedger: result[4].results, weeklyAwards: result[5].results,
      linkedProviders: result[6].results,
      access: result[7].results[0] || { state: 'active' },
    };
  }

  async function processDeletionJobs({ limit = 25 } = {}) {
    if (!Number.isInteger(limit) || limit < 1 || limit > PAGE_LIMIT) throw new PrivacyError(400, 'INVALID_LIMIT');
    const jobs = (await prepare(`SELECT id, account_id FROM privacy_deletion_jobs
      WHERE status = 'pending' ORDER BY requested_at, id LIMIT ?`, [limit]).all()).results;
    if (!validPolicy(purgePolicy)) {
      const pending = await first("SELECT COUNT(*) AS count FROM privacy_deletion_jobs WHERE status = 'pending'");
      return { processed: 0, pending: pending.count, awaitingPolicy: true };
    }
    let processed = 0;
    for (const job of jobs) {
      const at = clock();
      // This proof remains valid through removal of both independent account
      // roots, then the final statements close the job and preserve its fence.
      const gate = `EXISTS (SELECT 1 FROM privacy_deletion_jobs job
        JOIN privacy_account_controls control ON control.account_id = job.account_id
        WHERE job.id = ? AND job.account_id = ? AND job.status = 'pending'
          AND control.state = 'deletion_pending') AND ${noChildren}`;
      const args = [job.id, job.account_id, job.account_id];
      const accountId = job.account_id;
      const statements = [
        ...cancelAuth(accountId, at, gate, args),
        prepare(`DELETE FROM game_rate_limits WHERE user_id = ? AND ${gate}`, [accountId, ...args]),
        prepare(`DELETE FROM game_players WHERE id = ? AND ${gate}`, [accountId, ...args]),
        prepare(`DELETE FROM guardian_links
          WHERE (child_account_id = ? OR guardian_account_id = ?) AND ${gate}`, [accountId, accountId, ...args]),
        prepare(`DELETE FROM guardian_consents
          WHERE (child_account_id = ? OR guardian_account_id = ?) AND ${gate}`, [accountId, accountId, ...args]),
        prepare(`DELETE FROM guardian_requests WHERE guardian_account_id = ? AND ${gate}`, [accountId, ...args]),
        prepare(`DELETE FROM auth_accounts WHERE id = ? AND ${gate}`, [accountId, ...args]),
        prepare(`UPDATE privacy_deletion_jobs SET status = 'complete', completed_at = ?
          WHERE id = ? AND ${gate}`, [at, job.id, ...args]),
        prepare(`UPDATE privacy_account_controls SET state = 'deleted', updated_at = ?
          WHERE account_id = ? AND EXISTS
            (SELECT 1 FROM privacy_deletion_jobs WHERE id = ? AND account_id = ? AND status = 'complete')`,
        [at, accountId, job.id, accountId]),
      ];
      const result = await database.batch(statements);
      if (result.at(-2).meta.changes) processed += 1;
    }
    const pending = await first("SELECT COUNT(*) AS count FROM privacy_deletion_jobs WHERE status = 'pending'");
    return { processed, pending: pending.count, awaitingPolicy: false, scope: 'live-database', backupReplayRequired: true };
  }

  return Object.freeze({ withdraw, requestDeletion, getStatus, getProfileContext, listChildren, exportData, processDeletionJobs });
}
