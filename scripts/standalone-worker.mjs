import './runtime.mjs';
import { spawn } from 'node:child_process';
import { lstat, mkdir, readdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STANDALONE_GAME_ASSETS } from '../server/standalone-assets.mjs';

const PROJECT = path.resolve(fileURLToPath(new URL('../', import.meta.url)));
const CONFIG = path.join(PROJECT, 'wrangler.standalone.jsonc');
const EMPTY_ENV = path.join(PROJECT, 'scripts', 'standalone-empty.env');
const WORK = path.join(PROJECT, '.local', 'standalone-worker');
const ASSETS = path.join(WORK, 'public');
const STATE = path.join(WORK, 'state');
const WRANGLER = path.join(PROJECT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const PUBLIC_FILES = new Set(['index.html', 'local-boot.js', ...STANDALONE_GAME_ASSETS.map(name => `game/${name}`)]);
const fail = message => { throw new Error(message); };

function contained(target) {
  const relative = path.relative(PROJECT, target);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) fail('Path must stay inside this project.');
  return relative;
}

async function checkedPath(target, { directory = false, create = false } = {}) {
  const relative = contained(target);
  let current = PROJECT;
  const parts = relative.split(path.sep);
  for (let index = 0; index < parts.length; index++) {
    current = path.join(current, parts[index]);
    const mustBeDirectory = index < parts.length - 1 || directory;
    let stat;
    try { stat = await lstat(current); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      if (!mustBeDirectory) return current;
      await mkdir(current);
      stat = await lstat(current);
    }
    if (stat.isSymbolicLink() || (mustBeDirectory ? !stat.isDirectory() : !stat.isFile())) fail('Refusing a linked or unexpected preparation path.');
    const resolved = await realpath(current);
    if (path.relative(PROJECT, resolved) !== path.relative(PROJECT, current)) fail('Preparation paths must resolve inside the project.');
  }
  return current;
}

export async function validateStandaloneConfig() {
  const config = JSON.parse(await readFile(await checkedPath(CONFIG), 'utf8'));
  const emptyEnv = await readFile(await checkedPath(EMPTY_ENV), 'utf8');
  if (emptyEnv.split(/\r?\n/).some(line => line.trim() && !line.trim().startsWith('#'))) fail('The standalone env file must remain empty.');
  const allowedKeys = new Set(['$schema', 'name', 'main', 'compatibility_date', 'workers_dev', 'preview_urls', 'limits', 'observability', 'build', 'assets', 'd1_databases', 'vars', 'dev']);
  if (Object.keys(config).some(key => !allowedKeys.has(key)) || config.name !== 'haru-five-standalone-local' ||
      config.main !== 'server/worker.mjs' || config.workers_dev !== false || config.preview_urls !== false ||
      config.compatibility_date !== '2026-05-15' || JSON.stringify(config.limits) !== '{"cpu_ms":10}' ||
      JSON.stringify(config.observability) !== '{"enabled":false}' ||
      JSON.stringify(config.build) !== '{"command":"node scripts/standalone-build-gate.mjs"}' ||
      JSON.stringify(config.vars) !== '{"HARU_REGISTRATION_OPEN":"false"}' ||
      JSON.stringify(config.dev) !== '{"ip":"127.0.0.1","port":8787,"local_protocol":"http"}') fail('Standalone config is restricted to local preparation.');
  if (JSON.stringify(config.assets) !== JSON.stringify({ directory: './.local/standalone-worker/public', binding: 'ASSETS', run_worker_first: true, html_handling: 'none', not_found_handling: 'none' }) ||
      JSON.stringify(config.d1_databases) !== JSON.stringify([{ binding: 'DB', database_name: 'haru-five-standalone-local', database_id: '00000000-0000-0000-0000-000000000000', migrations_dir: 'drizzle', remote: false }])) {
    fail('Only the local asset directory and placeholder D1 are supported.');
  }
  return config;
}

async function rejectUnexpectedAssets(directory = ASSETS, prefix = '') {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const relative = `${prefix}${item.name}`;
    if (item.isSymbolicLink()) fail('Linked assets are not published.');
    if (item.isDirectory() && relative === 'game') await rejectUnexpectedAssets(path.join(directory, item.name), 'game/');
    else if (!item.isFile() || !PUBLIC_FILES.has(relative)) fail('Unexpected generated public file; no files were deleted. Review the standalone public folder.');
  }
}

