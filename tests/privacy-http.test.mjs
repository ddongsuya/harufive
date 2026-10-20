import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createGameService } from '../server/game-service.mjs';
import { handleStandaloneRequest } from '../server/standalone-http.mjs';
import { AUTH_COOKIES } from '../server/auth-service.mjs';
import { PRIVACY_LIMITS } from '../server/privacy-http.mjs';
import { createAccountLifecycle } from '../server/account-lifecycle.mjs';

const ORIGIN = 'https://haru-five.example.test';
const START = Date.parse('2026-10-20T09:00:00+09:00');
const hash = value => createHash('sha256').update(value).digest('hex');
const forgedSites = {
  'oai-authenticated-user-id': 'another-account',
  'oai-authenticated-user-email': 'fixture-owner@example.test',
};

function fixture(t) {
  const db = createSQLiteD1();
  t.after(() => db.close());
  let clock = START, serial = 0;
  const now = () => clock;
  db.sqlite.function('unixepoch', (_modifier) => Math.floor(clock / 1000));
  const env = {
    HARU_AUTH_ORIGIN: ORIGIN,
    HARU_REGISTRATION_OPEN: 'true',
    HARU_SITES_TESTER_EMAIL: 'fixture-owner@example.test',
  };
  const f = {
    db, env, now,
    game: createGameService({ db, now }),
    advance(ms) { clock += ms; },
    account(id) {
      db.sqlite.prepare('INSERT OR IGNORE INTO auth_accounts (id, created_at) VALUES (?, ?)').run(id, clock);
      db.sqlite.prepare("INSERT OR IGNORE INTO privacy_account_controls VALUES (?, 'active', ?)").run(id, clock);
      return id;
    },
    session(accountId, { createdAt = clock, authenticatedAt = clock, expiresAt = clock + 86400000 } = {}) {
      f.account(accountId);
      const token = Buffer.alloc(32, ++serial).toString('base64url');
      db.sqlite.prepare(`INSERT INTO auth_sessions
        (token_hash, account_id, provider, created_at, authenticated_at, expires_at, binding_hash)
        VALUES (?, ?, 'google', ?, ?, ?, ?)`).run(hash(token), accountId, createdAt, authenticatedAt, expiresAt, `secret-binding-${accountId}`);
      return { token, hash: hash(token), headers: { Cookie: `${AUTH_COOKIES.session}=${token}` } };
    },
    call(pathname, {
      method = 'GET', body, raw, headers = {}, urlOrigin = ORIGIN, omitOrigin = false,
    } = {}) {
      const requestHeaders = new Headers({
        ...(method === 'POST' ? { Origin: ORIGIN, 'Content-Type': 'application/json' } : {}),
        ...headers,
      });
      if (omitOrigin) requestHeaders.delete('Origin');
      const request = new Request(`${urlOrigin}${pathname}`, {
        method, headers: requestHeaders,
        ...(raw !== undefined || body !== undefined
          ? { body: raw ?? JSON.stringify(body), duplex: 'half' } : {}),
      });
      return handleStandaloneRequest(request, {
        db, env, now,
        sitesUserId: 'another-account',
        sitesEmail: 'fixture-owner@example.test',
        fetch() { assert.fail('No external provider request is allowed in these HTTP tests'); },
      });
    },
    async context(session) {
      const response = await f.call('/api/privacy/status', { headers: session.headers });
      assert.equal(response.status, 200, await response.clone().text());
      return (await response.json()).accountContext;
    },
    async list(pathname, session, context) {
      return f.call(pathname, {
        headers: { ...session.headers, 'X-Haru-Account': context ?? await f.context(session) },
      });
    },
    post(action, session, context, body = {}, namespace = 'privacy', options = {}) {
      return f.call(`/api/${namespace}/${action}`, {
        method: 'POST', body,
        ...options,
        headers: { ...session.headers, 'X-Haru-Account': context, ...options.headers },
      });
    },
    family(guardianId, childId) {
      f.account(guardianId);
      f.account(childId);
      const consentId = `consent-${childId}`;
      db.sqlite.prepare(`INSERT INTO guardian_consents
        (id, guardian_account_id, child_account_id, proof_hash, jti_hash, subject_hash, scopes, policy_version, approved_at)
        VALUES (?, ?, ?, ?, ?, ?, '["account:create","game:play","game:records"]', 'test-policy-v1', ?)`)
        .run(consentId, guardianId, childId, `secret-proof-${childId}`, `secret-jti-${childId}`, `secret-subject-${childId}`, clock);
      db.sqlite.prepare("INSERT INTO guardian_links VALUES (?, ?, ?, 'active', ?)").run(childId, guardianId, consentId, clock);
    },
    guardianRequest(guardianId, requestId = `request-${guardianId}`) {
      db.sqlite.prepare(`INSERT INTO guardian_requests
        (id, guardian_account_id, token_hash, nonce_hash, created_at, expires_at, policy_version, state)
        VALUES (?, ?, ?, ?, ?, ?, 'test-policy-v1', 'pending')`)
        .run(requestId, guardianId, hash('old-request-token'), hash('old-nonce'), clock, clock + 86400000);
      return requestId;
    },
  };
  return f;
}

async function expectCode(response, status, code) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal((await response.json()).code, code);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
}

