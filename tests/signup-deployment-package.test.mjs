import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { prepareSignupDeployment } from '../scripts/prepare-signup-deployment.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const accountId = 'a'.repeat(32);
const loggedIn = { loggedIn: true, accounts: [{ id: accountId }] };

async function fixture({ migrated = false, initialNames = null,
  authCheck = { body: { loggedIn: false } }, authVerify = { body: loggedIn },
  loginExitCode = 0, dbBeforeExitCode = 0, dbAfterExitCode = 0 } = {}) {
  const base = path.join(project, '.local', 'signup-deployment-tests');
  await mkdir(base, { recursive: true });
  const directory = await mkdtemp(path.join(base, 'run-'));
  await prepareSignupDeployment({ directory, accountId, databaseId: '00000000-0000-0000-0000-000000000000' });
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
if (args[0] === 'whoami') {
  if (!args.includes('--json')) throw new Error('whoami must request JSON');
  const first = !previous.some(call => call[0] === 'whoami');
  const response = first ? ${JSON.stringify(authCheck)} : ${JSON.stringify(authVerify)};
  process.stdout.write(response.raw ?? JSON.stringify(response.body));
  process.exit(response.exitCode ?? 0);
}
if (args[0] === 'login') {
  process.stdout.write('Successfully logged in.\\n');
  process.exit(${JSON.stringify(loginExitCode)});
}
if (args[0] === 'deploy') process.exit(0);
if (args[0] === 'd1' && args[1] === 'migrations' && args[2] === 'apply') process.exit(0);
if (args[0] === 'd1' && args[1] === 'execute') {
  const first = !previous.some(call => call[0] === 'd1' && call[1] === 'execute');
  const names = first ? ${JSON.stringify(baseline)} : ${JSON.stringify(migrated ? expected : baseline)};
  process.stdout.write(JSON.stringify([{ success: true, results: names.map(name => ({ name })) }]));
  process.exit(first ? ${JSON.stringify(dbBeforeExitCode)} : ${JSON.stringify(dbAfterExitCode)});
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
  const callText = await readFile(fixture.log, 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  const calls = callText.trim().split('\n').filter(Boolean).map(JSON.parse);
  const receiptText = await readFile(path.join(fixture.directory, 'deployment-result.json'), 'utf8');
  return { ...result, calls, receipt: JSON.parse(receiptText), receiptText };
}

function assertNoMutation(result) {
  assert.equal(result.calls.some(args => args[0] === 'deploy' || args[1] === 'migrations'), false);
  assert.equal(result.receipt.completed, false);
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
  assert.deepEqual(commands, [['whoami'], ['login'], ['whoami'], ['d1','execute','DB'], ['d1','migrations','apply'], ['d1','execute','DB'], ['deploy']]);
  assert.equal(result.calls.at(-1).includes('--keep-vars'), true);
  assert.match(result.stdout, /배포 명령 완료/);
});

test('an unexpected baseline prevents both schema mutation and deployment', async () => {
  const f = await fixture({ initialNames: ['other-database.sql'] });
  const result = await run(f);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /기존 저장소의 이력이 예상과 다릅니다/);
  assertNoMutation(result);
});

test('an existing login to the intended account skips browser login', async () => {
  const result = await run(await fixture({ migrated: true, authCheck: { body: loggedIn } }));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.calls.some(args => args[0] === 'login'), false);
  assert.equal(result.calls.filter(args => args[0] === 'whoami').length, 1);
  assert.equal(result.receipt.accountVerified, true);
  assert.equal(result.receipt.completed, true);
});

