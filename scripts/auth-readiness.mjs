import { pathToFileURL } from 'node:url';
import { ADMISSION_POLICY } from '../server/admission-policy.mjs';

// Do not import the local environment runner: it creates runtime directories.
// This diagnostic deliberately does not read files, discover keys or call providers.
export const AUTH_READINESS_KEYS = Object.freeze([
  'HARU_AUTH_ORIGIN',
  'HARU_GOOGLE_CLIENT_ID', 'HARU_GOOGLE_CLIENT_SECRET',
  'HARU_KAKAO_CLIENT_ID', 'HARU_KAKAO_CLIENT_SECRET', 'HARU_KAKAO_OIDC_ENABLED',
  'HARU_NAVER_CLIENT_ID', 'HARU_NAVER_CLIENT_SECRET',
]);
const PROVIDERS = Object.freeze([
  { id: 'google', name: 'Google', prefix: 'HARU_GOOGLE' },
  { id: 'kakao', name: '카카오', prefix: 'HARU_KAKAO' },
  { id: 'naver', name: '네이버', prefix: 'HARU_NAVER' },
]);
const STATUS = Object.freeze({ missing: '설정 필요', configured: '설정 있음', invalid: '설정 형식 확인 필요' });
const MESSAGES = Object.freeze({
  missing: '설정이 비어 있어요.',
  configured: '설정 형식을 확인했어요. 실제 제공자 검증은 수행하지 않았어요.',
  invalid_credential: '공백이나 제어문자 없는 1~2048자의 ASCII 설정이 필요해요.',
  invalid_origin: '경로·질의·인증정보 없는 정규 공개 HTTPS 원점이 필요해요. 로컬 주소와 IP 주소는 허용하지 않아요.',
  unreadable: '설정 항목을 읽을 수 없어요.',
  oidc_disabled: '카카오 OpenID Connect 설정과 활성화 확인이 필요해요.',
  invalid_oidc_flag: 'OpenID Connect 설정은 true 또는 false 형식이어야 해요.',
  oidc_builtin: '서버가 OpenID Connect를 사용해요. 실제 제공자 검증은 수행하지 않았어요.',
});
const UNREADABLE = Symbol('unreadable');
const field = (key, status, reason) => ({ key, status, message: MESSAGES[reason], reason });
const missing = value => value === undefined || value === '';
const combine = statuses => statuses.includes('invalid') ? 'invalid' : statuses.includes('missing') ? 'missing' : 'configured';

function credentialStatus(key, value) {
  if (value === UNREADABLE) return field(key, 'invalid', 'unreadable');
  if (missing(value)) return field(key, 'missing', 'missing');
  return typeof value === 'string' && /^[\x21-\x7e]{1,2048}$/.test(value)
    ? field(key, 'configured', 'configured') : field(key, 'invalid', 'invalid_credential');
}

function originStatus(value) {
  const key = 'HARU_AUTH_ORIGIN';
  if (value === UNREADABLE) return { ...field(key, 'invalid', 'unreadable'), publicOrigin: null };
  if (missing(value)) return { ...field(key, 'missing', 'missing'), publicOrigin: null };
  try {
    if (typeof value !== 'string' || value.length > 512 || !/^[\x21-\x7e]+$/.test(value)) throw new Error();
    const url = new URL(value);
    const labels = url.hostname.split('.');
    if (url.protocol !== 'https:' || value !== url.origin || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash || url.hostname.length > 253 || labels.length < 2 ||
        labels.some(label => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label)) ||
        !/^(?:[a-z]{2,63}|xn--[a-z0-9-]{2,59})$/.test(labels.at(-1)) ||
        ['localhost', 'local', 'internal', 'test', 'invalid', 'example', 'onion', 'home', 'lan'].includes(labels.at(-1))) throw new Error();
    return { ...field(key, 'configured', 'configured'), publicOrigin: url.origin };
  } catch {
    return { ...field(key, 'invalid', 'invalid_origin'), publicOrigin: null };
  }
}

function oidcStatus(id, value) {
  if (id !== 'kakao') return { requiredFlag: false, status: 'configured', reason: 'oidc_builtin', message: MESSAGES.oidc_builtin };
  const key = 'HARU_KAKAO_OIDC_ENABLED';
  const result = value === UNREADABLE ? field(key, 'invalid', 'unreadable')
    : value === 'true' ? field(key, 'configured', 'configured')
      : missing(value) || value === 'false' ? field(key, 'missing', 'oidc_disabled')
        : field(key, 'invalid', 'invalid_oidc_flag');
  return { ...result, requiredFlag: true };
}

