import test from 'node:test';
import assert from 'node:assert/strict';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createAccountLifecycle } from '../server/account-lifecycle.mjs';
import { runPrivacyMaintenance } from '../scripts/privacy-maintenance.mjs';

const START = Date.parse('2026-10-20T12:00:00+09:00');
const POLICY = Object.freeze({
  version: 1, policyId: 'test-only-policy',
  eraseGameAndAccountData: true, eraseGuardianEvidence: true,
  retainMinimalClosureRecords: true,
  closureRetention: 'Test fixture retains opaque account closure markers.',
  receiptRetention: 'Test fixture retains minimal request/status/hash receipts.',
  backupReplayProcedure: 'Test fixture only: apply closure markers before restored DB is served.',
});
const rejected = code => error => error?.code === code;

function fixture(t, { policy = POLICY } = {}) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let time = START, serial = 0;
  const lifecycle = createAccountLifecycle({ db, now: () => time, uuid: () => `delete-${++serial}`, purgePolicy: policy });
  return { db, lifecycle, tick: ms => { time += ms; }, now: () => time };
}

async function seed(f, accountId, { player = true } = {}) {
  await f.db.prepare('INSERT INTO auth_accounts (id,created_at) VALUES (?,?)').bind(accountId, START).run();
  await f.db.prepare(`INSERT INTO auth_identities (id,account_id,provider,issuer,audience,subject,linked_at)
    VALUES (?,?,'google','https://accounts.google.com','client-test',?,?)`)
    .bind(`identity-${accountId}`, accountId, `secret-subject-${accountId}`, START).run();
  await f.db.prepare(`INSERT INTO auth_sessions (token_hash,binding_hash,account_id,provider,created_at,expires_at)
    VALUES (?,?,?,'google',?,?)`).bind(`session-${accountId}`, `binding-${accountId}`, accountId, START, START + 86400000).run();
  if (!player) return;
  await f.db.prepare(`INSERT INTO game_players (id,public_id,name,coins,owned,equipped,created_day,created_at)
    VALUES (?,?,'구름토끼',180,'["character-rabbit"]','{"character":"rabbit"}','2026-10-20',?)`)
    .bind(accountId, `public-${accountId}`, START).run();
  await f.db.prepare(`INSERT INTO game_attempts (id,user_id,day,week,mode,status,payload,expires_at,created_at,completed_at)
    VALUES (?,?,'2026-10-20','2026-10-19','daily','complete',?, ?, ?, ?)`)
    .bind(`attempt-${accountId}`, accountId, '{"privateNextQuestion":"never export"}', START + 3600000, START, START).run();
  await f.db.prepare(`INSERT INTO game_results
    (attempt_id,user_id,day,week,mode,correct,total_time_ms,score_cent,result,completed_at)
    VALUES (?,?,'2026-10-20','2026-10-19','daily',5,5000,500000,'{"correct":5}',?)`)
    .bind(`attempt-${accountId}`, accountId, START).run();
  await f.db.prepare("INSERT INTO game_coin_ledger VALUES (?,'welcome','welcome',180,?)").bind(accountId, START).run();
  await f.db.prepare("INSERT INTO game_mutation_receipts VALUES (?,'request-original','private-fingerprint',?)").bind(accountId, START).run();
  await f.db.prepare("INSERT OR IGNORE INTO game_closed_weeks VALUES ('2026-10-12','close-token',?,1)").bind(START).run();
  await f.db.prepare(`INSERT INTO game_weekly_awards VALUES (?,'2026-10-12',5,5000,1,1,1,'seed',0,?)`).bind(accountId, START).run();
  await f.db.prepare('INSERT INTO game_rate_limits VALUES (?,?,1)').bind(accountId, START).run();
}