test('a login cleanup failure can proceed only after the intended account is verified', async () => {
  const result = await run(await fixture({ migrated: true, loginExitCode: 1 }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.slice(0, 3).map(args => args[0]), ['whoami', 'login', 'whoami']);
  assert.equal(result.receipt.commands.find(command => command.stage === 'login').exitCode, 1);
  assert.equal(result.receipt.accountVerified, true);
  assert.equal(result.receipt.completed, true);
});

test('Wrangler unauthenticated JSON with exit 1 requests login and then verifies the account', async () => {
  const result = await run(await fixture({ migrated: true,
    authCheck: { body: { loggedIn: false }, exitCode: 1 } }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(result.calls.slice(0, 3).map(args => args[0]), ['whoami', 'login', 'whoami']);
  assert.equal(result.receipt.commands[0].exitCode, 1);
  assert.equal(result.receipt.accountVerified, true);
  assert.equal(result.receipt.completed, true);
});

test('a login cleanup failure followed by unsuccessful verification cannot reach the database', async () => {
  const result = await run(await fixture({ loginExitCode: 1,
    authVerify: { body: loggedIn, exitCode: 1 } }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.map(args => args[0]), ['whoami', 'login', 'whoami']);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, false);
  assert.equal(result.receipt.stage, 'auth-verify');
});

test('another account cannot reach the database or deployment', async () => {
  const result = await run(await fixture({ authCheck: {
    body: { loggedIn: true, accounts: [{ id: 'b'.repeat(32) }] },
  } }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.map(args => args[0]), ['whoami']);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, false);
});

test('a malformed whoami response stops without opening login or touching the database', async () => {
  const result = await run(await fixture({ authCheck: { raw: 'Successfully logged in.\n{broken-json' } }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.map(args => args[0]), ['whoami']);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, false);
});

test('a failed initial whoami command cannot use its otherwise valid JSON as authorization', async () => {
  const result = await run(await fixture({ authCheck: { body: loggedIn, exitCode: 1 } }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.map(args => args[0]), ['whoami']);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, false);
});

test('successful login exit without an authenticated account cannot reach the database', async () => {
  const result = await run(await fixture({ authVerify: { body: { loggedIn: false } } }));
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls.map(args => args[0]), ['whoami', 'login', 'whoami']);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, false);
});

test('cancelled login stops before a follow-up account check or any database command', async t => {
  for (const loginExitCode of [130, 143, ...(process.platform === 'win32' ? [-1073741510, 3221225786] : [])]) {
    await t.test(`exit ${loginExitCode}`, async () => {
      const result = await run(await fixture({ loginExitCode }));
      assert.equal(result.status, 1);
      assert.deepEqual(result.calls.map(args => args[0]), ['whoami', 'login']);
      assertNoMutation(result);
      assert.equal(result.receipt.accountVerified, false);
      assert.equal(result.receipt.stage, 'login');
    });
  }
});

test('a failed D1 history read stops before schema mutation despite matching output', async () => {
  const result = await run(await fixture({ dbBeforeExitCode: 1 }));
  assert.equal(result.status, 1);
  assert.equal(result.calls.filter(args => args[0] === 'd1').length, 1);
  assertNoMutation(result);
  assert.equal(result.receipt.accountVerified, true);
  assert.equal(result.receipt.stage, 'db-before');
});

test('a failed history read after migration cannot deploy despite matching output', async () => {
  const result = await run(await fixture({ migrated: true, dbAfterExitCode: 1 }));
  assert.equal(result.status, 1);
  assert.equal(result.calls.some(args => args[1] === 'migrations'), true);
  assert.equal(result.calls.some(args => args[0] === 'deploy'), false);
  assert.equal(result.receipt.completed, false);
  assert.equal(result.receipt.stage, 'db-after');
});

test('the result file records stages and exit status without raw output or credentials', async () => {
  const sensitiveMarker = 'synthetic-sensitive-token-do-not-save';
  const emailMarker = 'fixture-operator@example.invalid';
  const result = await run(await fixture({ migrated: true, authVerify: { body: {
    ...loggedIn, email: emailMarker, authentication: { oauth_token: sensitiveMarker },
  } } }));
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(Object.keys(result.receipt).sort(), ['accountVerified', 'commands', 'completed', 'format', 'stage']);
  assert.equal(result.receipt.format, 'harufive-deployment-result-v1');
  assert.equal(result.receipt.completed, true);
  assert.equal(result.receipt.accountVerified, true);
  assert.deepEqual(result.receipt.commands.map(command => command.stage),
    ['auth-check', 'login', 'auth-verify', 'db-before', 'migrate', 'db-after', 'deploy']);
  for (const command of result.receipt.commands) {
    assert.deepEqual(Object.keys(command).sort(), ['command', 'exitCode', 'signal', 'stage']);
    assert.equal(command.exitCode, 0);
    assert.equal(command.signal, null);
  }
  assert.equal(result.receiptText.includes(sensitiveMarker), false);
  assert.equal(result.receiptText.includes(emailMarker), false);
  assert.equal(result.receiptText.includes('Successfully logged in.'), false);
  assert.equal(result.receiptText.includes('oauth_token'), false);
  assert.equal(result.receiptText.includes('accounts'), false);
});

test('a failed file check replaces a previous success receipt before any command', async () => {
  const f = await fixture();
  await writeFile(path.join(f.directory, 'deployment-result.json'), JSON.stringify({
    format: 'harufive-deployment-result-v1', completed: true, stage: 'deploy',
    accountVerified: true, commands: [{ stage: 'deploy', command: 'deploy', exitCode: 0, signal: null }],
  }));
  await writeFile(path.join(f.directory, 'worker.mjs'), '// changed after packaging\n');
  const result = await run(f);
  assert.equal(result.status, 1);
  assert.deepEqual(result.calls, []);
  assert.equal(result.receipt.completed, false);
  assert.equal(result.receipt.accountVerified, false);
  assert.deepEqual(result.receipt.commands, []);
});
