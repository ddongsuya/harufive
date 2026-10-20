# 인증 연결 전 설정 점검

2026-10-20, Asia/Seoul. 로컬 설정 형식과 실제 제공자 지원·운영 준비를 구분하는 안내다. 가입·이용은 만 14세 이상이며 무료 플레이·광고 수익 목표를 유지한다. 실제 키·연령 확인·신규 가입·독립 인증·폐쇄 계정 복구·배포는 아직 연결하지 않았다.

## 로컬 설정 검사

프로젝트 폴더에서 실행한다.

```sh
npm run auth:check
npm run auth:check -- --json
npm run auth:check -- --help
```

기본 출력은 한국어 요약, `--json`은 구조화된 보고서다. 진단이 정상 실행되면 누락·오류가 있어도 종료 코드는 0이다. **0이나 설정 형식 통과는 출시 가능 판정이 아니며 `launchReady:false`를 유지한다.** 지원하지 않는 인수나 중복·결합 인수는 입력 내용을 되풀이하지 않는 오류와 종료 코드 2로 거절한다.

현재 프로세스 환경에서 다음 8개 이름만 읽는다. 키가 없으면 누락 항목을 보여 주므로 실제 키 없이 실행할 수 있다.

| 설정 | 확인할 내용 |
|---|---|
| `HARU_AUTH_ORIGIN` | 경로·쿼리·인증정보가 없는 정규화된 공개 HTTPS 원점 |
| `HARU_GOOGLE_CLIENT_ID`, `HARU_GOOGLE_CLIENT_SECRET` | Google 웹 클라이언트 설정의 존재·문자 형식 |
| `HARU_KAKAO_CLIENT_ID`, `HARU_KAKAO_CLIENT_SECRET` | 카카오 REST API 키·Client Secret의 존재·문자 형식 |
| `HARU_KAKAO_OIDC_ENABLED` | 콘솔의 OIDC 확인에 대응하는 정확한 문자열 `true` |
| `HARU_NAVER_CLIENT_ID`, `HARU_NAVER_CLIENT_SECRET` | 네이버 앱 설정의 존재·문자 형식 |

`.env`·`.dev.vars`·임의 설정 파일을 자동으로 읽지 않으며 파일 인수도 받지 않는다. 네트워크·DB·브라우저를 사용하거나 설정을 저장하지 않는다. CLI 인수·소스·채팅·스크린샷에 실제 비밀값을 넣지 않는다. 실제 연결 단계에서는 관리하는 환경의 비밀 설정을 사용한다.

보고서는 키 이름과 판정만 보여 주고 ID·비밀값·잘못된 원점 원문·예외 스택을 출력하지 않는다. 검증한 공개 원점이 있으면 그 원점으로 만든 고정 제공자 콜백만 보여 준다. 이 검사기는 기존 서버보다 엄격하게 공백·제어문자·비정규 원점·루프백·로컬호스트 등을 거절하며, 형식 통과도 키의 유효성이나 제공자 콘솔 등록을 증명하지 않는다.

## 현재 실행 구성과의 차이

진단 대상 환경과 실제 서비스 실행 환경은 별개다. `dev:local`은 제공자 환경값을 읽지 않고, Worker는 제공자 키를 독립 API에 전달하지 않는다. Worker 준비 명령도 숨은 환경 파일과 임의 프로세스 값을 전달하지 않는다. 검사한 키가 현재 로컬 게임에 자동 적용되지는 않는다.

일반 신규 가입·독립 로그인·독립 재인증·실제 연령 확인은 계속 닫혀 있다. `selfClosure:false`, `selfRecoveryReady:false`도 유지한다. 본인 철회·삭제는 UI와 HTTP 모두 차단하고 본인 조회·내보내기 및 기존 가족의 확인된 권리 행사를 보존한다. 설정 검사로 이 제한을 해제하지 않는다.

## 제공자별 문서와 실제 확인의 차이

Context7을 먼저 조회하고 공식 원문을 대조했다. 아래는 문서 확인 결과이며 실제 앱 심사·키 등록·로그인 왕복 결과가 아니다.

| 제공자 | 공식 안내와 현재 처리 | 실제 연결 전에 남은 것 |
|---|---|---|
| Google | 공식 Security Bundle 문서는 Google Account 재인증 요청을 지원하지 않는다고 명시. 현재 Google 강제 재인증은 서버·클라이언트에서 차단하며 일반 로그인·계정 연결 코어만 보존 | 별도의 최근 본인 확인 방법 결정. 기존 요청의 `max_age=0`이나 새 ID 토큰을 재인증 성공으로 간주하지 않음 |
| 카카오 | REST 문서에 ID 토큰 `auth_time`과 `prompt=login` 안내. `prompt=login`은 카카오톡 인앱 브라우저 미지원 | 로그인·OIDC·콜백·Client Secret 설정, 브라우저별 재인증과 서명된 새 `auth_time` 확인 |
| 네이버 | 공식 가이드에 OIDC·`openid`·PKCE·`auth_type=reauthenticate` 안내 | 실제 ID 토큰의 서명된 `auth_time` 발행과 갱신 확인. 재인증 화면이나 새 access token만으로 최근 확인을 인정하지 않음 |

Google의 `auth_time`은 Google 계정에 마지막으로 인증한 시각이다. 공식 안내는 앱 게시·검증, Session age claims 활성화와 `claims` 요청을 요구한다. 이는 Google 계정의 강제 재인증 기능이 아니다. 이번에는 해당 추가 claims 요청이나 콘솔 설정을 활성화하지 않으며, 값이 없으면 세션 확인 시각을 NULL로 유지한다. 민감한 권한에 `iat`·세션 생성 시각·서버 현재 시각을 대신 쓰지 않는다.

공식 근거: [Google Security Bundle](https://developers.google.com/identity/siwg/security-bundle), [Google OIDC](https://developers.google.com/identity/openid-connect/openid-connect), [카카오 REST](https://developers.kakao.com/docs/ko/kakaologin/rest-api), [네이버 로그인 가이드](https://developers.naver.com/docs/login/devguide/devguide.md).

## 실제 연결 단계에서 남길 확인 결과

1. 최종 운영 원점과 제공자별 정확한 콜백·심사 상태·필요한 최소 권한을 확인한다. 현재 준비 주소는 운영 확정 주소가 아니다.
2. 허용된 시험 계정으로 승인·거절·취소·중복 콜백·로그아웃·재접속·기존 계정 연결을 검증한다. 가짜 성공이나 임의 신규 계정 생성으로 대신하지 않는다.
3. 지원 가능한 최근 확인 방법에서 실제 서명·계정·세션·인증 시각과 취소 경합을 검증한다. 토큰·비밀값·주체 원문을 보고서에 저장하지 않는다.
4. 실제 연령 확인·서버 가입 허가·개인정보 정책·권리 행사·보존/백업·예약 삭제·접근 제한을 별도로 검증한 뒤 공개를 결정한다.

현재 도구는 위 외부 검증을 실행하지 않는다. 상세 계약은 [소셜 로그인 준비](social-login-launch.md), [최근 본인 확인](reauthentication.md), [개인정보 운영](privacy-operations.md), 결과는 [최신 검증 기록](codex-verification-2026-10-20.md)을 따른다.