test('privacy endpoints reject unauthenticated, forged Sites and invalid opaque identities without collection', async t => {
  const f = fixture(t);
  for (const cookie of ['', `${AUTH_COOKIES.session}=sites`, `${AUTH_COOKIES.session}=${'z'.repeat(43)}`]) {
    const headers = { ...forgedSites, Cookie: cookie, 'X-Haru-Account': 'client-supplied-context' };
    await expectCode(await f.call('/api/privacy/status', { headers }), 401, 'SIGN_IN_REQUIRED');
    await expectCode(await f.call('/api/privacy/children', { headers }), 401, 'SIGN_IN_REQUIRED');
    await expectCode(await f.call('/api/privacy/export', { method: 'POST', body: {}, headers }), 401, 'SIGN_IN_REQUIRED');
    await expectCode(await f.call('/api/guardian/requests', { headers }), 401, 'SIGN_IN_REQUIRED');
  }
  for (const table of ['auth_accounts', 'game_players', 'game_rate_limits', 'guardian_requests', 'privacy_deletion_jobs']) {
    assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table}`)[0].count, 0, table);
  }
});

test('expired sessions and missing, old or future verified authentication times cannot use privacy rights', async t => {
  const f = fixture(t);
  const expired = f.session('expired', { createdAt: START - 60000, authenticatedAt: START - 60000, expiresAt: START });
  const stale = f.session('stale', { authenticatedAt: START - PRIVACY_LIMITS.freshSessionMs });
  const future = f.session('future', { createdAt: START + 1, authenticatedAt: START + 1 });
  const unverified = f.session('unverified', { authenticatedAt: null });
  for (const [session, code] of [[expired, 'SIGN_IN_REQUIRED'], [stale, 'REAUTH_REQUIRED'], [future, 'REAUTH_REQUIRED'], [unverified, 'REAUTH_REQUIRED']]) {
    await expectCode(await f.call('/api/privacy/status', { headers: session.headers }), 401, code);
    await expectCode(await f.call('/api/privacy/children', { headers: session.headers }), 401, code);
    await expectCode(await f.post('export', session, 'old-context'), 401, code);
  }
  assert.equal(f.db.rows('SELECT * FROM game_rate_limits').length, 0);
  const fresh = f.session('fresh', { authenticatedAt: START - PRIVACY_LIMITS.freshSessionMs + 1000 });
  assert.equal((await f.call('/api/privacy/status', { headers: fresh.headers })).status, 200);
});

test('an ordinary fresh session still plays but cannot create recent-auth privacy authority without signed authentication time', async t => {
  const f = fixture(t);
  const session = f.session('game-only-session', { authenticatedAt: null });
  const game = await f.call('/api/game/bootstrap', { headers: session.headers });
  assert.equal(game.status, 200);
  const before = f.db.rows('SELECT * FROM game_rate_limits');
  for (const path of ['/api/privacy/status', '/api/privacy/children', '/api/guardian/requests']) {
    await expectCode(await f.call(path, { headers: session.headers }), 401, 'REAUTH_REQUIRED');
  }
  for (const action of ['status', 'export', 'withdraw', 'delete']) {
    await expectCode(await f.post(action, session, 'unverified-context', {
      ...(['withdraw', 'delete'].includes(action) ? { confirmation: action } : {}),
    }), 401, 'REAUTH_REQUIRED');
  }
  assert.deepEqual(f.db.rows('SELECT * FROM game_rate_limits'), before);
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  assert.equal(f.db.rows('SELECT * FROM guardian_requests').length, 0);
  assert.equal(f.db.rows("SELECT state FROM privacy_account_controls WHERE account_id='game-only-session'")[0].state, 'active');
});

test('privacy status exposes a session context and unready enrollment without creating a player', async t => {
  const f = fixture(t);
  const session = f.session('status-account');
  const response = await f.call('/api/privacy/status', { headers: { ...session.headers, ...forgedSites } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.accountContext, /^[a-f0-9]{64}$/);
  assert.equal(body.playerId, null);
  assert.deepEqual(body.account, { state: 'active', deletion: null });
  assert.deepEqual(body.guardian, { guardianReady: false, providerConfigured: false, enrollmentOpen: false });
  assert.deepEqual(body.admission, { minimumSignupAge: 14, registrationOpen: false, under14EnrollmentOpen: false, ageVerificationReady: false });
  assert.equal(body.selfRecoveryReady, false);
  assert.deepEqual(body.capabilities, { selfExport: true, childManagement: true, selfClosure: false, guardianEnrollment: false });
  assert.doesNotMatch(JSON.stringify(body), /status-account|secret-binding|another-account/);
  assert.ok(!JSON.stringify(body).includes(session.token));
  assert.ok(!JSON.stringify(body).includes(session.hash));
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
});

test('privacy status identifies the current public game profile across an account cookie switch', async t => {
  const f = fixture(t);
  const first = f.session('profile-first');
  const second = f.session('profile-second');
  const firstGame = await f.game.bootstrap('profile-first');
  const secondGame = await f.game.bootstrap('profile-second');
  const firstStatus = await (await f.call('/api/privacy/status', { headers: first.headers })).json();
  const secondStatus = await (await f.call('/api/privacy/status', { headers: second.headers })).json();
  assert.equal(firstStatus.playerId, firstGame.state.playerId);
  assert.equal(secondStatus.playerId, secondGame.state.playerId);
  assert.notEqual(firstStatus.playerId, secondStatus.playerId);
  assert.notEqual(firstStatus.accountContext, secondStatus.accountContext);
  assert.doesNotMatch(JSON.stringify(secondStatus), /profile-first|profile-second|secret-binding/);
});

for (const invalidation of ['logout', 'withdrawn', 'authentication-reset']) {
  test(`privacy status rejects ${invalidation} before the final profile query without partial status data`, async t => {
    const f = fixture(t);
    const session = f.session('profile-race');
    await f.game.bootstrap('profile-race');
    let intervened = false;
    f.db.beforeQuery = async ({ sql }) => {
      if (!sql.includes('SELECT player.public_id')) return;
      f.db.beforeQuery = null;
      intervened = true;
      if (invalidation === 'logout') {
        assert.equal((await f.call('/api/auth/logout', { method: 'POST', body: {}, headers: session.headers })).status, 200);
      } else if (invalidation === 'withdrawn') {
        f.db.sqlite.prepare("UPDATE privacy_account_controls SET state='withdrawn' WHERE account_id='profile-race'").run();
      } else {
        f.db.sqlite.prepare("UPDATE auth_sessions SET authenticated_at=NULL WHERE account_id='profile-race'").run();
      }
    };
    const response = await f.call('/api/privacy/status', { headers: session.headers });
    const payload = await response.clone().text();
    assert.equal(intervened, true);
    await expectCode(response, 403, 'RIGHTS_UNAVAILABLE');
    assert.doesNotMatch(payload, /playerId|accountContext|capabilities|profile-race/);
  });
}

test('account switching and renewed-session contexts prevent stale-tab rights mutations', async t => {
  const f = fixture(t);
  const first = f.session('first-account');
  const other = f.session('other-account');
  const context = await f.context(first);
  await expectCode(await f.post('delete', other, context, { confirmation: 'delete' }), 409, 'ACCOUNT_CHANGED');
  await expectCode(await f.post('export', first, ''), 409, 'ACCOUNT_CHANGED');
  const renewed = f.session('first-account');
  await expectCode(await f.post('withdraw', renewed, context, { confirmation: 'withdraw' }), 409, 'ACCOUNT_CHANGED');
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  assert.ok(f.db.rows('SELECT state FROM privacy_account_controls').every(row => row.state === 'active'));
  assert.ok(f.db.rows('SELECT revoked_at FROM auth_sessions').every(row => row.revoked_at === null));
});

for (const pathname of ['/api/privacy/children', '/api/guardian/requests']) {
  test(`${pathname} requires the established session context before reading another account's list`, async t => {
    const f = fixture(t);
    f.family('list-first-parent', 'list-first-child');
    f.family('list-second-parent', 'list-second-child');
    f.guardianRequest('list-first-parent');
    f.guardianRequest('list-second-parent');
    const first = f.session('list-first-parent');
    const second = f.session('list-second-parent');
    const firstContext = await f.context(first);
    const firstResponse = await f.list(pathname, first, firstContext);
    assert.equal(firstResponse.status, 200);
    assert.match(await firstResponse.text(), /list-first-/);
    const before = f.db.rows('SELECT * FROM game_rate_limits ORDER BY user_id');
    let listReads = 0;
    f.db.beforeQuery = ({ sql }) => {
      if (sql.includes('FROM guardian_requests') || sql.includes('JOIN guardian_links child_link')) listReads++;
    };
    f.db.beforeBatch = statements => {
      if (statements.some(statement => statement.sql.includes('JOIN guardian_links child_link'))) listReads++;
    };
    for (const headers of [
      second.headers,
      { ...second.headers, 'X-Haru-Account': firstContext },
      { ...first.headers, 'X-Haru-Account': '' },
      { ...first.headers, 'X-Haru-Account': 'not-a-context' },
    ]) {
      const response = await f.call(pathname, { headers });
      const body = await response.clone().text();
      await expectCode(response, 409, 'ACCOUNT_CHANGED');
      assert.doesNotMatch(body, /list-first|list-second|children|requests|requestId|childAccountId/);
    }
    const renewed = f.session('list-first-parent');
    await expectCode(await f.list(pathname, renewed, firstContext), 409, 'ACCOUNT_CHANGED');
    assert.equal(listReads, 0, 'Stale or missing context must fail before any private list query');
    assert.deepEqual(f.db.rows('SELECT * FROM game_rate_limits ORDER BY user_id'), before);
    f.db.beforeQuery = null;
    f.db.beforeBatch = null;
    const secondContext = await f.context(second);
    const secondResponse = await f.list(pathname, second, secondContext);
    assert.equal(secondResponse.status, 200);
    const secondPayload = await secondResponse.text();
    assert.match(secondPayload, /list-second-/);
    assert.doesNotMatch(secondPayload, /list-first-/);
  });
}

