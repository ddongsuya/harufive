import './runtime.mjs';
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSQLiteD1 } from './lib/sqlite-d1.mjs';
import { createGuardianService } from '../server/guardian-service.mjs';
import { createAccountLifecycle } from '../server/account-lifecycle.mjs';

/** One local maintenance pass. Deployments must separately wire a monitored
 * scheduler; running this command does not establish recurring execution.
 * Account purging is disabled unless a reviewed local policy file is supplied.
 */
export async function runPrivacyMaintenance({ db, now = Date.now, purgePolicy, limit = 25 }) {
  const expired = await createGuardianService({ db, now }).purgeExpired();
  const deletions = await createAccountLifecycle({ db, now, purgePolicy }).processDeletionJobs({ limit });
  return { expired, deletions };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 0 && (args.length !== 2 || args[0] !== '--policy')) throw new Error('invalid_arguments');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const filename = path.join(project, '.local', 'haru-five.sqlite');
  if (!existsSync(filename) || !statSync(filename).isFile()) throw new Error('local_database_missing');
  const relative = path.relative(realpathSync(project), realpathSync(filename));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('local_database_outside_project');
  let purgePolicy;
  if (args.length) {
    const policyPath = path.resolve(args[1]);
    if (!statSync(policyPath).isFile() || statSync(policyPath).size > 16384) throw new Error('invalid_policy_file');
    purgePolicy = JSON.parse(readFileSync(policyPath, 'utf8'));
  }
  const db = createSQLiteD1({ filename });
  try {
    const result = await runPrivacyMaintenance({ db, purgePolicy });
    console.log(JSON.stringify({
      environment: 'local', scheduled: false, ...result,
      note: '운영 예약 실행·백업 삭제 완료를 의미하지 않습니다.',
    }));
  } finally { db.close(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('로컬 개인정보 정리를 완료하지 못했습니다. 기존 로컬 DB와 정책 파일 형식을 확인해 주세요.');
    process.exitCode = 1;
  });
}