export function inspectAuthReadiness(env = process.env) {
  const values = Object.create(null);
  for (const key of AUTH_READINESS_KEYS) {
    try { values[key] = env[key]; } catch { values[key] = UNREADABLE; }
  }
  const origin = originStatus(values.HARU_AUTH_ORIGIN);
  const providers = PROVIDERS.map(({ id, name, prefix }) => {
    const clientId = credentialStatus(`${prefix}_CLIENT_ID`, values[`${prefix}_CLIENT_ID`]);
    const clientSecret = credentialStatus(`${prefix}_CLIENT_SECRET`, values[`${prefix}_CLIENT_SECRET`]);
    const oidc = oidcStatus(id, values[`${prefix}_OIDC_ENABLED`]);
    return {
      id, name, status: combine([origin.status, clientId.status, clientSecret.status, oidc.status]),
      clientId, clientSecret, oidc,
      callbackUrl: origin.publicOrigin ? `${origin.publicOrigin}/api/auth/${id}/callback` : null,
      providerVerification: 'not_checked',
      reauthentication: id === 'google'
        ? { status: 'unsupported_by_provider', message: 'Google 계정의 강제 재인증 요청은 공식 미지원이며 현재 차단되어 있어요.' }
        : { status: 'not_verified', message: '제공자의 최근 본인 확인 동작은 실제 검증되지 않았어요.' },
    };
  });
  return {
    schema: 'haru-five-auth-readiness-v1',
    mode: 'configuration_only',
    settingsStatus: combine([origin.status, ...providers.map(provider => provider.status)]),
    launchReady: false,
    origin, providers,
    policy: { ...ADMISSION_POLICY },
    runtime: {
      standaloneUsesProvidedCredentials: false,
      standaloneLoginEnabled: false,
      standaloneReauthenticationEnabled: false,
      selfClosureReady: false,
    },
    incomplete: [
      { code: 'PROVIDER_NOT_VERIFIED', message: '키 형식 확인은 실제 로그인·계정 연결 성공을 뜻하지 않아요. 제공자 콘솔과 실제 응답 검증이 남아 있어요.' },
      { code: 'LOCAL_CREDENTIALS_UNUSED', message: '현재 독립 로컬 실행기는 실제 키를 전달하지 않으므로 이 설정을 로그인에 사용하지 않아요.' },
      { code: 'STANDALONE_AUTH_CLOSED', message: '독립 실행의 실제 로그인과 최근 본인 확인은 아직 닫혀 있어요.' },
      { code: 'ADMISSION_CLOSED', message: '만 14세 이상 정책이며 실제 연령 확인과 가입 허가가 준비되지 않아 가입은 닫혀 있어요. 만 14세 이상에는 청소년도 포함돼요.' },
      { code: 'SELF_CLOSURE_NOT_READY', message: '자기 계정 탈퇴·삭제 뒤의 재확인 절차가 아직 준비되지 않았어요.' },
      { code: 'DEPLOYMENT_NOT_VERIFIED', message: '도메인 소유·DNS·HTTPS·DB·외부 배포와 운영 조건은 이 도구로 확인하지 않아요.' },
    ],
    limitations: [
      '환경변수 파일을 자동으로 읽지 않으며 허용된 process.env 키 8개만 확인해요.',
      '키·ID·토큰·잘못된 URL의 값과 오류 상세는 출력하지 않아요.',
      '공개 도메인 형식만 검사하며 실제 주소 소유나 DNS 상태를 확인하지 않아요.',
      '설정 검사는 서버보다 엄격해요. 키의 공백·비 ASCII 문자와 원점의 끝 슬래시·대소문자 정규화·기본 포트 표기 등을 거부해요.',
      '설정이 모두 있어도 실제 제공자 검증·가입·배포 준비 완료를 뜻하지 않아요. 환경변수로 launchReady를 켤 수 없어요.',
    ],
  };
}

export function formatAuthReadiness(report) {
  const lines = [
    '하루다섯 로그인 설정 점검',
    `설정 상태: ${STATUS[report.settingsStatus]}`,
    '서비스 출시 준비: 미완료',
    `${report.origin.key}: ${STATUS[report.origin.status]} · ${report.origin.message}`,
  ];
  for (const provider of report.providers) {
    lines.push(`${provider.name}: ${STATUS[provider.status]}`);
    for (const item of [provider.clientId, provider.clientSecret, provider.oidc]) {
      lines.push(`  ${item.key || 'OpenID Connect'}: ${STATUS[item.status]} · ${item.message}`);
    }
    lines.push(`  콜백 주소: ${provider.callbackUrl || '올바른 공개 HTTPS 원점 설정 후 표시해요.'}`);
    lines.push(`  최근 본인 확인: ${provider.reauthentication.message}`);
  }
  lines.push('', '별도로 남아 있는 준비', ...report.incomplete.map(item => `- ${item.message}`),
    '', ...report.limitations.map(message => `- ${message}`));
  return lines.join('\n') + '\n';
}

const HELP = '사용법: node scripts/auth-readiness.mjs [--json | --help]\n현재 실행 환경의 허용된 인증 설정만 읽어 점검해요. 진단 종료코드 0은 서비스 출시 승인이 아니에요.\n';
export function runAuthReadiness({ args = process.argv.slice(2), env = process.env, stdout = process.stdout, stderr = process.stderr } = {}) {
  if (!Array.isArray(args) || args.length > 1 || (args.length === 1 && !['--json', '--help'].includes(args[0]))) {
    stderr.write('허용되지 않은 인수예요. --json 또는 --help만 사용할 수 있어요.\n');
    return 2;
  }
  if (args[0] === '--help') { stdout.write(HELP); return 0; }
  try {
    const report = inspectAuthReadiness(env);
    stdout.write(args[0] === '--json' ? JSON.stringify(report, null, 2) + '\n' : formatAuthReadiness(report));
    return 0;
  } catch {
    stderr.write('설정 점검을 완료하지 못했어요. 입력값과 오류 상세는 표시하지 않아요.\n');
    return 2;
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exitCode = runAuthReadiness();
}