test('privacy routes require a configured HTTPS origin and reject cross-site or missing-origin writes', async t => {
  const f = fixture(t);
  const session = f.session('origin-account');
  const context = await f.context(session);
  for (const headers of [{ Origin: 'https://evil.example' }, { Origin: 'null' }, { 'Sec-Fetch-Site': 'cross-site' }]) {
    await expectCode(await f.post('export', session, context, {}, 'privacy', { headers }), 403, 'ORIGIN_REJECTED');
  }
  await expectCode(await f.post('export', session, context, {}, 'privacy', { omitOrigin: true }), 403, 'ORIGIN_REJECTED');
  await expectCode(await f.call('/api/privacy/status', { headers: session.headers, urlOrigin: 'https://evil.example' }), 403, 'ORIGIN_REJECTED');
  await expectCode(await f.call('/api/privacy/status', { headers: { ...session.headers, Origin: 'https://evil.example' } }), 403, 'ORIGIN_REJECTED');
  for (const value of [undefined, 'http://haru-five.example.test', `${ORIGIN}/unexpected`, `${ORIGIN}?query=1`, ` ${ORIGIN}`, `https://user:pass@haru-five.example.test`]) {
    f.env.HARU_AUTH_ORIGIN = value;
    await expectCode(await f.call('/api/privacy/status', { headers: session.headers }), 503, 'AUTH_NOT_CONFIGURED');
  }
});

