# 운영자 한 명의 비공개 시험 가입

**최신 안내:** 이 구성은 운영자 한 명만 허용하던 이전 선택입니다. 사용자가 직접 가입과 Google 로그인을 요청했으므로 현재 전달 대상은 [가입용 시험본](signup-preview.md)입니다. 아래 명령으로 새 요청의 배포본을 만들지 마세요.

2026-10-21, Asia/Seoul. 사용자는 운영자 시험 가입에 사용할 Google 계정 한 개를 명시적으로 확인했다. 이 문서는 그 계정으로 첫 게임 계정과 기록 저장을 시험하기 위한 별도 서버 구성이다. 일반 만 14세 이상 가입, 실제 연령 확인, 광고 또는 공개 서비스 승인을 뜻하지 않는다.

## 현재 확인한 상태

사용자가 기존 Cloudflare 시험본의 D1 초기화·`DB` 바인딩·연결용 Worker 배포와 Logs OFF를 보고했다. `/api/health` 스크린샷은 `status:ok`, `version:0.5.1`, `database:ready`를 표시했다. 이후 보호된 설정 진단에서 Google `clientId`·`clientSecret`이 모두 `present`라는 응답을 받았고, Google 버튼 이용 뒤 새 계정 가입이 닫혔다는 안내 화면을 확인했다.

이 단계는 Google 설정이 서버에 전달되고 첫 게임 계정 생성에 제한이 있다는 상태다. 새 운영자 전용 시험본의 원격 배포·본인 게임 로그인·기록 저장 성공은 아직 확인하지 않았다. 로컬 검사 결과는 [최신 검증 기록](codex-verification-2026-10-21.md)에 따로 기록한다.

## 허용 범위와 서버 조건

- `server/owner-preview-worker.mjs`의 별도 진입점이 승인한 Gmail과 빌드 시각 `notBefore`를 서버 전용 옵션으로 고정한다. 요청 본문·쿼리·쿠키·환경 변수로 이 예외를 켜거나 허용 계정을 바꿀 수 없다.
- Google의 서명·발급자·대상 클라이언트·subject·nonce 등 기존 검증을 통과한 토큰에서, `email_verified:true`이고 승인한 Gmail과 일치할 때만 최초 시험 등록 후보가 된다. 이메일은 소문자 비교만 하며 점·별칭을 합치지 않는다. Gmail을 관리하는 Google의 검증 이메일을 최초 시험 허가에만 쓰고 기존 계정을 찾거나 병합하는 키로 쓰지 않는다.
- `login` 흐름만 허용하고 그 흐름의 생성 시각이 `notBefore` 이상이어야 한다. 이전 배포에서 시작한 로그인·이미 소비한 흐름·취소 또는 만료된 흐름은 최초 등록에 사용할 수 없다.
- DB 트랜잭션에서 `auth_accounts`, `auth_identities`, `game_players`가 모두 비었는지 재검사한다. 조건을 만족할 때 `preview-owner-`로 시작하는 계정 한 개, 검증된 제공자 신원, 세션과 OAuth 흐름 소비를 함께 처리한다. 부분 실패는 전체 롤백하며 동시 요청이 두 계정을 만들 수 없다.
- Google 이메일은 DB·HTTP 응답에 저장하거나 로그에 남기지 않는다. 허용 이메일은 서버 번들의 정책이며 공개 정적 자산이 아니다. 이후 로그인은 이메일과 무관하게 기존 `provider`·`issuer`·`audience`·`subject` 신원 튜플을 조회한다. 게임 프로필은 로그인 뒤 기존 게임 초기화 경로가 만든다.
- `/api/auth/status`의 `previewEnrollment`는 `enabled`, `provider:"google"`, `accountLimit:1`만 반환한다. 계정이 이미 생기면 최초 등록 준비 상태는 꺼진다. `registration.open:false`, `ageVerificationReady:false`, `under14EnrollmentOpen:false`는 계속 유지한다.

기본 정적 시험본과 기존 [연결용 시험본](connected-preview.md)은 이 운영자 정책을 전달하지 않아 새 가입을 계속 닫는다. 기존 계정에 다른 Google 이메일이 같다는 이유로 신원을 추가하지 않는다. 만 14세 이상 표시나 운영자 예외가 실제 나이 확인을 대신하지도 않는다.

## 로컬 파일 준비

Google은 Gmail 주소에 대한 계정 소유권의 권위가 있지만 이메일을 계정의 영구 식별자로 쓰지 않도록 안내한다. 이 구현도 최초 허가와 이후 신원 조회를 구분한다. [Google 토큰 검증 안내](https://developers.google.com/identity/gsi/web/guides/verify-google-id-token), [OpenID Connect 식별자 안정성](https://openid.net/specs/openid-connect-core-1_0.html#ClaimStability).

승인한 계정이 확인된 경우에만 아래 자리표시자를 그 Gmail 주소로 바꾸어 실행한다.

```powershell
node scripts/owner-preview.mjs dry-run "<승인한Gmail>"
```

명령은 `.local/owner-preview/worker.mjs`를 만들고 오프라인 dry-run을 수행한다. `notBefore`는 그 빌드 시각으로 고정한다. `build` 명령은 파일 생성만 한다. 입력 주소를 출력하지 않고 원격 배포·DB 변경·실제 계정 등록을 실행하지 않는다. 이 전용 CLI는 일반 연결용 빌드와 분리되며 승인하지 않은 계정 목록을 자동 수집하지 않는다.

## 기존 시험 사이트에 적용

1. 사용자가 준비된 `.local/owner-preview/worker.mjs` 전체 내용을 복사한다.
2. Cloudflare의 기존 `harufive-preview`에서 **Edit code**를 열고 `worker.js` 전체를 교체한 뒤 배포한다. 기존 `DB` 바인딩·시험 입장 비밀번호·Google 비밀 설정은 그대로 유지한다. 새 Worker·새 DB·추가 마이그레이션은 필요하지 않다.
3. 일반 Chrome에서 시험 사이트를 새로고침하고 Google 버튼으로 **새 로그인**을 시작한다. 배포 전에 열어 두었던 Google 로그인 흐름은 최초 등록에 쓰지 않는다.
4. 승인한 계정으로 돌아온 뒤 게임 화면·일일 도전·답안 저장을 확인한다. 새로고침과 로그아웃 후 재로그인에서 같은 기록이 이어지는지 확인하고 실제 결과를 기록한다.

Cloudflare 관리 콘솔·시험 원점의 도구 접근 제한은 다른 수단으로 우회하지 않는다. 원격 적용과 실제 본인 인증은 사용자가 직접 한다. 비밀키·세션·OAuth 코드·시험 비밀번호를 채팅이나 문서에 보내지 않는다.

## 실패와 재시도

`signup_closed`가 계속 보이면 먼저 새 로그인 흐름인지, 전용 번들이 적용됐는지, 허용한 본인 Google 계정인지 확인한다. 기존 데이터가 있는 DB는 최초 등록을 거절하므로 성공시키기 위해 표를 지우거나 계정을 임의 삽입하지 않는다. 이미 생성된 운영자 계정은 기존 신원 로그인으로 이어가며, 취소·로그아웃 뒤에는 새 로그인을 시작한다.

이 시험은 본인 탈퇴·폐쇄 계정 복구·실제 연령 확인·일반 가입·광고·모바일 검수·운영 백업 완료를 의미하지 않는다. 공개 단계는 기존 [연령 정책](age-eligibility.md)과 [출시 계획](children-launch-plan.md)의 검증을 별도로 진행한다.
