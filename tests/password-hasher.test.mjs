import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { scryptSync } from 'node:crypto';
import { hashPassword, verifyPassword, PasswordHasher } from '../server/password-hasher.mjs';
import { createPasswordService, clientAddressHash } from '../server/password-client.mjs';

test('scrypt uses independent salts and exact password bytes, including spaces and Unicode', () => {
  const password = '  비밀번호 test  ';
  const first = hashPassword(password), second = hashPassword(password);
  assert.match(first, /^scrypt-v1\$65536\$8\$2\$[a-f0-9]{32}\$[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(verifyPassword(password, first), true);
  assert.equal(verifyPassword(password.trim(), first), false);
  assert.equal(verifyPassword('a different long password', first), false);
  for (const malformed of [first.replace('$65536$', '$1048576$'), first.toUpperCase(), first + 'x', null]) {
    assert.equal(verifyPassword(password, malformed), false);
  }
  assert.throws(() => hashPassword('x'.repeat(7)));
  assert.throws(() => hashPassword('x'.repeat(17)));
  assert.throws(() => hashPassword('x'.repeat(129)));
});

function earlierPasswordHash(password) {
  const salt = Buffer.alloc(16, 0x42);
  const hash = scryptSync(password, salt, 32, { N: 65536, r: 8, p: 2, maxmem: 80 * 1024 * 1024 });
  return `scrypt-v1$65536$8$2$${salt.toString('hex')}$${hash.toString('hex')}`;
}

test('new hashes accept 8 and 16 characters while old 128-character hashes still verify', () => {
  for (const password of [' '.repeat(8), 'x'.repeat(16)]) {
    assert.equal(verifyPassword(password, hashPassword(password)), true);
  }
  const earlierPassword = 'x'.repeat(128), encodedHash = earlierPasswordHash(earlierPassword);
  assert.equal(verifyPassword(earlierPassword, encodedHash), true);
  assert.equal(verifyPassword('x'.repeat(7), encodedHash), false);
  assert.equal(verifyPassword('x'.repeat(129), encodedHash), false);
  assert.throws(() => hashPassword(earlierPassword));
});

function sqlFixture(t) {
  const db = new DatabaseSync(':memory:');
  t.after(() => db.close());
  return { db, state: { storage: { sql: { exec(sql, ...args) {
    const statement = db.prepare(sql);
    if (statement.columns().length) return statement.all(...args);
    statement.run(...args); return [];
  } } } } };
}

test('Durable Object accepts only bounded requests and persists budgets across instance restarts', async t => {
  const { db, state } = sqlFixture(t);
  const object = new PasswordHasher(state);
  const send = data => object.fetch(new Request('https://hasher.internal/', {
    method: 'POST', body: JSON.stringify(data),
  }));
  assert.equal((await object.fetch(new Request('https://hasher.internal/'))).status, 405);
  assert.equal((await send({ action: 'hash', password: 'short' })).status, 400);
  assert.equal((await send({ action: 'hash', password: 'x'.repeat(7) })).status, 400);
  assert.equal((await send({ action: 'hash', password: 'x'.repeat(17) })).status, 400);
  assert.equal((await send({ action: 'hash', password: 'x'.repeat(4097) })).status, 413);
  assert.equal((await send({ action: 'verify', password: 'long test password', encodedHash: 'unknown' })).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM hash_budget').get().n, 0);
  const now = Date.now();
  for (let i = 0; i < 60; i++) assert.equal(object.takeBudget(now), true);
  assert.equal(new PasswordHasher(state).takeBudget(now), false);
  assert.equal(object.takeBudget(now + 60_000), true);
  db.prepare("UPDATE hash_budget SET count=5000 WHERE kind='day'").run();
  assert.equal(object.takeBudget(now + 120_000), false);
  assert.equal(object.takeBudget(now + 86_400_000), true);
  assert.deepEqual(db.prepare('PRAGMA table_info(hash_budget)').all().map(row => row.name), ['kind', 'period', 'count']);
});

test('Durable Object applies the new hash limit without restricting legacy verification', async t => {
  const { state } = sqlFixture(t), object = new PasswordHasher(state);
  const send = data => object.fetch(new Request('https://hasher.internal/', { method: 'POST', body: JSON.stringify(data) }));
  for (const password of ['x'.repeat(8), ' '.repeat(16)]) {
    const response = await send({ action: 'hash', password });
    assert.equal(response.status, 200);
    assert.equal(verifyPassword(password, (await response.json()).result), true);
  }
  const password = 'legacy password '.repeat(8), encodedHash = earlierPasswordHash(password);
  assert.equal(password.length, 128);
  assert.equal((await send({ action: 'hash', password })).status, 400);
  const verified = await send({ action: 'verify', password, encodedHash });
  assert.equal(verified.status, 200);
  assert.deepEqual(await verified.json(), { result: true });
});

test('password binding client validates responses and never falls back to hashing in the Worker', async () => {
  assert.equal(createPasswordService({}), null);
  const requests = [];
  const encodedHash = `scrypt-v1$65536$8$2$${'0'.repeat(32)}$${'0'.repeat(64)}`;
  const namespace = { idFromName(name) { assert.equal(name, 'harufive-password-budget-v1'); return 'fixed'; },
    get(id) { assert.equal(id, 'fixed'); return { async fetch(request) {
      const data = await request.json(); requests.push(data);
      return Response.json({ result: data.action === 'hash' ? encodedHash : true });
    } }; } };
  const service = createPasswordService(namespace);
  assert.equal(await service.hash('fixture pass2026'), encodedHash);
  assert.equal(await service.verify('fixture password only', encodedHash), true);
  assert.equal(requests.length, 2);
  const failed = createPasswordService({ ...namespace, get() { return { fetch: async () => new Response(null, { status: 429 }) }; } });
  await assert.rejects(failed.hash('fixture pass2026'), /PASSWORD_SERVICE_UNAVAILABLE/);
  const invalid = createPasswordService({ ...namespace, get() { return { fetch: async () => Response.json({ result: 'bad hash' }) }; } });
  await assert.rejects(invalid.hash('fixture pass2026'), /PASSWORD_SERVICE_UNAVAILABLE/);
});

test('client rate key needs a bounded Cloudflare edge address and does not return the IP', async () => {
  const request = address => new Request('https://local.invalid/', { headers: address ? { 'CF-Connecting-IP': address } : {} });
  assert.equal(await clientAddressHash(request()), null);
  assert.equal(await clientAddressHash(request('untrusted text')), null);
  const first = await clientAddressHash(request('192.0.2.1'));
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, await clientAddressHash(request('192.0.2.1')));
  assert.notEqual(first, await clientAddressHash(request('192.0.2.2')));
});
