import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportSPKI, SignJWT } from 'jose';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createGuardianService, GUARDIAN_LIMITS, GUARDIAN_SCOPES } from '../server/guardian-service.mjs';
import { accountAllowedSql, guardianAuthoritySql } from '../server/privacy-contract.mjs';

const CLOCK = Date.UTC(2026, 9, 20, 0, 0, 0);
const pair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const otherPair = await generateKeyPair('RS256', { modulusLength: 2048, extractable: true });
const ENV = {
  HARU_GUARDIAN_ATTESTATION_PUBLIC_KEY: await exportSPKI(pair.publicKey),
  HARU_GUARDIAN_ATTESTATION_ISSUER: 'https://guardian.fixture.test',
  HARU_GUARDIAN_ATTESTATION_AUDIENCE: 'fixture-haru-guardian',
  HARU_GUARDIAN_POLICY_VERSION: 'fixture-policy-v1',
};
function harness(t, env = ENV) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let clock = CLOCK;
  db.sqlite.function('unixepoch', (_modifier) => Math.floor(clock / 1000));
  for (const id of ['guardian-one', 'guardian-two', 'child-one', 'child-two']) db.sqlite.prepare('INSERT INTO auth_accounts(id,created_at) VALUES (?,?)').run(id, clock);
  for (const id of ['child-one', 'child-two']) db.sqlite.prepare('INSERT INTO privacy_account_controls(account_id,state,updated_at) VALUES (?,\'pending\',?)').run(id, clock);
  const now = () => clock;
  return { db, service: createGuardianService({ db, env, now }), now, setTime(value) { clock = value; } };
}
async function signed(h, request, overrides = {}, options = {}) {
  const claims = {
    iss: ENV.HARU_GUARDIAN_ATTESTATION_ISSUER, aud: ENV.HARU_GUARDIAN_ATTESTATION_AUDIENCE,
    sub: 'fixture-provider-guardian-one', jti: crypto.randomUUID(), iat: Math.floor(h.now() / 1000), exp: Math.floor(h.now() / 1000) + 60,
    requestId: request.requestId, guardianAccountId: 'guardian-one', nonce: request.nonce,
    identityVerified: true, guardianAdultVerified: true, relationshipVerified: true, consentGiven: true,
    policyVersion: request.policyVersion, consentScopes: [...GUARDIAN_SCOPES], ...overrides,
  };
  for (const key of Object.keys(claims)) if (claims[key] === undefined) delete claims[key];
  return new SignJWT(claims).setProtectedHeader({ alg: 'RS256', typ: 'guardian-consent+jwt', ...options.header }).sign(options.key || pair.privateKey);
}
async function approved(h, overrides = {}) {
  const request = await h.service.createRequest('guardian-one');
  const attestation = await signed(h, request, overrides);
  await h.service.approveRequest('guardian-one', { ...request, attestation });
  return { ...request, attestation };
}
const code = expected => error => error.code === expected;