test('rights JSON rejects unexpected authority, purge policy, query fields and malformed target identifiers', async t => {
  const f = fixture(t);
  const session = f.session('validation-account');
  const context = await f.context(session);
  for (const body of [
    { actorId: 'victim' }, { accountId: 'victim' }, { purgePolicy: { eraseGameAndAccountData: true } },
    { guardianReady: true }, { confirmed: true }, { HARU_REGISTRATION_OPEN: 'true' },
  ]) {
    await expectCode(await f.post('export', session, context, body), 400, 'UNEXPECTED_FIELD');
  }
  for (const childAccountId of ['', null, 4, {}, 'x'.repeat(201)]) {
    await expectCode(await f.post('status', session, context, { childAccountId }), 400, 'INVALID_REQUEST');
  }
  await expectCode(await f.call('/api/privacy/status?childAccountId=victim', { headers: session.headers }), 400, 'UNEXPECTED_FIELD');
  await expectCode(await f.post('create', session, context, { actorId: 'victim' }, 'guardian'), 400, 'UNEXPECTED_FIELD');
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  assert.equal(f.db.rows('SELECT * FROM guardian_requests').length, 0);
});

test('rights body parser enforces JSON, valid UTF-8 and the streamed byte limit', async t => {
  const f = fixture(t);
  const session = f.session('body-account');
  const context = await f.context(session);
  await expectCode(await f.post('export', session, context, {}, 'privacy', { headers: { 'Content-Type': 'text/plain' } }), 415, 'JSON_REQUIRED');
  for (const raw of ['{', 'null', '[]', '"text"', '42', new Uint8Array([0xff, 0xfe])]) {
    await expectCode(await f.post('export', session, context, {}, 'privacy', { raw }), 400, 'INVALID_JSON');
  }
  const large = JSON.stringify({ childAccountId: 'x'.repeat(PRIVACY_LIMITS.bodyBytes) });
  for (const declared of ['1', String(PRIVACY_LIMITS.bodyBytes + 1), 'invalid']) {
    await expectCode(await f.post('export', session, context, {}, 'privacy', { raw: large, headers: { 'Content-Length': declared } }), 413, 'BODY_TOO_LARGE');
  }
  const stream = new ReadableStream({ start(controller) {
    const chunk = new TextEncoder().encode(' '.repeat(Math.floor(PRIVACY_LIMITS.bodyBytes / 2)));
    controller.enqueue(chunk); controller.enqueue(chunk); controller.enqueue(chunk); controller.close();
  } });
  await expectCode(await f.post('export', session, context, {}, 'privacy', { raw: stream }), 413, 'BODY_TOO_LARGE');
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
});

test('fresh own export contains own records but no provider subjects, session credentials or unfinished questions', async t => {
  const f = fixture(t);
  const session = f.session('export-owner');
  f.account('other-export-account');
  await f.game.start('export-owner', { mode: 'daily', requestId: 'privacy-export-start' });
  await f.game.rename('other-export-account', { name: '다른가족', requestId: 'privacy-export-other' });
  f.db.sqlite.prepare(`INSERT INTO auth_identities
    (id, account_id, provider, issuer, audience, subject, linked_at)
    VALUES ('private-identity', 'export-owner', 'google', 'https://accounts.google.com', 'private-client-id', 'secret-provider-subject', ?)`).run(START);
  const context = await f.context(session);
  const before = f.db.rows('SELECT coins, revision FROM game_players WHERE id = ?', 'export-owner')[0];
  const response = await f.post('export', session, context);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Disposition'), /attachment/);
  const body = await response.json();
  assert.equal(body.format, 'haru-five-rights-export-v1');
  assert.equal(body.profile.coins, 180);
  assert.equal(body.attempts.length, 1);
  assert.equal(body.attempts[0].status, 'active');
  assert.equal(body.attempts[0].payload, undefined);
  assert.equal(body.attempts[0].id, undefined);
  assert.deepEqual(body.linkedProviders, [{ provider: 'google', linked_at: START }]);
  assert.doesNotMatch(JSON.stringify(body), /secret-provider-subject|private-client-id|private-identity|secret-binding|다른가족|export-owner|token_hash|mutation_token|questionId/);
  assert.ok(!JSON.stringify(body).includes(session.token));
  assert.ok(!JSON.stringify(body).includes(session.hash));
  assert.deepEqual(f.db.rows('SELECT coins, revision FROM game_players WHERE id = ?', 'export-owner')[0], before);
});

