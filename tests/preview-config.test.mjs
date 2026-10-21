import test from 'node:test';
import assert from 'node:assert/strict';
import { timingSafeEqual } from 'node:crypto';
import connected from '../server/connected-preview-worker.mjs';
import preview from '../server/preview-worker.mjs';
import worker from '../server/worker.mjs';

const ORIGIN = 'https://preview-config.example';
const PASSWORD = Buffer.alloc(32, 0x71).toString('base64url');
const BASIC = `Basic ${Buffer.from(`harufive:${PASSWORD}`).toString('base64')}`;
const endpoint = `${ORIGIN}/api/preview/config`;
function fixture(t) {
  const prior = Object.getOwnPropertyDescriptor(crypto.subtle, 'timingSafeEqual');
  Object.defineProperty(crypto.subtle, 'timingSafeEqual', {
    configurable: true, value: (a, b) => timingSafeEqual(Buffer.from(a), Buffer.from(b)),
  });
  t.after(() => {
    if (prior) Object.defineProperty(crypto.subtle, 'timingSafeEqual', prior);
    else delete crypto.subtle.timingSafeEqual;
  });
  const env = { HARU_AUTH_ORIGIN: ORIGIN, HARU_PREVIEW_PASSWORD: PASSWORD };
  for (const key of ['DB', 'CLOUDFLARE_API_TOKEN', 'HARU_REGISTRATION_OPEN']) {
    Object.defineProperty(env, key, { get() { assert.fail(`Diagnostic must not read ${key}`); } });
  }
  return env;
}

test('preview configuration requires the exact origin and password before inspecting settings', async t => {
  const env = fixture(t);
  Object.defineProperty(env, 'HARU_GOOGLE_CLIENT_ID', { get() { assert.fail('unauthenticated credential read'); } });
  for (const [url, authorization, expected] of [
    [endpoint, undefined, 401], [endpoint, 'Basic aW52YWxpZA==', 401],
    ['https://other.example/api/preview/config', BASIC, 403],
  ]) {
    const response = await connected.fetch(new Request(url, {
      headers: authorization ? { Authorization: authorization } : {},
    }), env);
    assert.equal(response.status, expected);
    assert.match(response.headers.get('Cache-Control'), /no-store/);
    if (expected === 401) assert.match(response.headers.get('WWW-Authenticate'), /^Basic /);
  }
});

test('configuration diagnostics expose fixed classifications without values or database access', async t => {
  const env = fixture(t);
  env.HARU_GOOGLE_CLIENT_ID = 'synthetic-google-id';
  env.HARU_GOOGLE_CLIENT_SECRET = 'synthetic-google-secret';
  env.HARU_KAKAO_CLIENT_ID = { private: 'must-not-appear' };
  env.HARU_KAKAO_CLIENT_SECRET = 'line\nbreak';
  env.HARU_NAVER_CLIENT_ID = ' '.repeat(3);
  env.HARU_NAVER_CLIENT_SECRET = 'x'.repeat(2049);
  const response = await connected.fetch(new Request(endpoint, { headers: { Authorization: BASIC } }), env);
  assert.equal(response.status, 200);
  assert.match(response.headers.get('Cache-Control'), /private, no-store/);
  assert.match(response.headers.get('X-Robots-Tag'), /noindex/);
  assert.match(response.headers.get('Vary'), /Authorization/);
  assert.equal(response.headers.get('WWW-Authenticate'), null);
  const report = await response.json();
  assert.deepEqual(report, {
    format: 'harufive-preview-config-v1',
    providers: {
      google: { clientId: 'present', clientSecret: 'present' },
      kakao: { clientId: 'not_text', clientSecret: 'invalid_characters' },
      naver: { clientId: 'empty', clientSecret: 'too_long' },
    },
  });
  const serialized = JSON.stringify(report);
  for (const value of [PASSWORD, env.HARU_GOOGLE_CLIENT_ID, env.HARU_GOOGLE_CLIENT_SECRET, 'must-not-appear']) {
    assert.ok(!serialized.includes(value));
  }
});

test('diagnostics distinguish missing settings and reject writes without reading credentials', async t => {
  const env = fixture(t);
  const response = await connected.fetch(new Request(endpoint, { headers: { Authorization: BASIC } }), env);
  for (const item of Object.values((await response.json()).providers)) {
    assert.deepEqual(item, { clientId: 'missing', clientSecret: 'missing' });
  }
  Object.defineProperty(env, 'HARU_GOOGLE_CLIENT_SECRET', { get() { assert.fail('write inspected a credential'); } });
  const denied = await connected.fetch(new Request(endpoint, { method: 'POST', headers: { Authorization: BASIC } }), env);
  assert.equal(denied.status, 405);
  assert.equal(denied.headers.get('Allow'), 'GET');
});

test('ordinary preview and standalone entries do not expose configuration diagnostics', async t => {
  fixture(t);
  const env = { HARU_AUTH_ORIGIN: ORIGIN, HARU_PREVIEW_PASSWORD: PASSWORD };
  Object.defineProperty(env, 'HARU_GOOGLE_CLIENT_ID', { get() { assert.fail('ordinary entry inspected settings'); } });
  for (const adapter of [preview, worker]) {
    const response = await adapter.fetch(new Request(endpoint, { headers: { Authorization: BASIC } }), env);
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, 'NOT_FOUND');
  }
});