test('guardian requests fail closed without a real verifier contract; readiness stays false even with test keys', async t => {
  const h = harness(t, {});
  await assert.rejects(h.service.createRequest('guardian-one'), code('GUARDIAN_NOT_CONFIGURED'));
  assert.deepEqual(h.service.status(), { guardianReady: false, providerConfigured: false, enrollmentOpen: false });
  assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, 0);
  assert.equal(createGuardianService({ db: h.db, env: ENV }).status().guardianReady, false);
  const bad = createGuardianService({ db: h.db, env: { ...ENV, HARU_GUARDIAN_ATTESTATION_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\ninvalid' } });
  await assert.rejects(bad.createRequest('guardian-one'), code('GUARDIAN_NOT_CONFIGURED'));
});

test('request collection contains only hashed secrets and listings never expose credentials or proof', async t => {
  const h = harness(t);
  const request = await h.service.createRequest('guardian-one');
  assert.equal(request.expiresAt - request.createdAt, GUARDIAN_LIMITS.requestMs);
  const raw = JSON.stringify(h.db.rows('SELECT * FROM guardian_requests'));
  assert.equal(raw.includes(request.requestToken), false);
  assert.equal(raw.includes(request.nonce), false);
  const listed = await h.service.listRequests('guardian-one');
  assert.deepEqual(Object.keys(listed[0]).sort(), ['createdAt', 'expiresAt', 'policyVersion', 'requestId', 'status']);
  assert.deepEqual(await h.service.listRequests('guardian-two'), []);
  await assert.rejects(h.service.createRequest('child-one'), code('GUARDIAN_ACCESS_DENIED'));
  assert.equal(h.db.rows('SELECT * FROM game_players').length, 0);
});

test('rotation preserves original five-day deadline and invalidates both old request token and old nonce', async t => {
  const h = harness(t);
  const request = await h.service.createRequest('guardian-one');
  h.setTime(CLOCK + 3 * 86400000);
  const next = await h.service.rotateRequestToken('guardian-one', request.requestId);
  assert.equal(next.createdAt, request.createdAt);
  assert.equal(next.expiresAt, request.expiresAt);
  assert.notEqual(next.requestToken, request.requestToken);
  await assert.rejects(h.service.approveRequest('guardian-one', { ...request, attestation: await signed(h, request) }), code('GUARDIAN_PROOF_REJECTED'));
  await assert.rejects(h.service.approveRequest('guardian-one', { ...next, attestation: await signed(h, request) }), code('GUARDIAN_PROOF_REJECTED'));
  await h.service.approveRequest('guardian-one', { ...next, attestation: await signed(h, next) });
  await assert.rejects(h.service.rotateRequestToken('guardian-one', request.requestId), code('GUARDIAN_REQUEST_USED'));
});

test('signed proofs require pinned signature, context, actual identity, adult status, relationship and explicit exact consent', async t => {
  const h = harness(t);
  const request = await h.service.createRequest('guardian-one');
  const variants = [
    { iss: 'https://attacker.test' }, { aud: 'another-service' }, { requestId: 'another-request' }, { guardianAccountId: 'guardian-two' },
    { nonce: 'x'.repeat(43) }, { identityVerified: false }, { guardianAdultVerified: false }, { relationshipVerified: false },
    { consentGiven: false }, { consentScopes: ['account:create'] }, { consentScopes: [...GUARDIAN_SCOPES, 'ads:personalized'] },
    { policyVersion: 'old-policy' }, { exp: Math.floor(CLOCK / 1000) }, { iat: Math.floor(CLOCK / 1000) + 1 },
    { iat: Math.floor(CLOCK / 1000) - 1 }, { exp: Math.floor(CLOCK / 1000) + 301 }, { jti: undefined }, { sub: '' },
  ];
  for (const overrides of variants) {
    await assert.rejects(h.service.approveRequest('guardian-one', { ...request, attestation: await signed(h, request, overrides) }), code('GUARDIAN_PROOF_REJECTED'), JSON.stringify(overrides));
  }
  for (const options of [{ key: otherPair.privateKey }, { header: { typ: 'JWT' } }]) {
    await assert.rejects(h.service.approveRequest('guardian-one', { ...request, attestation: await signed(h, request, {}, options) }), code('GUARDIAN_PROOF_REJECTED'));
  }
  await assert.rejects(h.service.approveRequest('guardian-two', { ...request, attestation: await signed(h, request) }), code('GUARDIAN_REQUEST_NOT_FOUND'));
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
  assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'pending');
});

test('approved proof is stored as minimal hashes; repeated exact proof converges but cross-request jti replay fails', async t => {
  const h = harness(t);
  const first = await approved(h, { jti: 'same-proof-id' });
  const again = await h.service.approveRequest('guardian-one', first);
  assert.equal(again.status, 'approved');
  const raw = JSON.stringify(h.db.rows('SELECT * FROM guardian_consents'));
  assert.equal(raw.includes(first.attestation), false);
  assert.equal(raw.includes('fixture-provider-guardian-one'), false);
  assert.equal(raw.includes('same-proof-id'), false);
  const next = await h.service.createRequest('guardian-one');
  await assert.rejects(h.service.approveRequest('guardian-one', { ...next, attestation: await signed(h, next, { jti: 'same-proof-id' }) }), code('GUARDIAN_REQUEST_USED'));
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 1);
});