for (const action of ['withdraw', 'delete']) {
  test(`self ${action} is closed for omitted and explicit own targets without revoking sessions or changing data`, async t => {
    const f = fixture(t);
    const accountId = `self-closure-${action}`;
    const session = f.session(accountId);
    await f.game.start(accountId, { mode: 'daily', requestId: `self-closure-daily-${action}` });
    const status = await (await f.call('/api/privacy/status', { headers: session.headers })).json();
    const context = status.accountContext;
    assert.equal(status.capabilities.selfClosure, false);
    assert.equal(status.selfRecoveryReady, false);
    const tables = ['auth_accounts', 'auth_identities', 'auth_sessions', 'auth_oauth_transactions',
      'privacy_account_controls', 'privacy_deletion_jobs', 'guardian_links', 'guardian_consents',
      'game_players', 'game_attempts', 'game_results', 'game_coin_ledger', 'game_weekly_awards', 'game_rate_limits'];
    const snapshot = () => tables.map(table => f.db.rows(`SELECT * FROM ${table}`));
    const before = snapshot();
    for (const target of [{}, { childAccountId: accountId }]) {
      const response = await f.post(action, session, context, { ...target, confirmation: action });
      await expectCode(response, 403, 'SELF_CLOSURE_NOT_READY');
      assert.equal(response.headers.getSetCookie().length, 0);
      assert.deepEqual(snapshot(), before, 'Blocked self closure must not mutate even the request quota');
    }
    for (const target of [{}, { childAccountId: accountId }]) {
      assert.equal((await f.post('status', session, context, target)).status, 200);
      assert.equal((await f.post('export', session, context, target)).status, 200);
    }
    assert.equal((await f.call('/api/game/bootstrap', { headers: session.headers })).status, 200);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, null);
    assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  });
}

test('environment, header and body readiness claims cannot reopen self closure', async t => {
  const f = fixture(t);
  Object.assign(f.env, { HARU_SELF_CLOSURE_READY: 'true', HARU_SELF_RECOVERY_READY: 'true',
    HARU_REGISTRATION_OPEN: 'true', selfClosure: true, selfRecoveryReady: true });
  const accountId = 'self-closure-flags';
  const session = f.session(accountId);
  const context = await f.context(session);
  for (const action of ['withdraw', 'delete']) {
    for (const flag of ['selfClosure', 'selfRecoveryReady', 'capabilities']) {
      await expectCode(await f.post(action, session, context, { confirmation: action, [flag]: true }), 400, 'UNEXPECTED_FIELD');
    }
    await expectCode(await f.post(action, session, context, { childAccountId: accountId, confirmation: action }, 'privacy', {
      headers: { 'X-Haru-Self-Closure': 'true', 'X-Haru-Self-Recovery': 'true' },
    }), 403, 'SELF_CLOSURE_NOT_READY');
  }
  const status = await (await f.call('/api/privacy/status', { headers: session.headers })).json();
  assert.equal(status.capabilities.selfClosure, false);
  assert.equal(status.selfRecoveryReady, false);
  assert.equal(status.account.state, 'active');
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, null);
});

for (const action of ['withdraw', 'delete']) {
  test(`logout after HTTP authentication prevents the queued ${action} transaction`, async t => {
    const f = fixture(t);
    const accountId = `logout-race-${action}`;
    const session = f.session(accountId);
    const childId = `${accountId}-child`;
    f.family(accountId, childId);
    const childSession = f.session(childId);
    const context = await f.context(session);
    let intervened = false;
    f.db.beforeBatch = async statements => {
      if (!statements.some(statement => statement.sql.includes('INSERT INTO privacy_account_controls'))) return;
      f.db.beforeBatch = null;
      intervened = true;
      const logout = await f.call('/api/auth/logout', {
        method: 'POST', headers: session.headers, body: {},
      });
      assert.equal(logout.status, 200);
    };
    const response = await f.post(action, session, context, { childAccountId: childId, confirmation: action });
    assert.equal(intervened, true, 'Logout must occur immediately before the family account mutation batch');
    await expectCode(response, 403, 'RIGHTS_UNAVAILABLE');
    assert.equal(f.db.rows('SELECT state FROM privacy_account_controls WHERE account_id = ?', accountId)[0].state, 'active');
    assert.equal(f.db.rows('SELECT disabled_at FROM auth_accounts WHERE id = ?', accountId)[0].disabled_at, null);
    assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, START);
    assert.equal(f.db.rows('SELECT state FROM privacy_account_controls WHERE account_id = ?', childId)[0].state, 'active');
    assert.equal(f.db.rows('SELECT disabled_at FROM auth_accounts WHERE id = ?', childId)[0].disabled_at, null);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', childSession.hash)[0].revoked_at, null);
    assert.equal(f.db.rows('SELECT state FROM guardian_links WHERE child_account_id = ?', childId)[0].state, 'active');
  });
}

