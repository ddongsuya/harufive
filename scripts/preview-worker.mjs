import './runtime.mjs';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { STANDALONE_GAME_ASSETS } from '../server/standalone-assets.mjs';

const PROJECT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const WORK = path.join(PROJECT, '.local', 'private-preview');
const CONFIG = path.join(PROJECT, 'wrangler.preview.jsonc');
const CONNECTED_WORK = path.join(PROJECT, '.local', 'connected-preview');
const CONNECTED_CONFIG = path.join(PROJECT, 'wrangler.connected-preview.jsonc');
const OWNER_WORK = path.join(PROJECT, '.local', 'owner-preview');
const OWNER_CONFIG = path.join(PROJECT, 'wrangler.owner-preview.jsonc');
const SIGNUP_WORK = path.join(PROJECT, '.local', 'signup-preview');
const SIGNUP_CONFIG = path.join(PROJECT, 'wrangler.signup-preview.jsonc');
const WRANGLER = path.join(PROJECT, 'node_modules', 'wrangler', 'wrangler-dist', 'cli.js');
export const PREVIEW_ORIGIN = 'https://harufive-preview.limjm900202.workers.dev';
export const PREVIEW_GZIP_LIMIT = 3 * 1024 * 1024;
export const PREVIEW_CONFIG = Object.freeze({
  name: 'harufive-preview',
  main: '.local/private-preview/worker.mjs',
  compatibility_date: '2026-05-15',
  workers_dev: true,
  preview_urls: false,
  no_bundle: true,
  find_additional_modules: false,
  upload_source_maps: false,
  limits: { cpu_ms: 10 },
  observability: { enabled: false },
  vars: { HARU_AUTH_ORIGIN: PREVIEW_ORIGIN, HARU_REGISTRATION_OPEN: 'false' },
});
export const CONNECTED_PREVIEW_CONFIG = Object.freeze({
  ...PREVIEW_CONFIG,
  main: '.local/connected-preview/worker.mjs',
  // This placeholder is only for local format verification. A real database
  // must be configured and migrated separately before any connected use.
  d1_databases: [{
    binding: 'DB', database_name: 'harufive-preview-local-check',
    database_id: '00000000-0000-0000-0000-000000000000',
    migrations_dir: 'drizzle', remote: false,
  }],
});
export const OWNER_PREVIEW_CONFIG = Object.freeze({
  ...CONNECTED_PREVIEW_CONFIG, main: '.local/owner-preview/worker.mjs',
});
const { limits: _ownerLimit, ...signupBase } = CONNECTED_PREVIEW_CONFIG;
export const SIGNUP_PREVIEW_CONFIG = Object.freeze({
  ...signupBase, main: '.local/signup-preview/worker.mjs',
  compatibility_flags: ['nodejs_compat'],
  durable_objects: { bindings: [{ name: 'PASSWORD_HASHER', class_name: 'PasswordHasher' }] },
  migrations: [{ tag: 'harufive-password-v1', new_sqlite_classes: ['PasswordHasher'] }],
});
const ASSET_FILES = [
  ['/index.html', 'local/index.html', 'text/html; charset=utf-8'],
  ['/local-boot.js', 'local/boot.js', 'text/javascript; charset=utf-8'],
  ...STANDALONE_GAME_ASSETS.map(name => [
    `/game/${name}`, `public/game/${name}`,
    name.endsWith('.css') ? 'text/css; charset=utf-8'
      : name.endsWith('.svg') ? 'image/svg+xml' : 'text/javascript; charset=utf-8',
  ]),
];
const SERVER_INPUTS = new Set([
  'privacy-contract', 'admission-policy', 'auth-service', 'account-lifecycle',
  'guardian-service', 'privacy-http', 'game-service', 'http', 'standalone-http',
  'standalone-assets', 'worker', 'preview-worker', 'connected-preview-worker', 'owner-preview-worker',
  'signup-preview-worker', 'password-client', 'password-hasher',
].map(name => `server/${name}.mjs`));
const LEGACY_INPUTS = new Set(['question-variants', 'game-core', 'state'].map(name => `legacy/v040/${name}.js`));
const fail = () => { throw new Error('시험용 Worker 준비를 완료하지 못했습니다. 설정과 허용된 소스 파일을 확인해 주세요.'); };

async function checkedPath(target, { directory = false, create = false } = {}) {
  const relative = path.relative(PROJECT, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail();
  let current = PROJECT;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const mustBeDirectory = index < parts.length - 1 || directory;
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) fail();
      if (!mustBeDirectory) return current;
      await mkdir(current);
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || (mustBeDirectory ? !stat.isDirectory() : !stat.isFile())) fail();
    if (path.relative(PROJECT, await realpath(current)) !== path.relative(PROJECT, current)) fail();
  }
  return current;
}