test('approval grants are consumed once; only pending player-free child can bind and family rights remain after withdrawal', async t => {
  const h = harness(t);
  const request = await approved(h);
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'guardian-one' }), code('GUARDIAN_CHILD_INVALID'));
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'guardian-two' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
  await assert.rejects(h.service.bindChild('guardian-two', { requestId: request.requestId, childId: 'child-one' }), code('GUARDIAN_REQUEST_NOT_FOUND'));
  assert.deepEqual(await h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }), { childId: 'child-one', status: 'active' });
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-two' }), code('GUARDIAN_REQUEST_NOT_FOUND'));
  assert.equal(h.db.rows('SELECT * FROM game_players').length, 0);
  assert.equal(h.db.rows('SELECT state FROM privacy_account_controls WHERE account_id = ?', 'child-one')[0].state, 'active');
  assert.equal(await h.service.authorizeGuardian('guardian-one', 'child-one'), true);
  await assert.rejects(h.service.authorizeGuardian('guardian-two', 'child-one'), code('GUARDIAN_ACCESS_DENIED'));
  await assert.rejects(h.service.authorizeGuardian('guardian-one', 'child-two'), code('GUARDIAN_ACCESS_DENIED'));
  h.db.sqlite.exec("UPDATE guardian_links SET state='withdrawn'; UPDATE privacy_account_controls SET state='withdrawn' WHERE account_id='child-one'");
  assert.equal(await h.service.authorizeGuardian('guardian-one', 'child-one'), true);
  assert.equal(h.db.rows(`SELECT 1 AS allowed FROM auth_accounts WHERE id='child-one' AND ${accountAllowedSql('auth_accounts.id')}`).length, 0);
  h.db.sqlite.exec("UPDATE auth_accounts SET disabled_at=1 WHERE id='guardian-one'");
  await assert.rejects(h.service.authorizeGuardian('guardian-one', 'child-one'), code('GUARDIAN_ACCESS_DENIED'));
});

test('binding cannot adopt existing game player or make an existing guardian into a child', async t => {
  const h = harness(t);
  const request = await approved(h);
  h.db.sqlite.prepare(`INSERT INTO game_players(id,public_id,name,coins,owned,equipped,created_day,created_at) VALUES ('child-one','public-child','Test',0,'[]','{}','2026-10-20',?)`).run(CLOCK);
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
  await h.service.createRequest('guardian-two');
  h.db.sqlite.prepare("INSERT INTO privacy_account_controls(account_id,state,updated_at) VALUES ('guardian-two','pending',?)").run(CLOCK);
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'guardian-two' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 0);
});

test('reject immediately removes pending request and unbound proof, and expired cleanup never extends original retention', async t => {
  const h = harness(t);
  const rejected = await approved(h);
  assert.deepEqual(await h.service.rejectRequest('guardian-one', rejected.requestId), { removed: true });
  assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, 0);
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
  const expires = await approved(h);
  const bound = await approved(h);
  await h.service.bindChild('guardian-one', { requestId: bound.requestId, childId: 'child-one' });
  h.setTime(expires.expiresAt);
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: expires.requestId, childId: 'child-two' }), code('GUARDIAN_REQUEST_EXPIRED'));
  await assert.rejects(h.service.rotateRequestToken('guardian-one', expires.requestId), code('GUARDIAN_REQUEST_EXPIRED'));
  const cleanup = createGuardianService({ db: h.db, now: h.now });
  assert.deepEqual(await cleanup.purgeExpired(), { expiredRequests: 1, expiredUnboundConsents: 1 });
  assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, 0);
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 1);
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 1);
});

test('atomic binding rejects concurrent child closure and never leaves a consumed grant or half-linked account', async t => {
  const h = harness(t);
  const request = await approved(h);
  h.db.beforeBatch = async statements => {
    if (statements[0].sql.includes("state = 'consumed'")) {
      h.db.beforeBatch = null;
      h.db.sqlite.exec("UPDATE privacy_account_controls SET state='deletion_pending' WHERE account_id='child-one'");
    }
  };
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
  assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'approved');
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 0);
  assert.equal(h.db.rows('SELECT child_account_id FROM guardian_consents')[0].child_account_id, null);
  await h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-two' });
  assert.equal(h.db.rows(`SELECT 1 FROM auth_accounts AS a WHERE a.id='guardian-one' AND ${guardianAuthoritySql("'child-two'", 'a.id')}`).length, 1);
});

test('approval rechecks token rotation and guardian disabling at atomic commit', async t => {
  for (const change of ['rotate', 'disable']) {
    const h = harness(t);
    const request = await h.service.createRequest('guardian-one');
    const attestation = await signed(h, request);
    h.db.beforeBatch = async statements => {
      if (statements[0].sql.includes("state = 'approved'")) {
        h.db.beforeBatch = null;
        if (change === 'rotate') await h.service.rotateRequestToken('guardian-one', request.requestId);
        else h.db.sqlite.exec("UPDATE auth_accounts SET disabled_at=1 WHERE id='guardian-one'");
      }
    };
    await assert.rejects(h.service.approveRequest('guardian-one', { ...request, attestation }), code('GUARDIAN_REQUEST_USED'));
    assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
  }
});

