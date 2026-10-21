import './runtime.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSQLiteD1 } from './lib/sqlite-d1.mjs';

const quote = value => `'${value.replaceAll("'", "''")}'`;
const identifier = value => `"${value.replaceAll('"', '""')}"`;

// Offline preparation only. This does not read credentials or contact Cloudflare.
export function preparePreviewSchema() {
  const db = createSQLiteD1();
  try {
    const objects = db.rows(`SELECT type, name, sql FROM sqlite_schema
      WHERE type IN ('table', 'index') AND sql IS NOT NULL
      AND name NOT LIKE 'sqlite_%' AND name != 'local_schema_migrations'
      ORDER BY type DESC, name`);
    const tables = objects.filter(object => object.type === 'table');
    const ordered = [];
    const pending = [...tables];
    while (pending.length) {
      const index = pending.findIndex(table =>
        db.rows(`PRAGMA foreign_key_list(${identifier(table.name)})`)
          .every(fk => fk.table === table.name || ordered.some(parent => parent.name === fk.table)));
      if (index < 0) throw new Error('Cannot order schema dependencies.');
      ordered.push(...pending.splice(index, 1));
    }
    const definitions = [...ordered, ...objects.filter(object => object.type === 'index')];
    const migrations = readdirSync(new URL('../drizzle/', import.meta.url))
      .filter(name => name.endsWith('.sql')).sort();
    const initialSql = [
      '-- NEW EMPTY harufive-preview-db ONLY. Run once in D1 Console.',
      '-- No users or game records are created. Stop on any error; do not rerun blindly.',
      ...definitions.map(object => `${object.sql};`),
      // Same columns and constraints as Wrangler 4.92.0's migration ledger.
      'CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT UNIQUE, applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL);',
    ].join('\n\n') + '\n';
    const expected = objects.map(object =>
      `(${quote(object.type)}, ${quote(object.name)}, ${quote(object.sql)})`).join(',\n');
    // An incomplete/different schema or any application data makes applied_at NULL,
    // so the NOT NULL constraint rejects the entire INSERT (all six ledger rows).
    const recordSql = `-- Run only after initial-schema.sql succeeds.
-- Exact schema and empty application tables are checked before recording the baseline.
WITH expected(type, name, sql) AS (VALUES
${expected}
),
valid_schema(ok) AS (
  SELECT
    (SELECT COUNT(*) FROM expected e JOIN sqlite_schema s
      ON e.type = s.type AND e.name = s.name AND e.sql = s.sql) = ${objects.length}
    AND NOT EXISTS (
      SELECT 1 FROM sqlite_schema s WHERE s.type IN ('table', 'index')
      AND s.sql IS NOT NULL AND s.name NOT LIKE 'sqlite_%'
      AND s.name NOT IN ('d1_migrations', '_cf_KV', '_cf_METADATA')
      AND NOT EXISTS (SELECT 1 FROM expected e WHERE e.type = s.type AND e.name = s.name)
    )
    AND ${tables.map(table => `NOT EXISTS (SELECT 1 FROM ${identifier(table.name)})`).join('\n    AND ')}
),
versions(name) AS (VALUES ${migrations.map(name => `(${quote(name)})`).join(', ')})
INSERT INTO d1_migrations(name, applied_at)
SELECT name, CASE WHEN (SELECT ok FROM valid_schema) THEN CURRENT_TIMESTAMP ELSE NULL END
FROM versions;
`;
    const verifySql = `-- Read-only checks after both setup files succeed.
SELECT COUNT(*) AS app_tables FROM sqlite_schema WHERE type = 'table'
AND name IN (${tables.map(table => quote(table.name)).join(', ')});
SELECT name FROM d1_migrations ORDER BY name;
SELECT
${tables.map(table => `  (SELECT COUNT(*) FROM ${identifier(table.name)}) AS ${identifier(table.name)}`).join(',\n')};
PRAGMA foreign_key_check;
WITH counts AS (
  SELECT
    (SELECT COUNT(*) FROM sqlite_schema WHERE type = 'table'
      AND name IN (${tables.map(table => quote(table.name)).join(', ')})) AS app_tables,
    (SELECT COUNT(*) FROM d1_migrations) AS migration_entries,
    ${tables.map(table => `(SELECT COUNT(*) FROM ${identifier(table.name)})`).join(' + ')} AS saved_rows
)
SELECT CASE WHEN app_tables = ${tables.length} AND migration_entries = ${migrations.length}
  AND saved_rows = 0 THEN 'HARUFIVE_SCHEMA_READY' ELSE 'CHECK_REQUIRED' END AS status,
  app_tables, migration_entries, saved_rows FROM counts;
`;
    const sourceHashes = migrations.map(name => ({
      name,
      sha256: createHash('sha256').update(readFileSync(new URL(`../drizzle/${name}`, import.meta.url), 'utf8').replaceAll('\r\n', '\n')).digest('hex'),
    }));
    const setupSql = [initialSql, recordSql, verifySql].join('\n');
    return { initialSql, recordSql, verifySql, setupSql, objects, sourceHashes };
  } finally {
    db.close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 2) throw new Error('No arguments accepted; offline file preparation only.');
  const result = preparePreviewSchema();
  const directory = new URL('../.local/connected-preview/', import.meta.url);
  mkdirSync(directory, { recursive: true });
  const outputs = [
    ['initial-schema.sql', result.initialSql],
    ['record-migrations.sql', result.recordSql],
    ['verify-schema.sql', result.verifySql],
    ['setup-database.sql', result.setupSql],
  ];
  for (const [name, content] of outputs) writeFileSync(new URL(name, directory), content, 'utf8');
  writeFileSync(new URL('schema-manifest.json', directory), JSON.stringify({
    sourceMigrations: result.sourceHashes,
    applicationTables: result.objects.filter(object => object.type === 'table').length,
    outputs: outputs.map(([name, content]) => ({
      name, bytes: Buffer.byteLength(content), sha256: createHash('sha256').update(content).digest('hex'),
    })),
  }, null, 2) + '\n');
  console.log('Prepared new empty preview DB schema files locally. No remote changes.');
}