async function guardian(f, guardianId, childId) {
  await seed(f, guardianId, { player: false });
  await f.db.prepare(`INSERT INTO guardian_consents
    (id,guardian_account_id,child_account_id,proof_hash,jti_hash,subject_hash,scopes,policy_version,approved_at)
    VALUES (?,?,?,?,?,?,'["play","rankings"]','test-v1',?)`)
    .bind(`consent-${childId}`, guardianId, childId, `proof-${childId}`, `jti-${childId}`, `subject-${childId}`, START).run();
  await f.db.prepare(`INSERT INTO guardian_links
    (child_account_id,guardian_account_id,consent_id,state,linked_at) VALUES (?,?,?,'active',?)`)
    .bind(childId, guardianId, `consent-${childId}`, START).run();
}

async function flow(f, { state, accountId = null, binding }) {
  await f.db.prepare(`INSERT INTO auth_oauth_transactions
    (state_hash,binding_hash,provider,audience,intent,account_id,context_hash,nonce_hash,code_verifier,created_at,expires_at)
    VALUES (?,?,'google','client-test',?,?, 'context','nonce','verifier',?,?)`)
    .bind(state, binding, accountId ? 'link' : 'login', accountId, START, START + 600000).run();
}

test('withdrawal atomically disables the account and cancels bound and unbound flows without erasing rights data', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  await flow(f, { state: 'bound-link', accountId: 'child', binding: 'new-binding' });
  await flow(f, { state: 'unbound-login', binding: 'binding-child' });
  await flow(f, { state: 'unrelated-login', binding: 'unrelated-binding' });
  const status = await f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' });
  assert.equal(status.state, 'withdrawn');
  assert.equal(f.db.rows('SELECT disabled_at FROM auth_accounts WHERE id = ?', 'child')[0].disabled_at, START);
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE account_id = ?', 'child')[0].revoked_at, START);
  assert.deepEqual(f.db.rows('SELECT state_hash FROM auth_oauth_transactions').map(row => row.state_hash), ['unrelated-login']);
  assert.equal(f.db.rows('SELECT state FROM guardian_links')[0].state, 'withdrawn');
  assert.equal(f.db.rows('SELECT withdrawn_at FROM guardian_consents')[0].withdrawn_at, START);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM game_results')[0].count, 1);
  assert.equal((await f.lifecycle.getStatus({ actorId: 'parent', accountId: 'child' })).state, 'withdrawn');
  assert.equal((await f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' })).state, 'withdrawn');
});

test('rights exports remain readable after withdrawal, isolate families, and never create players or expose auth/question secrets', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  await seed(f, 'stranger', { player: false });
  await f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' });
  const data = await f.lifecycle.exportData({ actorId: 'parent', accountId: 'child' });
  assert.equal(data.profile.playerId, 'public-child');
  assert.deepEqual(data.results, [{ correct: 5 }]);
  assert.equal(data.access.state, 'withdrawn');
  assert.doesNotMatch(JSON.stringify(data), /secret-subject|privateNextQuestion|session-child|binding-child|private-fingerprint/);
  await assert.rejects(f.lifecycle.exportData({ actorId: 'stranger', accountId: 'child' }), rejected('RIGHTS_UNAVAILABLE'));
  await assert.rejects(f.lifecycle.requestDeletion({ actorId: 'stranger', accountId: 'child' }), rejected('RIGHTS_UNAVAILABLE'));
  const before = f.db.rows('SELECT COUNT(*) AS count FROM game_players')[0].count;
  assert.equal((await f.lifecycle.exportData({ actorId: 'stranger', accountId: 'stranger' })).profile, null);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM game_players')[0].count, before);
});

test('guardian closure is blocked while active or withdrawn child relations still need rights management', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  for (const operation of ['withdraw', 'requestDeletion']) {
    await assert.rejects(f.lifecycle[operation]({ actorId: 'parent', accountId: 'parent' }), rejected('GUARDIAN_HAS_CHILDREN'));
  }
  await f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' });
  await assert.rejects(f.lifecycle.requestDeletion({ actorId: 'parent', accountId: 'parent' }), rejected('GUARDIAN_HAS_CHILDREN'));
  assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='parent'")[0].disabled_at, null);
});