test('verified guardian can withdraw a child and continue status, export and deletion rights afterward', async t => {
  const f = fixture(t);
  f.family('verified-guardian', 'linked-child');
  const guardian = f.session('verified-guardian');
  const child = f.session('linked-child');
  await f.game.bootstrap('linked-child');
  const context = await f.context(guardian);
  await expectCode(await f.post('withdraw', guardian, context, { childAccountId: 'linked-child', confirmation: 'delete' }), 400, 'CONFIRMATION_REQUIRED');
  const withdrawn = await f.post('withdraw', guardian, context, { childAccountId: 'linked-child', confirmation: 'withdraw' });
  assert.equal(withdrawn.status, 200);
  assert.equal((await withdrawn.json()).state, 'withdrawn');
  assert.equal(f.db.rows('SELECT state FROM guardian_links WHERE child_account_id = ?', 'linked-child')[0].state, 'withdrawn');
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', child.hash)[0].revoked_at, START);
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', guardian.hash)[0].revoked_at, null);
  const exported = await f.post('export', guardian, context, { childAccountId: 'linked-child' });
  assert.equal(exported.status, 200);
  assert.equal((await exported.json()).access.state, 'withdrawn');
  const status = await f.post('status', guardian, context, { childAccountId: 'linked-child' });
  assert.equal((await status.json()).state, 'withdrawn');
  const deletion = await f.post('delete', guardian, context, { childAccountId: 'linked-child', confirmation: 'delete' });
  assert.equal(deletion.status, 200);
  assert.equal((await deletion.json()).state, 'deletion_pending');
  const final = await f.post('status', guardian, context, { childAccountId: 'linked-child' });
  assert.equal((await final.json()).deletion.status, 'pending');
  assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', 'linked-child').length, 1);
});

test('another family cannot inspect, export, withdraw or delete a linked child', async t => {
  const f = fixture(t);
  f.family('guardian-one', 'child-one');
  f.family('guardian-two', 'child-two');
  const stranger = f.session('guardian-two');
  const context = await f.context(stranger);
  for (const action of ['status', 'export', 'withdraw', 'delete']) {
    await expectCode(await f.post(action, stranger, context, {
      childAccountId: 'child-one',
      ...(['withdraw', 'delete'].includes(action) ? { confirmation: action } : {}),
    }), 403, 'RIGHTS_UNAVAILABLE');
  }
  assert.equal(f.db.rows('SELECT state FROM privacy_account_controls WHERE account_id = ?', 'child-one')[0].state, 'active');
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  assert.equal(f.db.rows('SELECT withdrawn_at FROM guardian_consents WHERE child_account_id = ?', 'child-one')[0].withdrawn_at, null);
});

test('children lists only the verified guardian family with minimal labels and withdrawn or pending-deletion state', async t => {
  const f = fixture(t);
  f.family('list-parent', 'active-child');
  f.family('list-parent', 'withdrawn-child');
  f.family('list-parent', 'pending-child');
  f.family('other-parent', 'other-child');
  await f.game.bootstrap('active-child');
  f.db.sqlite.prepare("UPDATE game_players SET name='별토끼' WHERE id='active-child'").run();
  const session = f.session('list-parent');
  const context = await f.context(session);
  assert.equal((await f.post('withdraw', session, context, { childAccountId: 'withdrawn-child', confirmation: 'withdraw' })).status, 200);
  assert.equal((await f.post('delete', session, context, { childAccountId: 'pending-child', confirmation: 'delete' })).status, 200);
  const before = f.db.rows('SELECT id, coins, revision FROM game_players ORDER BY id');
  const response = await f.list('/api/privacy/children', session, context);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
  const body = await response.json();
  assert.equal(body.hasMore, false);
  assert.deepEqual(body.children, [
    { childAccountId: 'active-child', label: '별토끼', state: 'active', deletion: null },
    { childAccountId: 'pending-child', label: '연결된 어린이', state: 'deletion_pending',
      deletion: { status: 'pending', requestedAt: START, completedAt: null } },
    { childAccountId: 'withdrawn-child', label: '연결된 어린이', state: 'withdrawn', deletion: null },
  ]);
  assert.doesNotMatch(JSON.stringify(body), /other-child|other-parent|secret-|consent-|token|subject|proof|accountContext/);
  assert.ok(!JSON.stringify(body).includes(session.hash));
  assert.deepEqual(f.db.rows('SELECT id, coins, revision FROM game_players ORDER BY id'), before);
  const other = f.session('other-parent');
  const otherList = await (await f.list('/api/privacy/children', other)).json();
  assert.deepEqual(otherList.children.map(child => child.childAccountId), ['other-child']);
  const unrelated = f.session('no-family');
  assert.deepEqual(await (await f.list('/api/privacy/children', unrelated)).json(), { children: [], hasMore: false });
});

test('purged children and restored stale family data stay absent from child lists behind a deletion marker', async t => {
  const f = fixture(t);
  f.family('purge-parent', 'purged-child');
  await f.game.bootstrap('purged-child');
  const session = f.session('purge-parent');
  const context = await f.context(session);
  await f.post('delete', session, context, { childAccountId: 'purged-child', confirmation: 'delete' });
  const lifecycle = createAccountLifecycle({ db: f.db, now: f.now, purgePolicy: {
    version: 1, policyId: 'test-list-purge-policy',
    eraseGameAndAccountData: true, eraseGuardianEvidence: true, retainMinimalClosureRecords: true,
    closureRetention: 'test marker retention', receiptRetention: 'test receipt retention',
    backupReplayProcedure: 'test restored records are fenced by closure markers',
  } });
  assert.equal((await lifecycle.processDeletionJobs({})).processed, 1);
  assert.deepEqual(await (await f.list('/api/privacy/children', session, context)).json(), { children: [], hasMore: false });
  // Model stale live records restored before a backup closure marker is replayed:
  // the already-present terminal marker must stop names/relations resurfacing.
  f.family('purge-parent', 'purged-child');
  f.db.sqlite.prepare(`INSERT INTO game_players
    (id,public_id,name,coins,owned,equipped,created_day,created_at)
    VALUES ('purged-child','old-public','삭제된 이름',180,'[]','{}','2026-10-20',?)`).run(START);
  assert.equal(f.db.rows("SELECT state FROM privacy_account_controls WHERE account_id='purged-child'")[0].state, 'deleted');
  assert.deepEqual(await (await f.list('/api/privacy/children', session, context)).json(), { children: [], hasMore: false });
});

