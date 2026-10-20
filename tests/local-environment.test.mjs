import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createSQLiteD1 } from '../scripts/lib/sqlite-d1.mjs';
import { createLocalServer } from '../scripts/local-server.mjs';

function directory(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'haru-local-test-'));
  t.after(() => {
    if (path.dirname(path.resolve(folder)) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('haru-local-test-')) throw new Error('Unexpected cleanup path');
    rmSync(folder, { recursive: true, force: true });
  }); return folder;
}
test('persistent local database applies migrations once and keeps existing records across restart', async t => {
  const filename = path.join(directory(t), 'test.sqlite');
  let db = createSQLiteD1({ filename });
  db.sqlite.prepare('INSERT INTO auth_accounts (id, created_at) VALUES (?, ?)').run('fixture-only', 1);
  db.close(); db = createSQLiteD1({ filename });
  try {
    assert.equal(db.rows('SELECT * FROM auth_accounts').length, 1);
    assert.equal(db.rows('SELECT * FROM local_schema_migrations').length, 6);
    assert.deepEqual(db.rows("SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN ('guardian_requests','guardian_consents','guardian_links','privacy_account_controls','privacy_deletion_jobs') ORDER BY name").map(row => row.name),
      ['guardian_consents', 'guardian_links', 'guardian_requests', 'privacy_account_controls', 'privacy_deletion_jobs']);
  } finally { db.close(); }
});

test('upgrading existing sessions preserves gameplay credentials without inventing recent authentication', t => {
  const folder = directory(t), migrations = path.join(folder, 'migrations'), filename = path.join(folder, 'upgrade.sqlite');
  mkdirSync(migrations);
  const source = new URL('../drizzle/', import.meta.url);
  const files = readdirSync(source).filter(name => name.endsWith('.sql')).sort();
  for (const name of files.filter(name => /^000[0-4]_/.test(name))) {
    copyFileSync(new URL(name, source), path.join(migrations, name));
  }
  let db = createSQLiteD1({ filename, migrations });
  db.sqlite.prepare('INSERT INTO auth_accounts (id, created_at) VALUES (?, ?)').run('legacy-auth', 1000);
  db.sqlite.prepare(`INSERT INTO auth_sessions (token_hash, account_id, provider, created_at, expires_at)
    VALUES (?, 'legacy-auth', 'google', 1000, 86401000)`).run('a'.repeat(64));
  db.close();
  for (const name of files) copyFileSync(new URL(name, source), path.join(migrations, name));
  db = createSQLiteD1({ filename, migrations });
  try {
    assert.deepEqual(db.rows('SELECT account_id, created_at, expires_at, revoked_at, authenticated_at FROM auth_sessions'), [{
      account_id: 'legacy-auth', created_at: 1000, expires_at: 86401000, revoked_at: null, authenticated_at: null,
    }]);
    assert.equal(db.rows("PRAGMA foreign_key_check").length, 0);
    assert.throws(() => db.sqlite.prepare('UPDATE auth_sessions SET authenticated_at=?').run(-1), /CHECK/);
    assert.throws(() => db.sqlite.prepare('UPDATE auth_sessions SET authenticated_at=?').run(1001), /CHECK/);
  } finally { db.close(); }
});

test('migration failure rolls back changes, and altered or missing history is rejected', t => {
  const folder = directory(t), migrations = path.join(folder, 'migrations'), filename = path.join(folder, 'db.sqlite');
  mkdirSync(migrations);
  writeFileSync(path.join(migrations, '0000.sql'), 'CREATE TABLE example (id INTEGER PRIMARY KEY);');
  let db = createSQLiteD1({ filename, migrations }); db.close();
  writeFileSync(path.join(migrations, '0001.sql'), 'INSERT INTO example VALUES (1); NOT SQL;');
  assert.throws(() => createSQLiteD1({ filename, migrations }));
  writeFileSync(path.join(migrations, '0001.sql'), 'INSERT INTO example VALUES (2);');
  db = createSQLiteD1({ filename, migrations }); assert.deepEqual(db.rows('SELECT id FROM example'), [{ id: 2 }]); db.close();
  writeFileSync(path.join(migrations, '0000.sql'), 'CREATE TABLE changed (id INTEGER);');
  assert.throws(() => createSQLiteD1({ filename, migrations }), /changed/);
  rmSync(path.join(migrations, '0000.sql'));
  assert.throws(() => createSQLiteD1({ filename, migrations }), /missing/);
});

test('loopback preview serves current game, rejects hostile Host, and keeps private files and login closed', async t => {
  const db = createSQLiteD1();
  const server = await createLocalServer({ db });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { const closed = once(server, 'close'); server.close(); server.closeAllConnections(); await closed; db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  assert.match(await (await fetch(origin)).text(), /하루다섯/);
  assert.match(await (await fetch(origin + '/game/app.js')).text(), /mountGame/);
  assert.equal((await fetch(origin + '/api/health')).status, 200);
  const status = await (await fetch(origin + '/api/auth/status')).json();
  assert.equal(status.registration.open, false); assert.equal(status.sites.enabled, false);
  assert.ok(status.providers.every(provider => !provider.enabled));
  for (const pathname of ['/server/game-service.mjs', '/.env.example', '/.local/haru-five.sqlite', '/legacy/v040/game-core.js', '/game/../server/game-service.mjs']) {
    assert.equal((await fetch(origin + pathname)).status, 404);
  }
  // Node fetch preserves an explicitly supplied Host on supported Node versions.
  const { request } = await import('node:http');
  const statusCode = await new Promise((resolve, reject) => {
    const req = request(origin, { headers: { Host: 'evil.example' } }, response => { response.resume(); resolve(response.statusCode); });
    req.on('error', reject); req.end();
  });
  assert.equal(statusCode, 421);
  const denied = await fetch(origin + '/api/game/bootstrap', { headers: { 'oai-authenticated-user-id': 'victim', Cookie: '__Host-haru_session=sites' } });
  assert.equal(denied.status, 401); assert.equal(db.rows('SELECT * FROM game_players').length, 0);
});
