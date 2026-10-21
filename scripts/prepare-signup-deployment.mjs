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
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
const cli = ${JSON.stringify(cli)};
const manifest = ${JSON.stringify(manifest)};
const expected = ${JSON.stringify(migrations)};
const baseline = ${JSON.stringify(baseline)};
const accountId = ${JSON.stringify(accountId)};
const common = ['--config', 'wrangler.jsonc', '--env-file', 'empty.env'];
const result = { format: 'harufive-deployment-result-v1', completed: false,
  stage: 'files', accountVerified: false, commands: [] };
function cancelled(code, signal) {
  return Boolean(signal) || [130, 143, -1073741510, 3221225786].includes(code);
}
async function run(args, { stage, capture = false, allowFailure = false } = {}) {
  result.stage = stage;
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd: directory,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false',
        CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' },
      stdio: capture ? ['inherit', 'pipe', 'inherit'] : 'inherit' });
    let output = '';
    if (capture) child.stdout.on('data', chunk => { output += chunk; });
    child.once('error', reject);
    // close waits for captured stdout to finish; exit can precede the last bytes.
    child.once('close', (code, signal) => {
      result.commands.push({ stage, command: args[0], exitCode: code, signal });
      if (cancelled(code, signal)) return reject(new Error('작업이 취소되거나 실행이 중단됐습니다.'));
      if (code !== 0 && !allowFailure) return reject(new Error('Cloudflare 명령 실패 (종료 코드: ' + code + ').'));
      resolve({ output, code });
    });
  });
}
async function checkAccount(stage) {
  const response = await run(['whoami', '--json', ...common], { stage, capture: true, allowFailure: true });
  let data;
  try { data = JSON.parse(response.output); }
  catch { throw new Error('로그인 확인 응답을 읽지 못했습니다. 연결 상태를 확인한 뒤 다시 실행해 주세요.'); }
  if (data?.loggedIn === false) return false;
  if (response.code !== 0 || data?.loggedIn !== true || !Array.isArray(data.accounts)) {
    throw new Error('Cloudflare 계정 연결을 확인하지 못했습니다.');
  }
  if (!data.accounts.some(account => account?.id === accountId)) {
    throw new Error('현재 로그인한 계정에서 하루다섯 저장소의 계정을 찾지 못했습니다.');
  }
  result.accountVerified = true;
  return true;
}
async function readNames(stage) {
  const response = await run(['d1', 'execute', 'DB', '--remote', '--command', 'SELECT name FROM d1_migrations ORDER BY name', '--json', ...common], { stage, capture: true });
  let payload;
  try { payload = JSON.parse(response.output); }
  catch { throw new Error('저장소 이력 확인 응답을 읽지 못했습니다.'); }
  if (!Array.isArray(payload) || payload.length === 0 || payload.some(item => item?.success !== true || !Array.isArray(item.results))) {
    throw new Error('저장소 이력 확인에 실패했습니다.');
  }
  return payload.flatMap(item => item.results).map(item => item.name).sort();
}
try {
  // Invalidate a previous successful receipt before any command. A closed
  // console or interrupted process must not leave an old success as this run.
  await writeFile(path.join(directory, 'deployment-result.json'), JSON.stringify(result, null, 2) + '\\n');
  for (const file of manifest) {
    const content = await readFile(path.join(directory, file.name));
    if (createHash('sha256').update(content).digest('hex') !== file.sha256) throw new Error('배포 파일이 변경됐습니다. 준비한 원본 파일을 사용해 주세요.');
  }
  await readFile(cli);
  console.log('하루다섯: 기존 시험 서버의 직접 가입·Google 로그인을 배포합니다. 카드 등록·유료 전환은 하지 않습니다.');
  console.log('1/4 Cloudflare 계정 연결을 확인합니다. 이미 로그인되어 있으면 바로 이어갑니다.');
  if (!await checkAccount('auth-check')) {
    console.log('브라우저가 열리면 현재 사용 중인 Cloudflare 계정으로 로그인하고 허용해 주세요.');
    const login = await run(['login', ...common], { stage: 'login', allowFailure: true });
    if (login.code !== 0) console.log('로그인 명령이 정상 종료되지 않았습니다. 실제 계정 연결 여부를 다시 확인합니다.');
    if (!await checkAccount('auth-verify')) throw new Error('로그인이 완료되지 않았습니다. 데이터를 변경하지 않고 중단했습니다.');
  }
  console.log('2/4 기존 저장소 이력을 확인합니다.');
  const names = await readNames('db-before');
  if (JSON.stringify(names) !== JSON.stringify(baseline) && JSON.stringify(names) !== JSON.stringify(expected)) {
    throw new Error('기존 저장소의 이력이 예상과 다릅니다. 데이터를 변경하지 않고 중단했습니다.');
  }
  console.log('3/4 기존 기록을 보존하면서 가입용 저장 항목을 추가합니다.');
  await run(['d1', 'migrations', 'apply', 'DB', '--remote', ...common], { stage: 'migrate' });
  // Wrangler returns exit code 0 when the operator declines the migration.
  // Re-read the ledger so a cancelled apply cannot deploy incompatible code.
  const afterNames = await readNames('db-after');
  if (JSON.stringify(afterNames) !== JSON.stringify(expected)) {
    throw new Error('가입용 저장소 변경이 완료되지 않았습니다. 서버 배포를 중단했습니다.');
  }
  console.log('4/4 기존 서버와 무료 비밀번호 처리 구성요소를 배포합니다.');
  await run(['deploy', '--keep-vars', ...common], { stage: 'deploy' });
  result.completed = true;
  console.log('배포 명령 완료. 일반 Chrome에서 https://harufive-preview.limjm900202.workers.dev/ 를 새로고침하고 회원가입을 확인해 주세요.');
} catch (error) {
  console.error('중단된 단계: ' + result.stage);
  console.error(error?.code === 'ENOENT' ? '개발 폴더의 Node/Wrangler 파일을 찾지 못했습니다. 이 배포 파일은 현재 개발 PC용입니다.' : error.message);
  process.exitCode = 1;
} finally {
  // Save only fixed stage names and exit metadata. Never save CLI output,
  // OAuth URLs, account details, tokens, passwords, or environment values.
  try {
    await writeFile(path.join(directory, 'deployment-result.json'), JSON.stringify(result, null, 2) + '\\n');
    console.log('실행 결과를 같은 폴더의 deployment-result.json에 저장했습니다.');
  } catch {
    console.error('실행 결과 파일을 저장하지 못했습니다. 위 완료 또는 중단 문구를 확인해 주세요.');
  }
}
`;
  await writeFile(path.join(directory, 'deploy.mjs'), runner);
  await writeFile(path.join(directory, '배포하기.cmd'), '@echo off\r\nchcp 65001 >nul\r\nnode "%~dp0deploy.mjs"\r\npause\r\n');
  await writeFile(path.join(directory, 'README.txt'), `하루다섯 직접 회원가입 + Google 시험 배포\n\n현재 개발 PC에서 '배포하기.cmd'를 두 번 클릭하세요.\n이미 연결된 Cloudflare 계정은 다시 로그인하지 않고 이어갑니다.\n로그인 화면이 열릴 때만 기존 계정으로 로그인하고 허용하세요.\n로그인 명령이 비정상 종료돼도 실제 계정 연결 확인이 성공해야 다음 단계로 넘어갑니다.\n저장소 변경 확인이 뜨면 적용할 신규 파일은 0006_preview_registration.sql 하나입니다.\n현재 서버를 대시보드에서 수정했다는 덮어쓰기 확인이 뜨면 기존 harufive-preview를 업데이트하는 것이 맞습니다.\n\n'배포 명령 완료'가 나올 때까지 창을 열어 두세요. 완료 후 아무 키를 눌러 닫습니다.\n중간에 멈추면 실패 단계와 종료 코드를 표시합니다.\n같은 폴더의 deployment-result.json에는 단계·종료 코드만 저장합니다. 비밀번호·토큰·이메일·명령 출력은 저장하지 않습니다.\n\nworker.mjs만 대시보드에 붙여넣지 마세요. 무료 비밀번호 처리 구성요소의 최초 등록도 필요합니다.\nDB 초기화·삭제·새 계정 생성·카드 등록·유료 전환은 하지 않습니다. 기존 Secret은 유지됩니다.\n배포 후 일반 Chrome에서 시험 사이트를 새로고침하고 회원가입 탭을 확인하세요.\n기존 시험 사이트 접근 비밀번호는 그대로 사용합니다. 앱 아이디 비밀번호와 별개입니다.\n\n이 파일들은 배포 준비본입니다. 실제 원격 배포 성공과 본인 Google 로그인은 사용자가 실행한 후 확인합니다.\n`);
  await writeFile(path.join(directory, 'manifest.json'), JSON.stringify({ bundle, files: manifest,
    remoteDeploymentExecuted: false, existingSecretsIncluded: false }, null, 2) + '\n');
  return { directory, ...bundle };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 5) throw new Error('Usage: node scripts/prepare-signup-deployment.mjs <absolute-output> <account-id> <database-id>');
  const result = await prepareSignupDeployment({ directory: process.argv[2], accountId: process.argv[3], databaseId: process.argv[4] });
  console.log(JSON.stringify({ directory: result.directory, bytes: result.bytes, gzipBytes: result.gzipBytes, remoteDeploymentExecuted: false }));
}
