import './runtime.mjs';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPreviewWorker, SIGNUP_PREVIEW_CONFIG } from './preview-worker.mjs';

// Packaging only. This program never invokes a remote command or reads secrets.
export async function prepareSignupDeployment({ directory, accountId, databaseId }) {
  if (!path.isAbsolute(directory) || !/^[a-f0-9]{32}$/.test(accountId) ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(databaseId)) throw new Error('INVALID_DEPLOYMENT_TARGET');
  const project = fileURLToPath(new URL('../', import.meta.url));
  const bundle = await buildPreviewWorker({ connected: true, signup: true });
  const config = { ...SIGNUP_PREVIEW_CONFIG, main: './worker.mjs', account_id: accountId, keep_vars: true,
    d1_databases: [{ binding: 'DB', database_name: 'harufive-preview-db', database_id: databaseId, migrations_dir: './migrations' }] };
  await mkdir(path.join(directory, 'migrations'), { recursive: true });
  const migrations = (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  const baseline = migrations.slice(0, 6);
  if (migrations.length !== 7 || migrations[6] !== '0006_preview_registration.sql') throw new Error('REVIEW_NEW_MIGRATIONS');
  const files = new Map([
    ['worker.mjs', await readFile(bundle.output)],
    ['wrangler.jsonc', Buffer.from(JSON.stringify(config, null, 2) + '\n')],
    ['empty.env', Buffer.from('# No provider keys or passwords in this package.\n')],
  ]);
  for (const name of migrations) files.set(`migrations/${name}`, await readFile(new URL(`../drizzle/${name}`, import.meta.url)));
  for (const [name, content] of files) await writeFile(path.join(directory, name), content);
  const manifest = [...files].map(([name, content]) => ({ name, sha256: createHash('sha256').update(content).digest('hex') }));
  const cli = path.join(project, 'node_modules/wrangler/wrangler-dist/cli.js');
  const runner = `import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const cli = ${JSON.stringify(cli)};
const manifest = ${JSON.stringify(manifest)};
const expected = ${JSON.stringify(migrations)};
const baseline = ${JSON.stringify(baseline)};
async function run(args, capture = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: directory,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' },
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve(output) : reject(new Error('Cloudflare 명령 실패. 이 단계에서 중단했습니다.')));
  });
}
try {
  for (const file of manifest) {
    const content = await readFile(path.join(directory, file.name));
    if (createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('배포 파일이 변경됐습니다. 준비한 원본 파일을 사용해 주세요.');
  }
  await readFile(cli);
  console.log('하루다섯: 기존 시험 서버의 직접 가입·Google 로그인을 배포합니다. 카드 등록·유료 전환은 하지 않습니다.');
  console.log('1/4 Cloudflare 로그인: 브라우저가 열리면 현재 사용 중인 계정으로 허용해 주세요.');
  await run(['login']);
  console.log('2/4 기존 저장소 이력을 확인합니다.');
  const common = ['--config', 'wrangler.jsonc', '--env-file', 'empty.env'];
  const text = await run(['d1', 'execute', 'DB', '--remote', '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--json', ...common], true);
  const payload = JSON.parse(text);
  const names = payload.flatMap(item => item.results || []).map(item => item.name).sort();
  if (JSON.stringify(names) !== JSON.stringify(baseline) && JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error('기존 저장소의 이력이 예상과 다릅니다. 데이터를 변경하지 않고 중단했습니다.');
  }
  console.log('3/4 기존 기록을 보존하면서 가입용 저장 항목을 추가합니다.');
  await run(['d1', 'migrations', 'apply', 'DB', '--remote', ...common]);
  // Wrangler returns exit code 0 when the operator declines the migration.
  // Re-read the ledger so a cancelled apply cannot deploy incompatible code.
  const afterText = await run(['d1', 'execute', 'DB', '--remote', '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--json', ...common], true);
  const afterPayload = JSON.parse(afterText);
  const afterNames = afterPayload.flatMap(item => item.results || []).map(item => item.name).sort();
  if (JSON.stringify(afterNames) !== JSON.stringify(expected)) {
    throw new Error('가입용 저장소 변경이 완료되지 않았습니다. 서버 배포를 중단했습니다.');
  }
  console.log('4/4 기존 서버와 무료 비밀번호 처리 구성요소를 배포합니다.');
  await run(['deploy', '--keep-vars', ...common]);
  console.log('배포 명령 완료. 일반 Chrome에서 https://harufive-preview.limjm900202.workers.dev/ 를 새로고침하고 회원가입을 확인해 주세요.');
} catch (error) {
  console.error(error?.code === 'ENOENT' ? '개발 폴더의 Node/Wrangler 파일을 찾지 못했습니다. 이 배포 파일은 현재 개발 PC용입니다.' : error.message);
  process.exitCode = 1;
}
`;
  await writeFile(path.join(directory, 'deploy.mjs'), runner);
  await writeFile(path.join(directory, '배포하기.cmd'), '@echo off\r\nchcp 65001 >nul\r\nnode "%~dp0deploy.mjs"\r\npause\r\n');
  await writeFile(path.join(directory, 'README.txt'), `하루다섯 직접 회원가입 + Google 시험 배포\n\n현재 개발 PC에서 '배포하기.cmd'를 두 번 클릭하세요.\n열리는 Cloudflare 로그인 화면에서 기존 계정으로 로그인하고 허용하세요.\n저장소 변경 확인이 뜨면 적용할 신규 파일은 0006_preview_registration.sql 하나입니다.\n현재 서버를 대시보드에서 수정했다는 덮어쓰기 확인이 뜨면 기존 harufive-preview를 업데이트하는 것이 맞습니다.\n\nworker.mjs만 대시보드에 붙여넣지 마세요. 무료 비밀번호 처리 구성요소의 최초 등록도 필요합니다.\nDB 초기화·삭제·새 계정 생성·카드 등록·유료 전환은 하지 않습니다. 기존 Secret은 유지됩니다.\n배포 후 일반 Chrome에서 시험 사이트를 열고 직접 가입과 Google 회원가입을 확인하세요.\n기존 시험 사이트 접근 비밀번호는 그대로 사용합니다. 앱 아이디 비밀번호와 별개입니다.\n\n이 파일들은 배포 준비본입니다. 실제 원격 배포 성공과 본인 Google 로그인은 사용자가 실행한 후 확인합니다.\n`);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ bundle, files: manifest,
    remoteDeploymentExecuted: false, existingSecretsIncluded: false }, null, 2) + '\n');
  return { directory, ...bundle };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('Usage: node scripts/prepare-signup-deployment.mjs <absolute-output> <account-id> <database-id>');
  const result = await prepareSignupDeployment({ directory: process.argv[2], accountId: process.argv[3], databaseId: process.argv[4] });
  console.log(JSON.stringify({ directory: result.directory, bytes: result.bytes, gzipBytes: result.gzipBytes, remoteDeploymentExecuted: false }));
}
