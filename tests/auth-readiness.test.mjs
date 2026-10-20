import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AUTH_READINESS_KEYS, inspectAuthReadiness, formatAuthReadiness, runAuthReadiness } from '../scripts/auth-readiness.mjs';

const SCRIPT = fileURLToPath(new URL('../scripts/auth-readiness.mjs', import.meta.url));
const MARKER = 'PRIVATE_CLIENT_FIXTURE_72e5c9';
const complete = () => ({
  HARU_AUTH_ORIGIN: 'https://harufive.example.com',
  HARU_GOOGLE_CLIENT_ID: MARKER + '_google_id', HARU_GOOGLE_CLIENT_SECRET: MARKER + '_google_secret',
  HARU_KAKAO_CLIENT_ID: MARKER + '_kakao_id', HARU_KAKAO_CLIENT_SECRET: MARKER + '_kakao_secret', HARU_KAKAO_OIDC_ENABLED: 'true',
  HARU_NAVER_CLIENT_ID: MARKER + '_naver_id', HARU_NAVER_CLIENT_SECRET: MARKER + '_naver_secret',
});
function cli(args, env) {
  let stdout = '', stderr = '';
  const exitCode = runAuthReadiness({ args, env, stdout: { write: value => { stdout += value; } }, stderr: { write: value => { stderr += value; } } });
  return { stdout, stderr, exitCode };
}
function temporary(t) {
  const folder = mkdtempSync(path.join(tmpdir(), 'haru-auth-readiness-'));
  t.after(() => {
    if (path.dirname(path.resolve(folder)) !== path.resolve(tmpdir()) || !path.basename(folder).startsWith('haru-auth-readiness-')) throw new Error('Unexpected cleanup path');
    rmSync(folder, { recursive: true, force: true });
  });
  return folder;
}

test('missing settings are diagnosed without treating a completed check as launch approval', () => {
  const report = inspectAuthReadiness({});
  assert.equal(report.settingsStatus, 'missing');
  assert.equal(report.origin.publicOrigin, null);
  assert.ok(report.providers.every(provider => provider.status === 'missing' && provider.callbackUrl === null));
  assert.equal(report.launchReady, false);
  assert.deepEqual(report.policy, { minimumSignupAge: 14, registrationOpen: false, under14EnrollmentOpen: false, ageVerificationReady: false });
  assert.deepEqual(report.runtime, { standaloneUsesProvidedCredentials: false, standaloneLoginEnabled: false, standaloneReauthenticationEnabled: false, selfClosureReady: false });
  assert.equal(cli([], {}).exitCode, 0);
  assert.match(formatAuthReadiness(report), /설정 필요/);
});

test('complete configuration emits only safe public callback URLs and cannot enable launch with environment flags', () => {
  const env = {
    ...complete(), HARU_REGISTRATION_OPEN: 'true', HARU_AUTH_LOGIN_ENABLED: 'true', HARU_REAUTH_ENABLED: 'true',
    HARU_AGE_VERIFICATION_READY: 'true', HARU_SELF_CLOSURE_READY: 'true', launchReady: 'true',
    HARU_GOOGLE_REDIRECT_URI: 'https://private.invalid/' + MARKER, HARU_SITES_TESTER_EMAIL: MARKER + '@example.com',
  };
  const before = structuredClone(env), report = inspectAuthReadiness(env);
  assert.deepEqual(env, before);
  assert.equal(report.settingsStatus, 'configured');
  assert.ok(report.providers.every(provider => provider.status === 'configured' && provider.providerVerification === 'not_checked'));
  assert.deepEqual(report.providers.map(provider => provider.callbackUrl), [
    'https://harufive.example.com/api/auth/google/callback',
    'https://harufive.example.com/api/auth/kakao/callback',
    'https://harufive.example.com/api/auth/naver/callback',
  ]);
  assert.equal(report.launchReady, false);
  assert.ok(Object.values(report.runtime).every(value => value === false));
  assert.equal(report.policy.registrationOpen, false);
  assert.equal(report.providers[0].reauthentication.status, 'unsupported_by_provider');
  assert.ok(report.providers.slice(1).every(provider => provider.reauthentication.status === 'not_verified'));
  for (const output of [formatAuthReadiness(report), JSON.stringify(report)]) {
    assert.ok(!output.includes(MARKER));
    assert.ok(!output.includes('https://private.invalid/'));
    assert.match(output, /현재 독립 로컬 실행기는 실제 키를 전달하지 않으므로/);
  }
});

