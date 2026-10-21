import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSignupDeployment } from '../scripts/prepare-signup-deployment.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));

async function fixture({ migrated = false, initialNames = null } = {}) {
  const base = path.join(project, '.local', 'signup-deployment-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  await prepareSignupDeployment({ directory, accountId: 'a'.repeat(32), databaseId: '00000000-0000-0000-0000-000000000000' });
  const expected = (await readdir(new URL('../drizzle/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  const baseline = initialNames ?? expected.slice(0, 6);
  const log = path.join(directory, 'fake-cli-calls.jsonl');
  const cli = path.join(directory, 'fake-cli.mjs');
  // This fixture never imports Wrangler. Every subprocess executes only this
  // synthetic CLI, which has no network APIs and rejects unrecognized commands.
  await writeFile(cli, `import { appendFileSync, readFileSync } from 'node:fs';
const args = process.argv.slice(2);
const log = ${JSON.stringify(log)};
let previous = []; try { previous = readFileSync(log, 'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse); } catch {}
appendFileSync(log, JSON.stringify(args) + '\\n');
if (args[0] === 'login' || args[0] === 'deploy') process.exit(0);
if (args[0] === 'd1' && args[1] === 'migrations' && args[2] === 'apply') process.exit(0);
if (args[0] === 'd1' && args[1] === 'execute') {
  const first = !previous.some(call => call[0] === 'd1' && call[1] === 'execute');
  const names = first ? ${JSON.stringify(baseline)} : ${JSON.stringify(migrated ? expected : baseline)};
  process.stdout.write(JSON.stringify([{ success: true, results: names.map(name => ({ name })) }]));
  process.exit(0);
}
throw new Error('Unknown synthetic command');
`);
  const runnerPath = path.join(directory, 'deploy.mjs');
  const original = await readFile(runnerPath, 'utf8');
  assert.match(original, /^const cli = .+;$/m);
  // Test-only replacement in the generated runner; shipped source has no hook.
  await writeFile(runnerPath, original.replace(/^const cli = .+;$/m, () => `const cli = ${JSON.stringify(cli)};`));
  return { directory, log, runnerPath, expected };
}

async function run(fixture) {
  const result = spawnSync(process.execPath, [fixture.runnerPath], { cwd: fixture.directory,
    encoding: 'utf8', windowsHide: true, timeout: 30_000 });
  assert.equal(result.error, undefined);
  const calls = (await readFile(fixture.log, 'utf8')).trim().split('\n').filter(Boolean).map(JSON.parse);
  return { ...result, calls };
}

test('declining the migration with Wrangler exit 0 cannot deploy the signup Worker', async () => {
  const f = await fixture({ migrated: false });
  const result = await run(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /가입용 저장소 변경이 완료되지 않았습니다/);
  assert.equal(result.calls.filter(args => args[0] === 'd1' && args[1] === 'execute').length, 2);
  assert.equal(result.calls.some(args => args[0] === 'deploy'), false);
});

test('deployment proceeds only after the exact seven migration names are present', async () => {
  const f = await fixture({ migrated: true });
  const result = await run(f);
  assert.equal(result.status, 0, result.stderr);
  const commands = result.calls.map(args => args.slice(0, args[0] === 'd1' ? 3 : 1));
  assert.deepEqual(commands, [['login'], ['d1','execute','DB'], ['d1','migrations','apply'], ['d1','execute','DB'], ['deploy']]);
  assert.equal(result.calls.at(-1).includes('--keep-vars'), true);
  assert.match(result.stdout, /배포 명령 완료/);
});

test('an unexpected baseline prevents both schema mutation and deployment', async () => {
  const f = await fixture({ initialNames: ['other-database.sql'] });
  const result = await run(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /기존 저장소의 이력이 예상과 다릅니다/);
  assert.equal(result.calls.some(args => args[0] === 'deploy' || args[1] === 'migrations'), false);
});
