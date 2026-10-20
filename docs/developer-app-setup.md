# 로그인 제공자 앱 등록

2026-10-20. 개발자 앱은 하루다섯의 소셜 로그인을 제공자에게 등록하는 설정이며 별도의 휴대전화 앱을 만드는 작업이 아니다. Context7을 먼저 조회하고 아래 공식 문서의 최신 콘솔 경로를 대조했다. 실제 비밀키·토큰은 이 문서나 채팅에 기록하지 않는다.

## 현재 준비 상태

| 제공자 | 확인한 준비 | 아직 남은 연결 |
|---|---|---|
| 카카오 | 사용자가 `하루다섯` 앱 생성과 카카오 로그인·OpenID Connect ON을 완료했다고 알림 | 대표 도메인·리다이렉트 URI·서버 secret 설정·실제 왕복 검증 |
| Google | 사용자가 `harufive` 프로젝트·기본 브랜딩·본인 테스트 사용자와 안내한 웹 클라이언트 생성을 완료했다고 알림 | 실제 주소 확보 뒤 리다이렉트 URI 대조·서버 secret 설정·실제 왕복 검증 |
| 네이버 | 사용자가 `하루다섯` 앱 생성을 완료했다고 알림 | 실제 주소 확보 뒤 서비스/Callback URL 대조·서버 secret 설정·실제 왕복·공개 전 검수 |

위 완료 상태는 사용자 보고이며 콘솔 화면을 도구로 읽어 재검증한 결과는 아니다. Cloudflare 및 카카오 화면 접근은 브라우저 도구의 저장된 사이트 권한에서 차단됐다. 다른 경로로 콘솔 접근을 우회하지 않았다. 신규 가입·로그인 성공과 앱 등록을 구분한다.

## 카카오

[앱 관리](https://developers.kakao.com/console/app)에서 개발자 계정 등록 뒤 앱을 생성한다. 이름은 `하루다섯`, 개인 개발자의 회사명은 서비스 출처를 나타내는 `하루다섯`, 카테고리는 게임에 해당하는 항목을 사용한다. 아이콘은 생략 가능하다. 대표 도메인은 실제 서비스 주소를 확인한 뒤 입력한다. [공식 생성 안내](https://developers.kakao.com/docs/ko/tutorial/start)

앱의 **카카오 로그인 → 사용 설정 → ON**, **카카오 로그인 → OpenID Connect → ON**으로 설정한다. REST API 키의 Client Secret은 자동 활성화되는 현재 정책을 유지하고 불필요하게 재발급하지 않는다. 추가 개인정보 동의항목·유료 API·카카오싱크를 임의로 켜지 않는다. [공식 설정 안내](https://developers.kakao.com/docs/ko/kakaologin/prerequisite)

## Google

[Cloud 콘솔](https://console.cloud.google.com/)에서 `harufive` 프로젝트를 만들고 **Google Auth Platform → Branding → 시작하기**에서 표시 이름 `하루다섯`, 지원·연락 이메일 `limjm900202@gmail.com`, 대상 `External`을 설정한다. 정책은 운영자가 직접 검토한다. **Audience → 테스트 사용자**에 본인 Google 계정을 추가하고 개발 단계는 Testing으로 유지한다. 결제 계정·무료 체험 가입을 진행하지 않는다. [공식 동의 화면 안내](https://developers.google.com/workspace/guides/configure-oauth-consent)

주소 확보 뒤 **Clients → Create client → Web application**에서 로그인용 웹 클라이언트를 만든다. 서버 인증 방식은 정확한 Authorized redirect URI가 필요하다. 클라이언트 비밀값은 최초 생성 뒤 다시 조회하지 못할 수 있으므로 운영자가 안전한 비밀 저장소에 보관하고 서버 secret으로 직접 설정한다. 일반 채팅·소스 트리·ZIP에 붙이지 않는다. [웹 서버 인증 안내](https://developers.google.com/identity/protocols/oauth2/web-server)

## 네이버

[개발자센터](https://developers.naver.com/apps/)에서 **Application → 애플리케이션 등록**을 선택한다. 최초 약관 확인·계정 정보·휴대전화 인증은 운영자가 직접 완료한다. 이름은 `하루다섯`, 사용 API는 `네이버 로그인`, 우선 웹 서비스 환경을 등록한다. 웹 환경별 서비스 URL과 Callback URL을 요구하므로 확보한 주소를 사용한다. [공식 등록 안내](https://developers.naver.com/docs/common/openapiguide/appregister.md)

개발이 완료되어 일반 이용자에게 제공하기 전 네이버 로그인 검수가 필요하다. 앱 생성·허용된 테스트 계정의 성공과 일반 공개 승인을 구분한다. [공식 로그인 가이드](https://developers.naver.com/docs/login/devguide/devguide.md)

## 주소와 비밀 설정

현재 시험 원점은 `https://harufive-preview.limjm900202.workers.dev`다. **2026-10-21 사용자가 보호된 정적 번들 배포와 비밀번호 입장을 완료했다.** 이제 서버 원점과 제공자 콘솔의 복귀 주소를 대조한다. 비밀번호로 보호한 시험 사이트이며 공개 서비스 홈페이지나 제공자 로그인 왕복 검증 완료를 뜻하지 않는다.

| 제공자 | 확보한 원점에 붙일 복귀 경로 | 서버 설정 이름 |
|---|---|---|
| 카카오 | `/api/auth/kakao/callback` | `HARU_KAKAO_CLIENT_ID`, `HARU_KAKAO_CLIENT_SECRET`, `HARU_KAKAO_OIDC_ENABLED=true` |
| Google | `/api/auth/google/callback` | `HARU_GOOGLE_CLIENT_ID`, `HARU_GOOGLE_CLIENT_SECRET` |
| 네이버 | `/api/auth/naver/callback` | `HARU_NAVER_CLIENT_ID`, `HARU_NAVER_CLIENT_SECRET` |

실제 키는 운영자가 서버의 비밀 설정에 직접 입력한다. 설정 검사나 제공자 앱 등록만으로 연령 확인·신규 가입을 열지 않는다. 별도 연결용 Worker는 기존 계정의 정확한 제공자 신원 연결만 받아들이므로 **새 DB에서 첫 이용자를 만드는 경로는 별도의 가입 허가 설계가 필요하다.** [연결용 시험본](connected-preview.md)과 [인증 점검](auth-connection-checklist.md)을 따른다.
