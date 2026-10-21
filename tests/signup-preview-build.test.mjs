import assert from 'node:assert/strict';
import test from 'node:test';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { buildPreviewWorker, SIGNUP_PREVIEW_CONFIG, validatePreviewConfig, PREVIEW_ORIGIN } from '../scripts/preview-worker.mjs';
import { createSQLiteD1 } from './helpers/d1-test-db.mjs';

test('signup bundle enables only Google and local behind the preview gate and requires its hash binding', async t => {
  validatePreviewConfig(structuredClone(SIGNUP_PREVIEW_CONFIG), { connected: true, signup: true });
  assert.throws(() => validatePreviewConfig(SIGNUP_PREVIEW_CONFIG, { connected: true }));
  assert.throws(() => validatePreviewConfig(SIGNUP_PREVIEW_CONFIG, { connected: true, signup: true, owner: true }));
  assert.equal(SIGNUP_PREVIEW_CONFIG.limits, undefined, 'Use platform defaults: DO 30sec, Free HTTP Worker 10ms');
  const result = await buildPreviewWorker({ connected: true, signup: true });
  const module = await import(`${pathToFileURL(result.output).href}?signup-test=${result.sha256}`);
  assert.deepEqual(Object.keys(module), ['PasswordHasher', 'default']);
  const previous = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', { configurable: true,
    value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)) });
  t.after(() => previous ? Object.defineProperty(crypto.subtle, 'timingSafeEqual', previous) : delete crypto.subtle.timingSafeEqual);
  const db = createSQLiteD1(); t.after(() => db.close());
  const password = Buffer.alloc(32, 0x6e).toString('base64url');
  const authorization = `Basic ${Buffer.from(`harufive:${password}`).toString('base64')}`;
  let reads = 0;
  const env = { HARU_PREVIEW_PASSWORD: password,
    get DB() { reads++; return db; },
    HARU_GOOGLE_CLIENT_ID: 'signup-fixture-client', HARU_GOOGLE_CLIENT_SECRET: 'signup-fixture-secret',
    get PASSWORD_HASHER() { reads++; return { idFromName: () => 'id', get() { assert.fail('Status must not perform password hashing'); } }; },
  };
  for (const key of ['HARU_KAKAO_CLIENT_ID', 'HARU_KAKAO_CLIENT_SECRET', 'HARU_KAKAO_OIDC_ENABLED',
    'HARU_NAVER_CLIENT_ID', 'HARU_NAVER_CLIENT_SECRET', 'HARU_REGISTRATION_OPEN']) {
    Object.defineProperty(env, key, { get() { assert.fail(`Signup entry must not read ${key}`); } });
  }
  const call = (route, init = {}) => module.default.fetch(new Request(PREVIEW_ORIGIN + route, init), env);
  assert.equal((await call('/api/auth/status')).status, 401);
  assert.equal(reads, 0);
  const headers = { Authorization: authorization, 'CF-Connecting-IP': '192.0.2.50' };
  const response = await call('/api/auth/status', { headers });
  assert.equal(response.status, 200);
  const status = await response.json();
  assert.equal(status.providers.find(provider => provider.id === 'google').enabled, true);
  assert.equal(status.providers.find(provider => provider.id === 'kakao').enabled, false);
  assert.equal(status.providers.find(provider => provider.id === 'naver').enabled, false);
  assert.equal(status.localAuth.enabled, true);
  assert.equal(status.localAuth.registrationOpen, true);
  assert.equal(status.registration.previewOpen, true);
  assert.equal(status.registration.open, false);
  assert.equal(status.registration.ageVerificationReady, false);
  assert.doesNotMatch(JSON.stringify(status), /signup-fixture-secret|192\.0\.2/);
  const noAddress = await (await call('/api/auth/status', { headers: { authorization } })).json();
  assert.equal(noAddress.localAuth.enabled, false);
  for (const provider of ['kakao', 'naver']) {
    const start = await call(`/api/auth/${provider}/start`, { method: 'POST',
      headers: { ...headers, Origin: PREVIEW_ORIGIN, 'Content-Type': 'application/json' }, body: '{"intent":"login"}' });
    assert.equal(start.ok, false);
  }
  const asset = await call('/game/auth.js', { headers });
  assert.equal(asset.status, 200);
  assert.doesNotMatch(await asset.text(), /signup-fixture-secret|scrypt-v1\$|65536/);
});
