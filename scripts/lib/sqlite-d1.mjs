import '../runtime.mjs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

/**
 * D1's prepared-statement shape backed by real SQLite, not a SQL mock.
 * The same generated Drizzle migrations used by the deployment are applied.
 * Every batch executes inside an actual SQLite transaction; async boundaries
 * before queries allow tests to force interleavings of separate requests.
 */
export function createSQLiteD1({ filename = ':memory:', migrations = new URL('../../drizzle/', import.meta.url) } = {}) {
  const sqlite = new DatabaseSync(filename);
  try {
    sqlite.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
    const directory = migrations instanceof URL ? fileURLToPath(migrations) : migrations;
    const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
    if (!files.length) throw new Error('No local SQL migrations found.');
    sqlite.exec('BEGIN IMMEDIATE');
    sqlite.exec('CREATE TABLE IF NOT EXISTS local_schema_migrations (name TEXT PRIMARY KEY, hash TEXT NOT NULL)');
    const applied = new Map(sqlite.prepare('SELECT name, hash FROM local_schema_migrations').all().map(row => [row.name, row.hash]));
    if ([...applied.keys()].some(name => !files.includes(name))) throw new Error('An applied local migration is missing.');
    for (const name of files) {
      const sql = readFileSync(path.join(directory, name), 'utf8').replaceAll('\r\n', '\n');
      const hash = createHash('sha256').update(sql).digest('hex');
      if (applied.has(name)) {
        if (applied.get(name) !== hash) throw new Error('An applied local migration changed. Add a new migration instead.');
        continue;
      }
      sqlite.exec(sql);
      sqlite.prepare('INSERT INTO local_schema_migrations (name, hash) VALUES (?, ?)').run(name, hash);
    }
    sqlite.exec('COMMIT');
  } catch (error) {
    try { sqlite.exec('ROLLBACK'); } catch {}
    sqlite.close();
    throw error;
  }

  function execute(statement) {
    const before = sqlite.prepare('SELECT total_changes() AS count').get().count;
    const prepared = sqlite.prepare(statement.sql);
    let results = [];
    if (prepared.columns().length) results = prepared.all(...statement.values).map(row => ({ ...row }));
    else prepared.run(...statement.values);
    const after = sqlite.prepare('SELECT total_changes() AS count').get().count;
    return { success: true, meta: { changes: after - before }, results };
  }

  function prepared(sql, values = []) {
    return {
      sql, values,
      bind(...args) { return prepared(sql, args); },
      async first(column) {
        await database.beforeQuery?.({ sql, values });
        const row = execute({ sql, values }).results[0] || null;
        return column ? row?.[column] ?? null : row;
      },
      async all() {
        await database.beforeQuery?.({ sql, values });
        return execute({ sql, values });
      },
      async run() {
        await database.beforeQuery?.({ sql, values });
        return execute({ sql, values });
      },
    };
  }

  const database = {
    sqlite, beforeBatch: null, beforeQuery: null,
    prepare: prepared,
    withSession() { return database; },
    async batch(statements) {
      await database.beforeBatch?.(statements);
      sqlite.exec('BEGIN IMMEDIATE');
      try {
        const results = statements.map(execute);
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
    rows(sql, ...values) { return sqlite.prepare(sql).all(...values).map(row => ({ ...row })); },
    close() { sqlite.close(); },
  };
  return database;
}