test('deletion without an acknowledged server policy stops access but leaves live data pending', async t => {
  const f = fixture(t, { policy: undefined });
  // Deliberately omit policy, rather than fixture's safe test default.
  const lifecycle = createAccountLifecycle({ db: f.db, now: f.now });
  await seed(f, 'self');
  const result = await lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' });
  assert.equal(result.state, 'deletion_pending');
  assert.equal(result.deletion.awaitingPolicy, true);
  assert.deepEqual(await lifecycle.processDeletionJobs({}), { processed: 0, pending: 1, awaitingPolicy: true });
  assert.equal(f.db.rows("SELECT COUNT(*) AS count FROM game_players WHERE id='self'")[0].count, 1);
  assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='self'")[0].disabled_at, START);
  assert.deepEqual(await lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' }), result);
});

test('acknowledged purge removes both independent roots and all user data, keeps global fences and minimal closure receipts', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  await seed(f, 'unrelated');
  await flow(f, { state: 'pending-child', binding: 'binding-child' });
  const first = await f.lifecycle.requestDeletion({ actorId: 'parent', accountId: 'child' });
  const second = await f.lifecycle.requestDeletion({ actorId: 'parent', accountId: 'child' });
  assert.equal(first.deletion.requestId, second.deletion.requestId);
  f.tick(1000);
  const result = await f.lifecycle.processDeletionJobs({});
  assert.equal(result.processed, 1);
  assert.equal(result.pending, 0);
  for (const table of ['game_players', 'auth_accounts']) assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table} WHERE id='child'`)[0].count, 0);
  for (const table of ['game_attempts', 'game_results', 'game_coin_ledger', 'game_mutation_receipts', 'game_weekly_awards', 'game_rate_limits']) {
    assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table} WHERE user_id='child'`)[0].count, 0, table);
  }
  for (const table of ['auth_sessions', 'auth_identities', 'auth_oauth_transactions']) {
    assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table} WHERE account_id='child'`)[0].count, 0, table);
  }
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM guardian_links')[0].count, 0);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM guardian_consents')[0].count, 0);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM game_closed_weeks')[0].count, 1);
  assert.equal(f.db.rows("SELECT COUNT(*) AS count FROM game_players WHERE id='unrelated'")[0].count, 1);
  const receipt = f.db.rows("SELECT * FROM privacy_deletion_jobs WHERE account_id='child'")[0];
  assert.match(receipt.requested_by, /^sha256:[a-f0-9]{64}$/);
  assert.equal(receipt.status, 'complete');
  const status = await f.lifecycle.getStatus({ actorId: 'parent', accountId: 'child' });
  assert.equal(status.state, 'deleted');
  assert.equal(status.deletion.completedAt, START + 1000);
  assert.doesNotMatch(JSON.stringify(status), /child|parent|sha256/);
  assert.deepEqual(await f.lifecycle.requestDeletion({ actorId: 'parent', accountId: 'child' }), status);
  await assert.rejects(f.lifecycle.getStatus({ actorId: 'unrelated', accountId: 'child' }), rejected('RIGHTS_UNAVAILABLE'));
  assert.equal((await f.lifecycle.processDeletionJobs({})).processed, 0);
});

test('deletion batch failure rolls back data removal and preserves a retryable pending request', async t => {
  const f = fixture(t);
  await seed(f, 'self');
  await f.lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' });
  f.db.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.includes('DELETE FROM game_players'))) {
      statements.push(f.db.prepare('INSERT INTO missing_table VALUES (1)'));
    }
  };
  await assert.rejects(f.lifecycle.processDeletionJobs({}), /missing_table/);
  f.db.beforeBatch = null;
  assert.equal(f.db.rows("SELECT COUNT(*) AS count FROM game_players WHERE id='self'")[0].count, 1);
  assert.equal(f.db.rows("SELECT COUNT(*) AS count FROM auth_identities WHERE account_id='self'")[0].count, 1);
  assert.equal(f.db.rows('SELECT state FROM privacy_account_controls')[0].state, 'deletion_pending');
  assert.equal(f.db.rows('SELECT status FROM privacy_deletion_jobs')[0].status, 'pending');
  assert.equal((await f.lifecycle.processDeletionJobs({})).processed, 1);
});

test('a family link removed after preflight cannot authorize a delayed withdrawal batch', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  let signal, resume;
  const paused = new Promise(resolve => { signal = resolve; });
  const released = new Promise(resolve => { resume = resolve; });
  f.db.beforeBatch = async statements => {
    if (statements.some(statement => statement.sql.includes('INSERT INTO privacy_account_controls'))) {
      f.db.beforeBatch = null;
      signal();
      await released;
    }
  };
  const pending = f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' });
  await paused;
  await f.db.prepare("DELETE FROM guardian_links WHERE child_account_id='child'").run();
  resume();
  await assert.rejects(pending, rejected('RIGHTS_UNAVAILABLE'));
  assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='child'")[0].disabled_at, null);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_account_controls')[0].count, 0);
});

test('withdrawal failure rolls back controls, auth revocation and guardian evidence together', async t => {
  const f = fixture(t);
  await seed(f, 'child');
  await guardian(f, 'parent', 'child');
  f.db.beforeBatch = statements => {
    if (statements.some(statement => statement.sql.includes('INSERT INTO privacy_account_controls'))) {
      statements.push(f.db.prepare('INSERT INTO missing_table VALUES (1)'));
    }
  };
  await assert.rejects(f.lifecycle.withdraw({ actorId: 'parent', accountId: 'child' }), /missing_table/);
  f.db.beforeBatch = null;
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_account_controls')[0].count, 0);
  assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='child'")[0].disabled_at, null);
  assert.equal(f.db.rows("SELECT revoked_at FROM auth_sessions WHERE account_id='child'")[0].revoked_at, null);
  assert.equal(f.db.rows('SELECT state FROM guardian_links')[0].state, 'active');
  assert.equal(f.db.rows('SELECT withdrawn_at FROM guardian_consents')[0].withdrawn_at, null);
});

test('maintenance purges expired request data without user visits and keeps unapproved account deletion pending', async t => {
  const f = fixture(t);
  await seed(f, 'self');
  await f.lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' });
  await f.db.prepare(`INSERT INTO guardian_requests
    (id,guardian_account_id,token_hash,nonce_hash,created_at,expires_at,policy_version,state)
    VALUES ('expired-request','pending-guardian','hash','nonce',?,?,'test-v1','pending')`)
    .bind(START - 5 * 86400000, START).run();
  const result = await runPrivacyMaintenance({ db: f.db, now: f.now });
  assert.equal(result.expired.expiredRequests, 1);
  assert.equal(result.deletions.processed, 0);
  assert.equal(result.deletions.awaitingPolicy, true);
  assert.equal(f.db.rows("SELECT COUNT(*) AS count FROM game_players WHERE id='self'")[0].count, 1);
  const badPolicy = { ...POLICY, backupReplayProcedure: '' };
  const blocked = await createAccountLifecycle({ db: f.db, now: f.now, purgePolicy: badPolicy }).processDeletionJobs({});
  assert.equal(blocked.awaitingPolicy, true);
});

test('concurrent delete requests converge on one receipt and deleted state is terminal', async t => {
  const f = fixture(t);
  await seed(f, 'self');
  const requests = await Promise.all(Array.from({ length: 8 }, () => f.lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' })));
  assert.equal(new Set(requests.map(result => result.deletion.requestId)).size, 1);
  assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_deletion_jobs')[0].count, 1);
  await f.lifecycle.processDeletionJobs({});
  assert.equal((await f.lifecycle.withdraw({ actorId: 'self', accountId: 'self' })).state, 'deleted');
  assert.equal((await f.lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' })).state, 'deleted');
});

async function sessionService(f, accountId) {
  const tokenHash = 'f'.repeat(64), at = Date.now();
  await f.db.prepare(`INSERT INTO auth_sessions
    (token_hash,account_id,provider,created_at,expires_at) VALUES (?,?,'google',?,?)`)
    .bind(tokenHash, accountId, at, at + 86400000).run();
  return {
    tokenHash,
    lifecycle: createAccountLifecycle({ db: f.db, now: f.now, sessionProof: { tokenHash }, purgePolicy: POLICY }),
  };
}

test('self withdrawal returns its committed receipt while revoking the proof used for all subsequent rights requests', async t => {
  const f = fixture(t);
  await seed(f, 'self');
  const { lifecycle, tokenHash } = await sessionService(f, 'self');
  assert.equal((await lifecycle.getStatus({ actorId: 'self', accountId: 'self' })).state, 'active');
  const receipt = await lifecycle.withdraw({ actorId: 'self', accountId: 'self' });
  assert.equal(receipt.state, 'withdrawn');
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', tokenHash)[0].revoked_at, START);
  assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='self'")[0].disabled_at, START);
  await assert.rejects(lifecycle.getStatus({ actorId: 'self', accountId: 'self' }), rejected('RIGHTS_UNAVAILABLE'));
  await assert.rejects(lifecycle.exportData({ actorId: 'self', accountId: 'self' }), rejected('RIGHTS_UNAVAILABLE'));
});

test('logout or expiration after rights preflight fences a delayed destructive transaction', async t => {
  for (const invalidation of ['logout', 'freshness', 'expiry']) await t.test(invalidation, async t => {
    const f = fixture(t);
    await seed(f, 'self');
    const { lifecycle, tokenHash } = await sessionService(f, 'self');
    let signal, release;
    const entered = new Promise(resolve => { signal = resolve; });
    const released = new Promise(resolve => { release = resolve; });
    f.db.beforeBatch = async statements => {
      if (statements.some(statement => statement.sql.includes('INSERT INTO privacy_account_controls'))) {
        f.db.beforeBatch = null; signal(); await released;
      }
    };
    const pending = lifecycle.requestDeletion({ actorId: 'self', accountId: 'self' });
    await entered;
    const at = Date.now();
    if (invalidation === 'logout') {
      await f.db.prepare('UPDATE auth_sessions SET revoked_at = ? WHERE token_hash = ?').bind(at, tokenHash).run();
    } else if (invalidation === 'freshness') {
      await f.db.prepare('UPDATE auth_sessions SET created_at = ? WHERE token_hash = ?').bind(at - 16 * 60000, tokenHash).run();
    } else {
      await f.db.prepare('UPDATE auth_sessions SET created_at = ?, expires_at = ? WHERE token_hash = ?')
        .bind(at - 60000, at - 1000, tokenHash).run();
    }
    release();
    await assert.rejects(pending, rejected('RIGHTS_UNAVAILABLE'));
    assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_account_controls')[0].count, 0);
    assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_deletion_jobs')[0].count, 0);
    assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='self'")[0].disabled_at, null);
  });
});

test('session deadline crossing inside a transaction rolls back every partial closure change', async t => {
  for (const operation of ['withdraw', 'requestDeletion']) await t.test(operation, async t => {
    const f = fixture(t);
    await seed(f, 'self');
    const { lifecycle, tokenHash } = await sessionService(f, 'self');
    const seconds = Math.floor(Date.now() / 1000);
    let inside = false, calls = 0;
    f.db.sqlite.function('unixepoch', _argument => {
      if (!inside) return seconds;
      calls += 1;
      // The initial account-control write's three session-clock predicates
      // pass. The next statement observes a deadline that has now elapsed.
      return calls <= 3 ? seconds : seconds + 901;
    });
    f.db.beforeBatch = statements => {
      if (statements.some(statement => statement.sql.includes('INSERT INTO privacy_account_controls'))) {
        inside = true;
        calls = 0;
      }
    };
    await assert.rejects(lifecycle[operation]({ actorId: 'self', accountId: 'self' }), /malformed JSON/);
    assert.ok(calls > 3);
    assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_account_controls')[0].count, 0);
    assert.equal(f.db.rows('SELECT COUNT(*) AS count FROM privacy_deletion_jobs')[0].count, 0);
    assert.equal(f.db.rows("SELECT disabled_at FROM auth_accounts WHERE id='self'")[0].disabled_at, null);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', tokenHash)[0].revoked_at, null);
  });
});
