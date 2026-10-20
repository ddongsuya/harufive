import './runtime.mjs';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { STANDALONE_GAME_ASSETS } from '../server/standalone-assets.mjs';

const PROJECT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const WORK = path.join(PROJECT, '.local', 'private-preview');
const CONFIG = path.join(PROJECT, 'wrangler.preview.jsonc');
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
  'standalone-assets', 'worker', 'preview-worker',
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

export function validatePreviewConfig(config) {
  // No account, DB, external assets, source maps, custom build hooks or remote
  // command parameters are accepted by this local-only preparation command.
  if (!isDeepStrictEqual(config, PREVIEW_CONFIG)) fail();
  return config;
}

export function renderPreviewEntry(assets) {
  if (!Array.isArray(assets) || assets.length !== ASSET_FILES.length) fail();
  const entries = assets.map((asset, index) => {
    const [route, , contentType] = ASSET_FILES[index];
    if (asset.path !== route || asset.contentType !== contentType || typeof asset.content !== 'string') fail();
    return [route, { contentType, content: asset.content }];
  });
  return `import previewWorker from '../../server/preview-worker.mjs';
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
      ASSETS: assetAdapter,
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

export async function buildPreviewWorker() {
  validatePreviewConfig(JSON.parse(await readFile(await checkedPath(CONFIG), 'utf8')));
  const assets = [];
  for (const [route, source, contentType] of ASSET_FILES) {
    const data = await readFile(await checkedPath(path.join(PROJECT, source)));
    if (data.byteLength > 2 * 1024 * 1024) fail();
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(data); } catch { fail(); }
    if (route === '/index.html') content = content.replace('하루다섯 · 로컬 개발', '하루다섯 · 비공개 시험');
    assets.push({ path: route, contentType, content });
  }
  await checkedPath(WORK, { directory: true, create: true });
  const entry = await checkedPath(path.join(WORK, 'entry.mjs'), { create: true });
  const output = await checkedPath(path.join(WORK, 'worker.mjs'), { create: true });
  await writeFile(entry, renderPreviewEntry(assets));
  const result = await build({
    absWorkingDir: PROJECT, entryPoints: [entry], outfile: output,
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022',
    sourcemap: false, sourcesContent: false, legalComments: 'none', minify: false,
    metafile: true, logLevel: 'silent',
  });
  const outputs = Object.values(result.metafile.outputs);
  if (result.outputFiles.length !== 1 || outputs.length !== 1 ||
      outputs[0].imports.length !== 0 || !isDeepStrictEqual(outputs[0].exports, ['default'])) fail();
  // Include only the server's known modules and the installed jose JS modules
  // they import; never glob runtime files or copy a dependency directory.
  if (Object.keys(result.metafile.inputs).some(input =>
    input !== '.local/private-preview/entry.mjs' && !SERVER_INPUTS.has(input) && !LEGACY_INPUTS.has(input) &&
    !/^node_modules\/jose\/dist\/webapi\/[a-z0-9_/-]+\.js$/.test(input))) fail();
  const bytes = result.outputFiles[0].contents;
  const measured = measurePreviewBundle(bytes);
  await writeFile(output, bytes);
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

export function previewDryRunCommand(runtimeDirectory) {
  return ['--require', path.join(runtimeDirectory, 'offline.cjs'), WRANGLER, 'deploy',
    '--dry-run', '--outdir', path.join(runtimeDirectory, 'bundle'), '--config', CONFIG,
    '--env-file', path.join(runtimeDirectory, 'empty.env')];
}

async function dryRunPreview() {
  await checkedPath(WRANGLER);
  const runtimeDirectory = await mkdtemp(path.join(await checkedPath(WORK, { directory: true }), 'offline-'));
  await checkedPath(runtimeDirectory, { directory: true });
  await mkdir(path.join(runtimeDirectory, 'bundle'));
  await writeFile(path.join(runtimeDirectory, 'offline.cjs'), offlinePreloadSource());
  await writeFile(path.join(runtimeDirectory, 'empty.env'), '# No environment values are loaded.\n');
  return await new Promise((resolve, reject) => {
    // Output is intentionally suppressed: Wrangler logs must not become a
    // channel for machine details or a future library's environment diagnostics.
    const child = spawn(process.execPath, previewDryRunCommand(runtimeDirectory), {
      cwd: runtimeDirectory, env: previewChildEnvironment(process.env, runtimeDirectory),
      stdio: 'ignore', windowsHide: true,
    });
    const timeout = setTimeout(() => { child.kill(); reject(new Error('OFFLINE_PREVIEW_TIMEOUT')); }, 60_000);
    child.once('error', () => { clearTimeout(timeout); reject(new Error('OFFLINE_PREVIEW_FAILED')); });
    child.once('exit', code => { clearTimeout(timeout); code === 0 ? resolve() : reject(new Error('OFFLINE_PREVIEW_FAILED')); });
  });
}

export async function runPreviewWorker(args = process.argv.slice(2), write = message => console.log(message)) {
  if (args.length !== 1 || !['build', 'dry-run'].includes(args[0])) {
    write('사용법: node scripts/preview-worker.mjs build 또는 dry-run. 추가 인수와 원격 작업은 지원하지 않습니다.');
    return 2;
  }
  try {
    const result = await buildPreviewWorker();
    if (args[0] === 'dry-run') await dryRunPreview();
    write(`비공개 시험용 단일 Worker 준비 완료: 자산 ${result.assetCount}개, gzip ${result.gzipBytes}바이트. ${args[0] === 'dry-run' ? '오프라인 dry-run 통과. ' : ''}원격 배포는 실행하지 않았습니다.`);
    return 0;
  } catch {
    write('시험용 Worker 준비를 완료하지 못했습니다. 로컬 설정과 설치 상태를 확인해 주세요. 원격 배포는 실행하지 않았습니다.');
    return 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await runPreviewWorker();
}