export async function prepareStandaloneAssets() {
  await validateStandaloneConfig();
  await checkedPath(ASSETS, { directory: true, create: true });
  await checkedPath(path.join(ASSETS, 'game'), { directory: true, create: true });
  await rejectUnexpectedAssets();
  const sources = [
    ['index.html', path.join(PROJECT, 'local', 'index.html')],
    ['local-boot.js', path.join(PROJECT, 'local', 'boot.js')],
    ...STANDALONE_GAME_ASSETS.map(name => [`game/${name}`, path.join(PROJECT, 'public', 'game', name)]),
  ];
  let bytes = 0;
  for (const [destination, source] of sources) {
    let data = await readFile(await checkedPath(source));
    if (data.byteLength > 2 * 1024 * 1024) fail('A public asset exceeds the preparation size limit.');
    if (destination === 'index.html') data = Buffer.from(data.toString('utf8').replace('하루다섯 · 로컬 개발', '하루다섯 · 출시 준비'));
    bytes += data.byteLength;
    await writeFile(await checkedPath(path.join(ASSETS, destination), { create: true }), data);
  }
  await rejectUnexpectedAssets();
  return { files: sources.length, bytes };
}

export function standaloneChildEnvironment(parent = process.env, mode) {
  // Explicit inherited OS necessities only: no provider keys, NODE_OPTIONS,
  // Cloudflare tokens/account IDs, proxy credentials or arbitrary HARU values.
  const allowed = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'userprofile', 'home', 'appdata', 'localappdata', 'pathext', 'term']);
  const env = Object.fromEntries(Object.entries(parent).filter(([key, value]) => allowed.has(key.toLowerCase()) && typeof value === 'string'));
  return { ...env, CI: 'true', NO_COLOR: '1', WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_SANITIZE: 'true',
    WRANGLER_LOG_PATH: path.join(WORK, 'wrangler.log'), CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false',
    CLOUDFLARE_INCLUDE_PROCESS_ENV: 'false', HARU_STANDALONE_BUILD_MODE: mode };
}

export function standaloneCommand(mode) {
  const common = ['--config', CONFIG, '--env-file', EMPTY_ENV];
  if (mode === 'dry-run') return [WRANGLER, 'deploy', '--dry-run', '--outdir', path.join(WORK, 'bundle'), ...common];
  if (mode === 'db') return [WRANGLER, 'd1', 'migrations', 'apply', 'DB', '--local', '--persist-to', STATE, ...common];
  if (mode === 'dev') return [WRANGLER, 'dev', '--local', '--ip', '127.0.0.1', '--port', '8787', '--inspector-port', '0', '--persist-to', STATE, ...common];
  fail('Only build, dry-run, db and dev are supported; additional or remote arguments are rejected.');
}

export async function runStandaloneWorker(args = process.argv.slice(2)) {
  if (args.length !== 1 || !['build', 'dry-run', 'db', 'dev'].includes(args[0])) fail('Use exactly one local mode: build, dry-run, db or dev.');
  const mode = args[0];
  const prepared = await prepareStandaloneAssets();
  console.log(`공개 자산 ${prepared.files}개 준비 완료. 실제 로그인·배포는 연결하지 않았습니다.`);
  if (mode === 'build') return 0;
  await checkedPath(WRANGLER);
  await checkedPath(STATE, { directory: true, create: true });
  await checkedPath(path.join(WORK, 'bundle'), { directory: true, create: true });
  const child = spawn(process.execPath, standaloneCommand(mode), {
    cwd: PROJECT, env: standaloneChildEnvironment(process.env, mode), stdio: 'inherit', windowsHide: true,
  });
  const stop = () => { child.kill(); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  return await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      process.off('SIGINT', stop); process.off('SIGTERM', stop);
      if (signal) resolve(1); else resolve(code ?? 1);
    });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await runStandaloneWorker(); }
  catch (error) { console.error(error instanceof Error ? error.message : 'Local preparation failed.'); process.exitCode = 1; }
}