export function validatePreviewConfig(config, { connected = false, owner = false, signup = false } = {}) {
  // No account, DB, external assets, source maps, custom build hooks or remote
  // command parameters are accepted by this local-only preparation command.
  if ((owner || signup) && !connected || owner && signup) fail();
  if (!isDeepStrictEqual(config, signup ? SIGNUP_PREVIEW_CONFIG : owner ? OWNER_PREVIEW_CONFIG : connected ? CONNECTED_PREVIEW_CONFIG : PREVIEW_CONFIG)) fail();
  return config;
}

function checkedOwnerEnrollment(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).sort().join(',') !== 'email,notBefore' ||
      typeof value.email !== 'string' || !/^[a-z0-9][a-z0-9.]{0,63}@gmail\.com$/.test(value.email) ||
      !Number.isSafeInteger(value.notBefore) || value.notBefore <= 0) fail();
  return { email: value.email, notBefore: value.notBefore };
}

export function renderPreviewEntry(assets, { connected = false, ownerEnrollment = null, signup = false } = {}) {
  const owner = ownerEnrollment !== null ? checkedOwnerEnrollment(ownerEnrollment) : null;
  if ((owner || signup) && !connected || owner && signup) fail();
  if (!Array.isArray(assets) || assets.length !== ASSET_FILES.length) fail();
  const entries = assets.map((asset, index) => {
    const [route, , contentType] = ASSET_FILES[index];
    if (asset.path !== route || asset.contentType !== contentType || typeof asset.content !== 'string') fail();
    return [route, { contentType, content: asset.content }];
  });
  const importName = signup ? 'signup-preview-worker' : connected ? 'connected-preview-worker' : 'preview-worker';
  const importSource = owner
    ? `import { createOwnerPreviewWorker } from '../../server/owner-preview-worker.mjs';\nconst previewWorker = createOwnerPreviewWorker(${JSON.stringify(owner)});`
    : `import previewWorker from '../../server/${importName}.mjs';${signup ? "\nexport { PasswordHasher } from '../../server/signup-preview-worker.mjs';" : ''}`;
  const connection = connected ? `
      // Defer these reads until after the preview gate authenticates the request.
      get DB() { return env.DB; },
      get HARU_GOOGLE_CLIENT_ID() { return env.HARU_GOOGLE_CLIENT_ID; },
      get HARU_GOOGLE_CLIENT_SECRET() { return env.HARU_GOOGLE_CLIENT_SECRET; },
      ${signup ? 'get PASSWORD_HASHER() { return env.PASSWORD_HASHER; },' : `get HARU_KAKAO_CLIENT_ID() { return env.HARU_KAKAO_CLIENT_ID; },
      get HARU_KAKAO_CLIENT_SECRET() { return env.HARU_KAKAO_CLIENT_SECRET; },
      get HARU_KAKAO_OIDC_ENABLED() { return env.HARU_KAKAO_OIDC_ENABLED; },
      get HARU_NAVER_CLIENT_ID() { return env.HARU_NAVER_CLIENT_ID; },
      get HARU_NAVER_CLIENT_SECRET() { return env.HARU_NAVER_CLIENT_SECRET; },`}` : '';
  return `${importSource}
const assets = new Map(${JSON.stringify(entries)});
const assetAdapter = Object.freeze({
  async fetch(request) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response(null, { status: 405 });
    const asset = assets.get(new URL(request.url).pathname);
    if (!asset) return new Response(null, { status: 404 });
    return new Response(request.method === 'HEAD' ? null : asset.content, {
      headers: { 'Content-Type': asset.contentType, 'Cache-Control': 'private, no-store' },
    });
  },
});
export default {
  fetch(request, env = {}) {
    return previewWorker.fetch(request, {
      HARU_AUTH_ORIGIN: ${JSON.stringify(PREVIEW_ORIGIN)},
      HARU_PREVIEW_PASSWORD: env.HARU_PREVIEW_PASSWORD,
      ASSETS: assetAdapter,${connection}
    });
  },
};
`;
}

export function measurePreviewBundle(bytes) {
  const gzipBytes = gzipSync(bytes, { level: 9 }).byteLength;
  if (gzipBytes >= PREVIEW_GZIP_LIMIT) fail();
  return { bytes: bytes.byteLength, gzipBytes, sha256: createHash('sha256').update(bytes).digest('hex') };
}