test('origin validation rejects local, normalized, credential-bearing and contaminated URLs without echoing them', () => {
  const bad = [
    'http://harufive.example.com', 'https://localhost', 'https://sub.localhost', 'https://haru.local',
    'https://haru.internal', 'https://haru.test', 'https://127.0.0.1', 'https://2130706433', 'https://[::1]',
    `https://${MARKER}:password@example.com`, `https://harufive.example.com/${MARKER}`,
    `https://harufive.example.com?token=${MARKER}`, `https://harufive.example.com#${MARKER}`,
    'https://HARUFIVE.example.com', 'https://harufive.example.com/', 'https://harufive.example.com:443',
    ' https://harufive.example.com', 'https://harufive.example.com\n', 'https://harufive.example.com\\',
    'https://한글.example.com', '\u001b[31m' + MARKER, 'https://' + 'a'.repeat(513),
    'https://' + Array.from({ length: 5 }, () => 'a'.repeat(60)).join('.') + '.com',
  ];
  for (const origin of bad) {
    const report = inspectAuthReadiness({ ...complete(), HARU_AUTH_ORIGIN: origin });
    assert.equal(report.origin.status, 'invalid');
    assert.equal(report.origin.publicOrigin, null);
    assert.ok(report.providers.every(provider => provider.callbackUrl === null && provider.status === 'invalid'));
    const output = JSON.stringify(report) + formatAuthReadiness(report);
    assert.ok(!output.includes(origin));
    assert.ok(!output.includes(MARKER));
    assert.ok(!output.includes('\u001b'));
  }
});

test('credentials are classified without string coercion or error-detail disclosure', () => {
  for (const key of AUTH_READINESS_KEYS.filter(key => /CLIENT_/.test(key))) {
    for (const value of [null, 42, {}, ['secret'], ' ', ' padded', 'padded ', 'token\nnext', 'tab\tvalue', 'nul\0value', '\u007f', '한글', 'x'.repeat(2049), { toString() { throw new Error(MARKER); } }]) {
      const report = inspectAuthReadiness({ ...complete(), [key]: value });
      assert.equal(report.settingsStatus, 'invalid');
      assert.ok(!JSON.stringify(report).includes(MARKER));
    }
    assert.equal(inspectAuthReadiness({ ...complete(), [key]: '' }).settingsStatus, 'missing');
  }
  const output = cli(['--json'], { get HARU_AUTH_ORIGIN() { throw new Error(MARKER); } });
  assert.equal(output.exitCode, 0);
  assert.equal(JSON.parse(output.stdout).origin.reason, 'unreadable');
  assert.equal(output.stderr, '');
  assert.ok(!output.stdout.includes(MARKER));
  assert.doesNotMatch(output.stdout, /Error:|at inspectAuth/);
});

test('only the exact Kakao OIDC flag enables a configured OIDC setting', () => {
  for (const [value, expected] of [[undefined, 'missing'], ['', 'missing'], ['false', 'missing'], ['true', 'configured'], [true, 'invalid'], ['TRUE', 'invalid'], ['true ', 'invalid'], ['\u001btrue', 'invalid']]) {
    const report = inspectAuthReadiness({ ...complete(), HARU_KAKAO_OIDC_ENABLED: value });
    assert.equal(report.providers.find(provider => provider.id === 'kakao').oidc.status, expected);
    assert.ok(report.providers.filter(provider => provider.id !== 'kakao').every(provider => provider.oidc.requiredFlag === false));
  }
});

test('the checker reads each allowed key once without enumeration or mutation', () => {
  const reads = [], env = new Proxy(complete(), {
    get(target, key) { assert.ok(AUTH_READINESS_KEYS.includes(key)); reads.push(key); return target[key]; },
    ownKeys() { throw new Error('No environment enumeration'); },
    set() { throw new Error('No environment mutation'); },
    defineProperty() { throw new Error('No environment mutation'); },
  });
  assert.equal(inspectAuthReadiness(env).settingsStatus, 'configured');
  assert.deepEqual(reads, [...AUTH_READINESS_KEYS]);
});

