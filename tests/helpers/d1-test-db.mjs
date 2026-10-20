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
  sqlite.exec('PRAGMA foreign_keys = ON');
  const directory = migrations instanceof URL ? fileURLToPath(migrations) : migrations;
  const files = readdirSync(directory).filter(file => file.endsWith('.sql')).sort();
  if (!files.length) throw new Error('Generate the actual database migration with npm run db:generate before running server tests.');
  for (const filename of files) sqlite.exec(readFileSync(path.join(directory, filename), 'utf8'));

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
