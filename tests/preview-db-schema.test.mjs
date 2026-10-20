import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { preparePreviewSchema } from '../scripts/preview-db-schema.mjs';

test('preview bootstrap preserves the migrated schema, remains empty, and records six migrations', () => {
  const files = preparePreviewSchema();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec('PRAGMA foreign_keys = ON;');
    db.exec('CREATE TABLE _cf_METADATA (key INTEGER PRIMARY KEY, value BLOB);');
    db.exec("INSERT INTO _cf_METADATA VALUES (1, x'01');");
    db.exec(files.setupSql);
    for (const object of files.objects) {
      assert.equal(db.prepare('SELECT sql FROM sqlite_schema WHERE type = ? AND name = ?')
        .get(object.type, object.name).sql, object.sql);
      if (object.type === 'table') {
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM "${object.name}"`).get().n, 0);
      }
    }
    assert.equal(files.objects.filter(object => object.type === 'table').length, 18);
    assert.deepEqual(db.prepare('SELECT name FROM d1_migrations ORDER BY name').all().map(row => row.name),
      files.sourceHashes.map(row => row.name));
    assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(), []);
    db.exec(files.verifySql);
    assert.throws(() => db.exec(files.recordSql), /UNIQUE/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, 6);
    assert.doesNotMatch(files.initialSql, /^\s*(?:DROP|ALTER|DELETE|UPDATE|INSERT|BEGIN|COMMIT)\b/im);
  } finally { db.close(); }
});

test('missing index cannot be recorded as an applied baseline', () => {
  const files = preparePreviewSchema();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(files.initialSql);
    db.exec(`DROP INDEX "${files.objects.find(object => object.type === 'index').name}"`);
    assert.throws(() => db.exec(files.recordSql), /NOT NULL/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, 0);
  } finally { db.close(); }
});

test('existing data is preserved and rejects initialization and baseline recording', () => {
  const files = preparePreviewSchema();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(files.initialSql);
    db.exec("INSERT INTO auth_accounts(id, created_at) VALUES ('fixture-existing', 1)");
    assert.throws(() => db.exec(files.initialSql), /already exists/);
    assert.throws(() => db.exec(files.recordSql), /NOT NULL/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM auth_accounts').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, 0);
  } finally { db.close(); }
});

test('unexpected tables cannot be hidden as a valid new database', () => {
  const files = preparePreviewSchema();
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(files.initialSql);
    db.exec('CREATE TABLE unrelated_data (id TEXT PRIMARY KEY);');
    assert.throws(() => db.exec(files.recordSql), /NOT NULL/);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM d1_migrations').get().n, 0);
  } finally { db.close(); }
});
