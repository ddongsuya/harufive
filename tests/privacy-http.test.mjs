import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';
import { createGameService } from '../server/game-service.mjs';
import { handleStandaloneRequest } from '../server/standalone-http.mjs';
import { AUTH_COOKIES } from '../server/auth-service.mjs';
import { PRIVACY_LIMITS } from '../server/privacy-http.mjs';

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
    session(accountId, { createdAt = clock, expiresAt = clock + 86400000 } = {}) {
      f.account(accountId);
      const token = Buffer.alloc(32, ++serial).toString('base64url');
      db.sqlite.prepare(`INSERT INTO auth_sessions
        (token_hash, account_id, provider, created_at, expires_at, binding_hash)
        VALUES (?, ?, 'google', ?, ?, ?)`).run(hash(token), accountId, createdAt, expiresAt, `secret-binding-${accountId}`);
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
    await expectCode(await f.call('/api/privacy/export', { method: 'POST', body: {}, headers }), 401, 'SIGN_IN_REQUIRED');
    await expectCode(await f.call('/api/guardian/requests', { headers }), 401, 'SIGN_IN_REQUIRED');
  }
  for (const table of ['auth_accounts', 'game_players', 'game_rate_limits', 'guardian_requests', 'privacy_deletion_jobs']) {
    assert.equal(f.db.rows(`SELECT COUNT(*) AS count FROM ${table}`)[0].count, 0, table);
  }
});

test('expired and fifteen-minute-old sessions cannot use privacy rights', async t => {
  const f = fixture(t);
  const expired = f.session('expired', { createdAt: START - 60000, expiresAt: START });
  const stale = f.session('stale', { createdAt: START - PRIVACY_LIMITS.freshSessionMs });
  const future = f.session('future', { createdAt: START + 1 });
  for (const [session, code] of [[expired, 'SIGN_IN_REQUIRED'], [stale, 'REAUTH_REQUIRED'], [future, 'REAUTH_REQUIRED']]) {
    await expectCode(await f.call('/api/privacy/status', { headers: session.headers }), 401, code);
    await expectCode(await f.post('export', session, 'old-context'), 401, code);
  }
  assert.equal(f.db.rows('SELECT * FROM game_rate_limits').length, 0);
  const fresh = f.session('fresh', { createdAt: START - PRIVACY_LIMITS.freshSessionMs + 1000 });
  assert.equal((await f.call('/api/privacy/status', { headers: fresh.headers })).status, 200);
});

test('privacy status exposes a session context and unready enrollment without creating a player', async t => {
  const f = fixture(t);
  const session = f.session('status-account');
  const response = await f.call('/api/privacy/status', { headers: { ...session.headers, ...forgedSites } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.accountContext, /^[a-f0-9]{64}$/);
  assert.deepEqual(body.account, { state: 'active', deletion: null });
  assert.deepEqual(body.guardian, { guardianReady: false, providerConfigured: false, enrollmentOpen: false });
  assert.equal(body.selfRecoveryReady, false);
  assert.doesNotMatch(JSON.stringify(body), /status-account|secret-binding|another-account/);
  assert.ok(!JSON.stringify(body).includes(session.token));
  assert.ok(!JSON.stringify(body).includes(session.hash));
  assert.equal(f.db.rows('SELECT * FROM game_players').length, 0);
});

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

test('delete requires the exact confirmation and returns pending intake while revoking self sessions', async t => {
  const f = fixture(t);
  const session = f.session('delete-owner');
  await f.game.bootstrap('delete-owner');
  const context = await f.context(session);
  for (const confirmation of [undefined, true, 'withdraw', 'DELETE']) {
    await expectCode(await f.post('delete', session, context, { confirmation }), 400, 'CONFIRMATION_REQUIRED');
  }
  assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
  const response = await f.post('delete', session, context, { confirmation: 'delete' });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.state, 'deletion_pending');
  assert.equal(body.deletion.status, 'pending');
  assert.equal(body.deletion.awaitingPolicy, true);
  assert.equal(body.deletion.completedAt, null);
  assert.equal(f.db.rows('SELECT * FROM game_players WHERE id = ?', 'delete-owner').length, 1);
  assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, START);
  await expectCode(await f.call('/api/privacy/status', { headers: session.headers }), 401, 'SIGN_IN_REQUIRED');
});

for (const action of ['withdraw', 'delete']) {
  test(`logout after HTTP authentication prevents the queued ${action} transaction`, async t => {
    const f = fixture(t);
    const accountId = `logout-race-${action}`;
    const session = f.session(accountId);
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
    const response = await f.post(action, session, context, { confirmation: action });
    assert.equal(intervened, true, 'Logout must occur immediately before the account mutation batch');
    await expectCode(response, 403, 'RIGHTS_UNAVAILABLE');
    assert.equal(f.db.rows('SELECT state FROM privacy_account_controls WHERE account_id = ?', accountId)[0].state, 'active');
    assert.equal(f.db.rows('SELECT disabled_at FROM auth_accounts WHERE id = ?', accountId)[0].disabled_at, null);
    assert.equal(f.db.rows('SELECT * FROM privacy_deletion_jobs').length, 0);
    assert.equal(f.db.rows('SELECT revoked_at FROM auth_sessions WHERE token_hash = ?', session.hash)[0].revoked_at, START);
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

test('guardian routes list only owned requests, rotate and reject without exposing stored secrets', async t => {
  const f = fixture(t);
  const guardian = f.session('request-guardian');
  f.account('other-request-guardian');
  const requestId = f.guardianRequest('request-guardian');
  f.guardianRequest('other-request-guardian');
  const context = await f.context(guardian);
  const listed = await f.call('/api/guardian/requests', { headers: guardian.headers });
  assert.equal(listed.status, 200);
  const { requests } = await listed.json();
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, requestId);
  assert.deepEqual(Object.keys(requests[0]).sort(), ['createdAt', 'expiresAt', 'policyVersion', 'requestId', 'status']);
  await expectCode(await f.post('create', guardian, context, {}, 'guardian'), 503, 'GUARDIAN_NOT_CONFIGURED');
  const rotated = await f.post('rotate', guardian, context, { requestId }, 'guardian');
  assert.equal(rotated.status, 200);
  const rotation = await rotated.json();
  assert.match(rotation.requestToken, /^[A-Za-z0-9_-]{43}$/);
  assert.match(rotation.nonce, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(rotation.expiresAt, START + 86400000);
  await expectCode(await f.post('approve', guardian, context, {
    requestId, requestToken: rotation.requestToken, attestation: 'untrusted-proof',
  }, 'guardian'), 503, 'GUARDIAN_NOT_CONFIGURED');
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
