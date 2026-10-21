import './runtime.mjs';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createSQLiteD1 } from './lib/sqlite-d1.mjs';

export function openLocalDatabase() {
  const directory = fileURLToPath(new URL('../.local/', import.meta.url));
  mkdirSync(directory, { recursive: true });
  return createSQLiteD1({ filename: path.join(directory, 'haru-five.sqlite') });
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const db = openLocalDatabase();
  db.close();
  console.log('로컬 DB 준비 완료: .local/haru-five.sqlite (운영 DB 연결 없음)');
}
