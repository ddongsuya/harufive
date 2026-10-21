import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameApi } from '../public/game/api.js';
import { createAuthApi } from '../public/game/auth.js';
import { createPrivacyApi } from '../public/game/privacy.js';

const MARKER = 'X-Haru-Application-Status';
const context = 'a'.repeat(64);
const privacyStatus = {
  accountContext: context, playerId: 'preview-player', account: { state: 'active', deletion: null },
  guardian: { guardianReady: false, providerConfigured: false, enrollmentOpen: false },
  selfRecoveryReady: false,
  capabilities: { selfExport: true, childManagement: true, selfClosure: false, guardianEnrollment: false },
};

const transports = {
  game: fetcher => ({ run: () => createGameApi({ fetcher }).bootstrap() }),
  auth: fetcher => {
    const api = createAuthApi({ fetcher });
    return { run: () => api.start('google', 'link'), close: () => api.destroy() };
  },
  privacy: fetchImpl => {
    const api = createPrivacyApi({ fetchImpl });
    return { run: () => api.status(), close: () => api.destroy() };
  },
};

for (const [name, transport] of Object.entries(transports)) {
  test(`${name} retains session error meaning behind the preview HTTP authentication gate`, async () => {
    for (const [status, marker, expected] of [[403, '401', 401], [403, null, 403],
      [403, '401extra', 403], [401, null, 401], [429, '401', 429], [500, '401', 500]]) {
      const client = transport(async (_path, init) => {
        assert.equal(init.credentials, 'same-origin');
        assert.equal(new Headers(init.headers).has('Authorization'), false);
        return Response.json({ code: 'SIGN_IN_REQUIRED', message: 'Sign in required.' }, {
          status, headers: marker === null ? {} : { [MARKER]: marker },
        });
      });
      try {
        await assert.rejects(client.run(), error => error.status === expected && error.code === 'SIGN_IN_REQUIRED');
      } finally { client.close?.(); }
    }
  });
}

test('an application status marker cannot turn a successful game response into a session error', async () => {
  const payload = { state: {}, today: '2026-10-21', serverNow: Date.now() };
  const api = createGameApi({ fetcher: async () => Response.json(payload, { headers: { [MARKER]: '401' } }) });
  assert.deepEqual(await api.bootstrap(), payload);
});

test('preview session and reauthentication errors invalidate privacy account and child context', async () => {
  for (const code of ['SIGN_IN_REQUIRED', 'REAUTH_REQUIRED']) {
    let calls = 0;
    const api = createPrivacyApi({ fetchImpl: async () => {
      calls++;
      if (calls === 1) return Response.json(privacyStatus);
      if (calls === 2) return Response.json({ children: [
        { childAccountId: 'child-one', label: 'child', state: 'active', deletion: null },
      ], hasMore: false });
      return Response.json({ code }, { status: 403, headers: { [MARKER]: '401' } });
    } });
    try {
      await api.status(); await api.children();
      await assert.rejects(api.exportData({ accountContext: context }), error =>
        error.status === 401 && error.code === code && error.retryable === false);
      assert.throws(() => api.childStatus({ accountContext: context, childAccountId: 'child-one' }),
        error => error.code === 'PRIVACY_NOT_READY');
      assert.equal(calls, 3, 'stale context must not issue another request');
    } finally { api.destroy(); }
  }
});

test('preview privacy parse and size failures retain the application session status', async () => {
  for (const [body, headers, code] of [
    ['{', {}, 'INVALID_PRIVACY_RESPONSE'],
    ['{}', { 'Content-Length': String(300 * 1024) }, 'PRIVACY_RESPONSE_TOO_LARGE'],
    [' '.repeat(300 * 1024), {}, 'PRIVACY_RESPONSE_TOO_LARGE'],
  ]) {
    const api = createPrivacyApi({ fetchImpl: async () => new Response(body, { status: 403,
      headers: { 'Content-Type': 'application/json', [MARKER]: '401', ...headers },
    }) });
    try { await assert.rejects(api.status(), error => error.status === 401 && error.code === code); }
    finally { api.destroy(); }
  }
});