test('simultaneous identical callbacks converge and competing child bindings consume one grant only', async t => {
  const h = harness(t);
  const request = await h.service.createRequest('guardian-one');
  const attestation = await signed(h, request);
  const approvals = await Promise.all([
    h.service.approveRequest('guardian-one', { ...request, attestation }),
    h.service.approveRequest('guardian-one', { ...request, attestation }),
  ]);
  assert.equal(approvals.every(result => result.status === 'approved'), true);
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 1);
  const bindings = await Promise.allSettled([
    h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }),
    h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-two' }),
  ]);
  assert.equal(bindings.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(bindings.filter(result => result.status === 'rejected').length, 1);
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 1);
  assert.equal(h.db.rows("SELECT * FROM privacy_account_controls WHERE state='active'").length, 1);
});

test('policy changes cannot activate old approval and request storage is bounded per authenticated guardian', async t => {
  const h = harness(t);
  const request = await approved(h);
  const changed = createGuardianService({ db: h.db, env: { ...ENV, HARU_GUARDIAN_POLICY_VERSION: 'fixture-policy-v2' }, now: h.now });
  await assert.rejects(changed.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }), code('GUARDIAN_POLICY_CHANGED'));
  await assert.rejects(changed.approveRequest('guardian-one', request), code('GUARDIAN_POLICY_CHANGED'));
  for (let count = 1; count < GUARDIAN_LIMITS.pendingPerGuardian; count++) await h.service.createRequest('guardian-one');
  await assert.rejects(h.service.createRequest('guardian-one'), code('GUARDIAN_REQUEST_UNAVAILABLE'));
  assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, GUARDIAN_LIMITS.pendingPerGuardian);
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 0);
});


test('database commit rejects proofs that expire while the validated callback is queued', async t => {
  const h = harness(t);
  const request = await h.service.createRequest('guardian-one');
  const attestation = await signed(h, request, { exp: Math.floor(CLOCK / 1000) + 1 });
  h.db.beforeBatch = async statements => {
    if (statements[0].sql.includes("state = 'approved'")) {
      h.db.beforeBatch = null;
      h.setTime(CLOCK + 1000);
    }
  };
  await assert.rejects(h.service.approveRequest('guardian-one', { ...request, attestation }), code('GUARDIAN_REQUEST_USED'));
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
  assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'pending');
});

test('database commit rejects a child binding queued past its original request deadline', async t => {
  const h = harness(t);
  const request = await approved(h);
  h.setTime(request.expiresAt - 2000);
  h.db.beforeBatch = async statements => {
    if (statements[0].sql.includes("state = 'consumed'")) {
      h.db.beforeBatch = null;
      h.setTime(request.expiresAt);
    }
  };
  await assert.rejects(h.service.bindChild('guardian-one', { requestId: request.requestId, childId: 'child-one' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
  assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 0);
  assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'approved');
});

function sessionService(h, { createdAt = CLOCK, authenticatedAt = CLOCK, expiresAt = CLOCK + 86400000 } = {}) {
  const tokenHash = 'a'.repeat(64);
  h.db.sqlite.prepare(`INSERT INTO auth_sessions (token_hash,account_id,provider,created_at,authenticated_at,expires_at)
    VALUES (?, 'guardian-one','google',?,?,?)`).run(tokenHash, createdAt, authenticatedAt, expiresAt);
  return createGuardianService({ db: h.db, env: ENV, now: h.now, sessionProof: { tokenHash } });
}

test('guardian rights reject fresh sessions without recent verified authentication proof', async t => {
  for (const authenticatedAt of [null, CLOCK - 900000, CLOCK + 1000]) {
    const h = harness(t);
    const bound = await approved(h);
    await h.service.bindChild('guardian-one', { requestId: bound.requestId, childId: 'child-one' });
    const pending = await h.service.createRequest('guardian-one');
    const grant = await approved(h);
    const service = sessionService(h, { authenticatedAt, createdAt: authenticatedAt > CLOCK ? authenticatedAt : CLOCK });
    const before = ['guardian_requests', 'guardian_consents', 'guardian_links', 'privacy_account_controls']
      .map(table => h.db.rows(`SELECT * FROM ${table}`));
    for (const action of [
      () => service.createRequest('guardian-one'),
      () => service.listRequests('guardian-one'),
      () => service.rotateRequestToken('guardian-one', pending.requestId),
      () => service.approveRequest('guardian-one', grant),
      () => service.rejectRequest('guardian-one', pending.requestId),
      () => service.bindChild('guardian-one', { requestId: grant.requestId, childId: 'child-two' }),
      () => service.authorizeGuardian('guardian-one', 'child-one'),
    ]) await assert.rejects(action, code('GUARDIAN_ACCESS_DENIED'));
    assert.deepEqual(['guardian_requests', 'guardian_consents', 'guardian_links', 'privacy_account_controls']
      .map(table => h.db.rows(`SELECT * FROM ${table}`)), before);
  }
});

test('guardian final queries deny a session revoked after preflight for both create and request listing', async t => {
  for (const action of ['create', 'list']) {
    const h = harness(t);
    const service = sessionService(h);
    await h.service.createRequest('guardian-one');
    h.db.beforeQuery = async statement => {
      if (action === 'create' ? statement.sql.startsWith('INSERT INTO guardian_requests') : statement.sql.startsWith('SELECT id, state, created_at')) {
        h.db.beforeQuery = null;
        h.db.sqlite.exec(`UPDATE auth_sessions SET revoked_at=${CLOCK} WHERE account_id='guardian-one'`);
      }
    };
    if (action === 'create') await assert.rejects(service.createRequest('guardian-one'), code('GUARDIAN_REQUEST_UNAVAILABLE'));
    else assert.deepEqual(await service.listRequests('guardian-one'), []);
    assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, 1);
    await assert.rejects(service.authorizeGuardian('guardian-one', 'child-one'), code('GUARDIAN_ACCESS_DENIED'));
  }
});