test('CLI accepts only the documented standalone options and does not read settings for help or rejected arguments', () => {
  const env = new Proxy({}, { get() { throw new Error('Should not read environment'); } });
  for (const args of [['--json', '--help'], ['--json', '--json'], ['--env-file=.env'], ['--origin', MARKER], [MARKER], ['--json=' + MARKER]]) {
    const result = cli(args, env);
    assert.equal(result.exitCode, 2); assert.equal(result.stdout, '');
    assert.match(result.stderr, /허용되지 않은 인수/); assert.ok(!result.stderr.includes(MARKER));
  }
  const help = cli(['--help'], env);
  assert.equal(help.exitCode, 0); assert.equal(help.stderr, ''); assert.match(help.stdout, /사용법/);
  const json = cli(['--json'], complete());
  assert.equal(json.exitCode, 0); assert.equal(JSON.parse(json.stdout).settingsStatus, 'configured');
  assert.equal(json.stderr, ''); assert.ok(!json.stdout.includes(MARKER));
});

test('real CLI ignores environment files and creates no local files or runtime directories', t => {
  const cwd = temporary(t);
  writeFileSync(path.join(cwd, '.env'), `HARU_AUTH_ORIGIN=https://private-${MARKER.toLowerCase()}.example.com\nHARU_GOOGLE_CLIENT_ID=${MARKER}\n`);
  writeFileSync(path.join(cwd, '.dev.vars'), 'HARU_KAKAO_OIDC_ENABLED=true\n');
  const before = readdirSync(cwd).sort().map(name => [name, readFileSync(path.join(cwd, name), 'utf8')]);
  const result = spawnSync(process.execPath, [SCRIPT, '--json'], { cwd, env: {}, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stderr, '');
  assert.equal(JSON.parse(result.stdout).settingsStatus, 'missing');
  assert.ok(!result.stdout.includes(MARKER.toLowerCase()));
  assert.deepEqual(readdirSync(cwd).sort().map(name => [name, readFileSync(path.join(cwd, name), 'utf8')]), before);
});

test('executing the checker and CLI never calls file, process, browser or network APIs', () => {
  const probe = `
    import fs from 'node:fs';
    import fsp from 'node:fs/promises';
    import http from 'node:http';
    import https from 'node:https';
    import net from 'node:net';
    import tls from 'node:tls';
    import dgram from 'node:dgram';
    import dns from 'node:dns';
    import dnsPromises from 'node:dns/promises';
    import childProcess from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const forbidden = () => { throw new Error('UNEXPECTED_SIDE_EFFECT'); };
    globalThis.fetch = forbidden; globalThis.WebSocket = forbidden; globalThis.open = forbidden;
    const modules = [
      [fs,['readFile','readFileSync','writeFile','writeFileSync','appendFile','appendFileSync','mkdir','mkdirSync','open','openSync','createReadStream','createWriteStream','readdir','readdirSync','stat','statSync']],
      [fsp,['readFile','writeFile','appendFile','mkdir','open','readdir','stat']],
      [http,['request','get','createServer']], [https,['request','get','createServer']],
      [net,['connect','createConnection','createServer']], [tls,['connect','createServer']], [dgram,['createSocket']],
      [dns,['lookup','resolve','resolve4','resolve6']], [dnsPromises,['lookup','resolve','resolve4','resolve6']],
      [childProcess,['exec','execSync','execFile','execFileSync','spawn','spawnSync','fork']],
    ];
    for (const [module,keys] of modules.slice(2)) for (const key of keys) module[key] = forbidden;
    process.loadEnvFile = forbidden; syncBuiltinESMExports();
    const { runAuthReadiness } = await import(${JSON.stringify(new URL('../scripts/auth-readiness.mjs', import.meta.url).href)});
    // Node must load the module's own source first; diagnostic execution may read no files.
    for (const [module,keys] of modules.slice(0,2)) for (const key of keys) module[key] = forbidden;
    syncBuiltinESMExports();
    let output = '';
    const exitCode = runAuthReadiness({args:['--json'],env:${JSON.stringify(complete())},stdout:{write:value=>{output+=value}},stderr:{write:forbidden}});
    if (exitCode !== 0 || JSON.parse(output).launchReady !== false) throw new Error('Unexpected result');
    process.stdout.write('OK');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', probe], { env: {}, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'OK');
  assert.equal(result.stderr, '');
});