export async function buildPreviewWorker({ connected = false, ownerEnrollment = null, signup = false } = {}) {
  if (typeof connected !== 'boolean') fail();
  const owner = ownerEnrollment !== null ? checkedOwnerEnrollment(ownerEnrollment) : null;
  if (typeof signup !== 'boolean' || (owner || signup) && !connected || owner && signup) fail();
  const work = signup ? SIGNUP_WORK : owner ? OWNER_WORK : connected ? CONNECTED_WORK : WORK;
  const config = signup ? SIGNUP_CONFIG : owner ? OWNER_CONFIG : connected ? CONNECTED_CONFIG : CONFIG;
  validatePreviewConfig(JSON.parse(await readFile(await checkedPath(config), 'utf8')), { connected, owner: !!owner, signup });
  const assets = [];
  for (const [route, source, contentType] of ASSET_FILES) {
    const data = await readFile(await checkedPath(path.join(PROJECT, source)));
    if (data.byteLength > 2 * 1024 * 1024) fail();
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail(); }
    if (route === '/index.html') content = content.replace('하루다섯 · 로컬 개발', '하루다섯 · 비공개 시험');
    assets.push({ path: route, contentType, content });
  }
  await checkedPath(work, { directory: true, create: true });
  const entry = await checkedPath(path.join(work, 'entry.mjs'), { create: true });
  const output = await checkedPath(path.join(work, 'worker.mjs'), { create: true });
  const entrySource = renderPreviewEntry(assets, { connected, ownerEnrollment: owner, signup });
  // Compile the in-memory entry so parallel tests/builds cannot read another
  // build's partly written entry. Retain an atomically published inspection copy.
  const entryTemporary = await checkedPath(path.join(work, `entry-${randomUUID()}.tmp`), { create: true });
  await writeFile(entryTemporary, entrySource);
  await rename(entryTemporary, entry);
  const result = await build({
    absWorkingDir: PROJECT, stdin: { contents: entrySource, resolveDir: work, sourcefile: entry }, outfile: output,
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    sourcemap: false, sourcesContent: false, legalComments: 'none', minify: false,
    metafile: true, logLevel: 'silent',
    external: signup ? ['node:crypto', 'node:buffer'] : [],
  });
  const outputs = Object.values(result.metafile.outputs);
  if (result.outputFiles.length !== 1 || outputs.length !== 1 ||
      (signup ? outputs[0].imports.some(item => !item.external || !['node:crypto', 'node:buffer'].includes(item.path)) : outputs[0].imports.length !== 0) ||
      !isDeepStrictEqual(outputs[0].exports, signup ? ['PasswordHasher', 'default'] : ['default'])) fail();
  // Include only the server's known modules and the installed jose JS modules
  // they import; never glob runtime files or copy a dependency directory.
  if (Object.keys(result.metafile.inputs).some(input =>
    input !== path.relative(PROJECT, entry).split(path.sep).join('/') && !SERVER_INPUTS.has(input) && !LEGACY_INPUTS.has(input) &&
    !/^node_modules\/jose\/dist\/webapi\/[a-z0-9_/-]+\.js$/.test(input))) fail();
  const bytes = result.outputFiles[0].contents;
  const measured = measurePreviewBundle(bytes);
  const outputTemporary = await checkedPath(path.join(work, `worker-${randomUUID()}.tmp`), { create: true });
  await writeFile(outputTemporary, bytes);
  await rename(outputTemporary, output);
  return { ...measured, assetCount: assets.length, output, inputs: Object.keys(result.metafile.inputs) };
}