test('children endpoint accepts only a same-origin GET without client-selected guardian or child identifiers', async t => {
  const f = fixture(t);
  const session = f.session('children-route-parent');
  for (const query of ['?guardianId=victim', '?childAccountId=victim', '?limit=1000']) {
    await expectCode(await f.call(`/api/privacy/children${query}`, { headers: session.headers }), 400, 'UNEXPECTED_FIELD');
  }
  await expectCode(await f.call('/api/privacy/children', {
    headers: { ...session.headers, Origin: 'https://evil.example' },
  }), 403, 'ORIGIN_REJECTED');
  const response = await f.call('/api/privacy/children', { method: 'POST', body: {}, headers: session.headers });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET');
});

for (const invalidation of ['logout', 'freshness', 'blocked', 'authentication-reset']) {
  test(`queued child list rejects ${invalidation} after HTTP authentication without exposing family data`, async t => {
    const f = fixture(t);
    f.family('queued-parent', 'queued-child');
    const session = f.session('queued-parent');
    let intervened = false;
    f.db.beforeBatch = async statements => {
      if (!statements.some(statement => statement.sql.includes('JOIN guardian_links child_link'))) return;
      f.db.beforeBatch = null;
      intervened = true;
      if (invalidation === 'logout') {
        assert.equal((await f.call('/api/auth/logout', { method: 'POST', body: {}, headers: session.headers })).status, 200);
      } else if (invalidation === 'freshness') {
        f.advance(PRIVACY_LIMITS.freshSessionMs);
      } else if (invalidation === 'blocked') {
        f.db.sqlite.prepare("UPDATE privacy_account_controls SET state='withdrawn' WHERE account_id='queued-parent'").run();
      } else {
        f.db.sqlite.prepare("UPDATE auth_sessions SET authenticated_at=NULL WHERE account_id='queued-parent'").run();
      }
    };
    const response = await f.list('/api/privacy/children', session);
    assert.equal(intervened, true);
    const payload = await response.clone().text();
    await expectCode(response, 403, 'RIGHTS_UNAVAILABLE');
    assert.doesNotMatch(payload, /queued-child|children|secret-|consent-/);
  });
}

test('a relation removed before a queued child list is read cannot disclose its former child', async t => {
  const f = fixture(t);
  f.family('former-parent', 'former-child');
  const session = f.session('former-parent');
  f.db.beforeBatch = statements => {
    if (!statements.some(statement => statement.sql.includes('JOIN guardian_links child_link'))) return;
    f.db.beforeBatch = null;
    f.db.sqlite.prepare("DELETE FROM guardian_links WHERE child_account_id='former-child'").run();
  };
  assert.deepEqual(await (await f.list('/api/privacy/children', session)).json(), { children: [], hasMore: false });
});

test('14+ policy closes new guardian enrollment but preserves owned pending-request listing and rejection', async t => {
  const f = fixture(t);
  const guardian = f.session('request-guardian');
  f.account('other-request-guardian');
  const requestId = f.guardianRequest('request-guardian');
  f.guardianRequest('other-request-guardian');
  const context = await f.context(guardian);
  const listed = await f.list('/api/guardian/requests', guardian, context);
  assert.equal(listed.status, 200);
  const { requests } = await listed.json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, requestId);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['createdAt', 'expiresAt', 'policyVersion', 'requestId', 'status']);
  const before = f.db.rows('SELECT * FROM guardian_requests');
  await expectCode(await f.post('create', guardian, context, {}, 'guardian'), 403, 'CHILD_ENROLLMENT_CLOSED');
  await expectCode(await f.post('rotate', guardian, context, { requestId }, 'guardian'), 403, 'CHILD_ENROLLMENT_CLOSED');
  await expectCode(await f.post('approve', guardian, context, {
    requestId, requestToken: 'old-request-token', attestation: 'untrusted-proof',
  }, 'guardian'), 403, 'CHILD_ENROLLMENT_CLOSED');
  assert.deepEqual(f.db.rows('SELECT * FROM guardian_requests'), before);
  assert.equal(f.db.rows('SELECT * FROM guardian_consents').length, 0);
  const rejected = await f.post('reject', guardian, context, { requestId }, 'guardian');
  assert.equal(rejected.status, 200);
  assert.deepEqual(await rejected.json(), { removed: true });
  assert.equal(f.db.rows('SELECT * FROM guardian_requests').length, 1);
});

test('privacy methods and unexposed bind, purge and maintenance actions cannot be invoked', async t => {
  const f = fixture(t);
  const session = f.session('route-account');
  const context = await f.context(session);
  for (const pathname of ['/api/guardian/bind', '/api/guardian/purge', '/api/privacy/purge', '/api/privacy/maintenance', '/api/privacy/processDeletionJobs']) {
    await expectCode(await f.call(pathname, {
      method: 'POST', headers: { ...session.headers, 'X-Haru-Account': context }, body: {},
    }), 404, 'NOT_FOUND');
  }
  for (const pathname of ['/api/privacy/export', '/api/privacy/withdraw', '/api/privacy/delete', '/api/guardian/create']) {
    const response = await f.call(pathname, { headers: session.headers });
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('Allow'), 'POST');
  }
  const response = await f.call('/api/guardian/requests', { method: 'POST', body: {}, headers: session.headers });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('Allow'), 'GET');
});