test('guardian approval commit rechecks logout, session expiration, and the fresh-authentication deadline', async t => {
  for (const boundary of ['logout', 'expiry', 'freshness', 'authentication-reset']) {
    const h = harness(t);
    const service = sessionService(h, {
      authenticatedAt: boundary === 'freshness' ? CLOCK - 899000 : CLOCK,
      expiresAt: boundary === 'expiry' ? CLOCK + 1000 : CLOCK + 86400000,
    });
    const request = await h.service.createRequest('guardian-one');
    const attestation = await signed(h, request);
    h.db.beforeBatch = async statements => {
      if (statements[0].sql.includes("state = 'approved'")) {
        h.db.beforeBatch = null;
        if (boundary === 'logout') h.db.sqlite.exec(`UPDATE auth_sessions SET revoked_at=${CLOCK} WHERE account_id='guardian-one'`);
        else if (boundary === 'authentication-reset') h.db.sqlite.exec("UPDATE auth_sessions SET authenticated_at=NULL WHERE account_id='guardian-one'");
        else h.setTime(CLOCK + 1000);
      }
    };
    await assert.rejects(service.approveRequest('guardian-one', { ...request, attestation }), code('GUARDIAN_REQUEST_USED'));
    assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
    assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'pending');
  }
});

test('binding requires configured current policy in both the request and consent at atomic commit', async t => {
  const unconfigured = harness(t);
  const request = await approved(unconfigured);
  await assert.rejects(createGuardianService({ db: unconfigured.db, now: unconfigured.now }).bindChild('guardian-one', {
    requestId: request.requestId, childId: 'child-one',
  }), code('GUARDIAN_NOT_CONFIGURED'));
  for (const table of ['guardian_requests', 'guardian_consents']) {
    const h = harness(t);
    const grant = await approved(h);
    h.db.beforeBatch = async statements => {
      if (statements[0].sql.includes("state = 'consumed'")) {
        h.db.beforeBatch = null;
        h.db.sqlite.exec(`UPDATE ${table} SET policy_version='changed-policy'`);
      }
    };
    await assert.rejects(h.service.bindChild('guardian-one', { requestId: grant.requestId, childId: 'child-one' }), code('GUARDIAN_CHILD_UNAVAILABLE'));
    assert.equal(h.db.rows('SELECT * FROM guardian_links').length, 0);
    assert.equal(h.db.rows('SELECT state FROM guardian_requests')[0].state, 'approved');
    assert.equal(h.db.rows('SELECT child_account_id FROM guardian_consents')[0].child_account_id, null);
    assert.equal(h.db.rows("SELECT state FROM privacy_account_controls WHERE account_id='child-one'")[0].state, 'pending');
  }
});

test('request rejection removes proof and request together when session freshness expires inside the batch', async t => {
  const h = harness(t);
  const request = await approved(h);
  const service = sessionService(h);
  h.db.sqlite.function('expire_guardian_session', () => { h.setTime(CLOCK + 901000); return 1; });
  h.db.sqlite.exec(`CREATE TRIGGER expire_after_guardian_claim AFTER UPDATE OF consume_token ON guardian_requests
    WHEN NEW.consume_token IS NOT NULL BEGIN SELECT expire_guardian_session(); END`);
  assert.deepEqual(await service.rejectRequest('guardian-one', request.requestId), { removed: true });
  assert.equal(h.now(), CLOCK + 901000);
  assert.equal(h.db.rows('SELECT * FROM guardian_requests').length, 0);
  assert.equal(h.db.rows('SELECT * FROM guardian_consents').length, 0);
});