export function previewChildEnvironment(parent, runtimeDirectory) {
  const env = {};
  // Direct reads of OS necessities only; do not inspect existing credentials,
  // arbitrary environment names, proxy settings or NODE_OPTIONS.
  for (const key of ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'windir', 'ComSpec', 'COMSPEC', 'PATHEXT', 'TEMP', 'TMP']) {
    if (typeof parent[key] === 'string') env[key] = parent[key];
  }
  for (const key of ['HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'XDG_RUNTIME_DIR']) {
    env[key] = runtimeDirectory;
  }
  return { ...env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false',
    WRANGLER_LOG_SANITIZE: 'true', WRANGLER_LOG_PATH: path.join(runtimeDirectory, 'wrangler.log'),
    CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false' };
}

export function offlinePreloadSource() {
  return `const deny = () => { throw new Error('OFFLINE_PREVIEW_NETWORK_DISABLED'); };
globalThis.fetch = deny;
globalThis.WebSocket = class { constructor() { deny(); } };
for (const [name, methods] of [
  ['node:http', ['request', 'get']], ['node:https', ['request', 'get']],
  ['node:net', ['connect', 'createConnection']], ['node:tls', ['connect']],
  ['node:dns', ['lookup', 'resolve', 'resolve4', 'resolve6']],
  ['node:dgram', ['createSocket']],
]) {
  const module = require(name);
  for (const method of methods) module[method] = deny;
}
require('node:net').Socket.prototype.connect = deny;
for (const method of ['lookup', 'resolve', 'resolve4', 'resolve6']) require('node:dns').promises[method] = deny;
require('node:module').syncBuiltinESMExports();
`;
}

export function previewDryRunCommand(runtimeDirectory, { connected = false, owner = false, signup = false } = {}) {
  if ((owner || signup) && !connected || owner && signup) fail();
  return ['--require', path.join(runtimeDirectory, 'offline.cjs'), WRANGLER, 'deploy',
    '--dry-run', '--outdir', path.join(runtimeDirectory, 'bundle'), '--config', signup ? SIGNUP_CONFIG : owner ? OWNER_CONFIG : connected ? CONNECTED_CONFIG : CONFIG,
    '--env-file', path.join(runtimeDirectory, 'empty.env')];
}

async function dryRunPreview({ connected = false, owner = false, signup = false } = {}) {
  await checkedPath(WRANGLER);
  const work = signup ? SIGNUP_WORK : owner ? OWNER_WORK : connected ? CONNECTED_WORK : WORK;
  const runtimeDirectory = await mkdtemp(path.join(await checkedPath(work, { directory: true }), 'offline-'));
  await checkedPath(runtimeDirectory, { directory: true });
  await mkdir(path.join(runtimeDirectory, 'bundle'));
  await writeFile(path.join(runtimeDirectory, 'offline.cjs'), offlinePreloadSource());
  await writeFile(path.join(runtimeDirectory, 'empty.env'), '# No environment values are loaded.\n');
  return await new Promise((resolve, reject) => {
    // Output is intentionally suppressed: Wrangler logs must not become a
    // channel for machine details or a future library's environment diagnostics.
    const child = spawn(process.execPath, previewDryRunCommand(runtimeDirectory, { connected, owner, signup }), {
      cwd: runtimeDirectory, env: previewChildEnvironment(process.env, runtimeDirectory),
      stdio: 'ignore', windowsHide: true,
    });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('OFFLINE_PREVIEW_TIMEOUT')); }, 60_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('OFFLINE_PREVIEW_FAILED')); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('OFFLINE_PREVIEW_FAILED')); });
  });
}

// An explicit local command pins the human-selected operator in server code.
// It neither reads credentials nor uploads/deploys anything.
export async function runOwnerPreviewWorker(args, write = message => console.log(message)) {
  if (!Array.isArray(args) || args.length !== 2 || !['build', 'dry-run'].includes(args[0])) {
    write('사용법: node scripts/owner-preview.mjs build 또는 dry-run 뒤에 승인한 Gmail 주소 하나를 입력하세요. 원격 작업은 지원하지 않습니다.');
    return 2;
  }
  try {
    const ownerEnrollment = checkedOwnerEnrollment({ email: args[1], notBefore: Date.now() });
    const result = await buildPreviewWorker({ connected: true, ownerEnrollment });
    if (args[0] === 'dry-run') await dryRunPreview({ connected: true, owner: true });
    write(`운영자 한 명의 시험 가입 Worker 준비 완료: 자산 ${result.assetCount}개, gzip ${result.gzipBytes}바이트. ${args[0] === 'dry-run' ? '오프라인 dry-run 통과. ' : ''}원격 배포·실제 가입은 실행하지 않았습니다.`);
    return 0;
  } catch {
    write('운영자 시험 Worker 준비를 완료하지 못했습니다. 승인한 Gmail 주소와 로컬 설정을 확인하세요. 입력값은 출력하지 않습니다.');
    return 1;
  }
}

export async function runPreviewWorker(args = process.argv.slice(2), write = message => console.log(message)) {
  if (args.length !== 1 || !['build', 'dry-run', 'connected-build', 'connected-dry-run', 'signup-build', 'signup-dry-run'].includes(args[0])) {
    write('사용법: node scripts/preview-worker.mjs build, dry-run, connected-build 또는 connected-dry-run. 추가 인수와 원격 작업은 지원하지 않습니다.');
    return 2;
  }
  try {
    const signup = args[0].startsWith('signup-');
    const connected = signup || args[0].startsWith('connected-');
    const dryRun = args[0].endsWith('dry-run');
    const result = await buildPreviewWorker({ connected, signup });
    if (dryRun) await dryRunPreview({ connected, signup });
    write(`${signup ? '아이디·Google 가입용' : connected ? '기존 계정 연결용' : '정적'} 비공개 시험 Worker 준비 완료: 자산 ${result.assetCount}개, gzip ${result.gzipBytes}바이트. ${dryRun ? '오프라인 dry-run 통과. ' : ''}원격 배포·실제 로그인은 실행하지 않았습니다.`);
    return 0;
  } catch {
    write('시험용 Worker 준비를 완료하지 못했습니다. 로컬 설정과 설치 상태를 확인해 주세요. 원격 배포는 실행하지 않았습니다.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPreviewWorker();
}