test('privacy thirty-request quota includes game requests and resets with the next minute', async t => {
  const f = fixture(t);
  const session = f.session('quota-owner');
  assert.equal((await f.call('/api/game/bootstrap', { headers: session.headers })).status, 200);
  for (let count = 1; count < PRIVACY_LIMITS.requestsPerMinute; count++) {
    const response = await f.call('/api/privacy/status', { headers: session.headers });
    assert.equal(response.status, 200, `combined request ${count + 1}`);
  }
  await expectCode(await f.call('/api/privacy/status', { headers: session.headers }), 429, 'RATE_LIMITED');
  assert.equal(f.db.rows('SELECT request_count FROM game_rate_limits WHERE user_id = ?', 'quota-owner')[0].request_count, 31);
  f.advance(60000);
  assert.equal((await f.call('/api/privacy/status', { headers: session.headers })).status, 200);
  assert.equal(f.db.rows('SELECT request_count FROM game_rate_limits WHERE user_id = ?', 'quota-owner')[0].request_count, 1);
});

test('configured OAuth credentials and requested open registration still cannot collect new sign-ins', async t => {
  const f = fixture(t);
  for (const provider of ['GOOGLE', 'KAKAO', 'NAVER']) {
    f.env[`HARU_${provider}_CLIENT_ID`] = `fixture-${provider}-client`;
    f.env[`HARU_${provider}_CLIENT_SECRET`] = `fixture-${provider}-secret`;
  }
  f.env.HARU_KAKAO_OIDC_ENABLED = 'true';
  const status = await (await f.call('/api/auth/status')).json();
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.guardianReady, false);
  assert.equal(status.registration.minimumSignupAge, 14);
  assert.equal(status.registration.under14EnrollmentOpen, false);
  assert.equal(status.registration.ageVerificationReady, false);
  assert.equal(status.sites.enabled, false);
  assert.ok(status.providers.every(provider => !provider.enabled && provider.reason === 'admission_not_ready'));
  for (const provider of ['google', 'kakao', 'naver']) {
    for (const intent of ['login', 'link']) {
      await expectCode(await f.call(`/api/auth/${provider}/start`, { method: 'POST', body: { intent } }), 503, 'AUTH_NOT_CONFIGURED');
    }
    const response = await f.call(`/api/auth/${provider}/callback?state=${'a'.repeat(43)}&code=fixture-code`, {
      headers: { Cookie: `${AUTH_COOKIES.flow}=${'b'.repeat(43)}`, 'Sec-Fetch-Site': 'cross-site' },
    });
    await expectCode(response, 503, 'AUTH_NOT_CONFIGURED');
    assert.equal(response.headers.getSetCookie().length, 0);
  }
  for (const table of ['auth_accounts', 'auth_identities', 'auth_sessions', 'auth_oauth_transactions', 'auth_rate_limits', 'guardian_requests']) {
    assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table}`)[0].count, 0, table);
  }
});


test('configured legacy guardian keys and client claims cannot reopen child enrollment or alter existing family data', async t => {
  const f = fixture(t);
  Object.assign(f.env, {
    HARU_GUARDIAN_ATTESTATION_PUBLIC_KEY: '-----BEGIN PUBLIC KEY-----\nlegacy-key-placeholder\n-----END PUBLIC KEY-----',
    HARU_GUARDIAN_ATTESTATION_ISSUER: 'https://legacy-guardian.example.test',
    HARU_GUARDIAN_ATTESTATION_AUDIENCE: 'legacy-haru', HARU_GUARDIAN_POLICY_VERSION: 'legacy-policy',
    HARU_REGISTRATION_OPEN: 'true', HARU_GUARDIAN_READY: 'true', HARU_MINIMUM_SIGNUP_AGE: '0',
  });
  const guardian = f.session('existing-family-guardian');
  f.family('existing-family-guardian', 'existing-family-child');
  const requestId = f.guardianRequest('existing-family-guardian');
  const context = await f.context(guardian);
  const tables = ['auth_accounts', 'privacy_account_controls', 'guardian_requests', 'guardian_consents', 'guardian_links'];
  const before = tables.map(table => f.db.rows(`SELECT * FROM ${table}`));
  for (const [action, body] of [
    ['create', {}], ['rotate', { requestId }],
    ['approve', { requestId, requestToken: 'old-request-token', attestation: 'claimed-age-and-guardian-proof' }],
  ]) {
    await expectCode(await f.post(action, guardian, context, body, 'guardian'), 403, 'CHILD_ENROLLMENT_CLOSED');
  }
  assert.deepEqual(tables.map(table => f.db.rows(`SELECT * FROM ${table}`)), before);
  assert.equal((await f.list('/api/privacy/children', guardian, context)).status, 200);
  assert.equal((await f.post('export', guardian, context, { childAccountId: 'existing-family-child' })).status, 200);
  assert.equal((await f.post('withdraw', guardian, context, { childAccountId: 'existing-family-child', confirmation: 'withdraw' })).status, 200);
  assert.equal((await f.post('delete', guardian, context, { childAccountId: 'existing-family-child', confirmation: 'delete' })).status, 200);
});
