# 독립 Worker 로컬 준비

2026-10-20. 이 구성은 Cloudflare Workers + D1 후보의 **PC 내부 검증용**이다. 실제 Cloudflare 계정·운영 DB·도메인·예약 작업·결제를 연결하거나 배포하지 않았다. 호스팅 비용과 계약 조건은 [월 예산 검토](hosting-budget.md)를 따른다.

## 실행

프로젝트 폴더에서 기존 의존성을 사용한다. 현재 검증 환경은 Windows / Node 24.13.0 / Wrangler 4.92.0이다.

```sh
npm run build:worker
npm run db:worker
npm run dev:worker
```

- `build:worker`: 공개 파일을 준비하고 Wrangler `deploy --dry-run`으로 번들만 만든다. 출력의 `Total Upload`는 크기 표시이며 실제 업로드 결과가 아니다.
- `db:worker`: 별도 로컬 D1에 기존 0000~0005 마이그레이션을 적용한다. 다시 실행하면 적용된 SQL을 반복 실행하지 않는다.
- `dev:worker`: **http://127.0.0.1:8787**에서 로컬 Worker를 실행한다. 종료는 Ctrl+C다. 외부 연결이나 로컬 HTTPS 소셜 인증을 제공하지 않는다.

기존 `dev:local`의 5174 미리보기, `.local/haru-five.sqlite`, 기존 Sites 빌드·설정은 별도로 유지한다. Worker의 시험 DB는 `.local/standalone-worker/state`, 자산은 `public`, 번들은 `bundle` 하위에 둔다. 이 폴더를 운영 자료나 공유 ZIP에 포함하지 않는다.

## 공개 파일과 요청 경계

`server/worker.mjs`는 `/api` 및 `/api/*`를 기존 독립 HTTP 어댑터로 보낸다. Sites 헤더·사용자 정보는 인증 근거로 쓰지 않는다. `DB` 바인딩과 검증할 공개 원점만 사용하며 공급자 비밀키·보호자 설정·임의 환경 변수를 기존 서비스에 전달하지 않는다.

공개 파일은 `server/standalone-assets.mjs`의 명시 목록에 한정한다. HTML·부트 파일과 게임의 공개 JS·CSS·SVG **14개**를 준비하며 문제은행·서버 소스·DB·환경 파일·소스맵은 포함하지 않는다. 예상하지 못한 파일이나 링크가 생성 폴더에 있으면 지우는 대신 준비를 중단한다.

루트만 생성된 `index.html`로 매핑한다. 정적 파일은 GET/HEAD만 허용하며 나머지 경로에는 404를 반환한다. SPA fallback이 API나 비공개 경로를 덮지 않는다. 정적 저장소에는 쿠키·Authorization·Sites 헤더를 넘기지 않는다. CSP·프레임 제한·nosniff·no-store 등을 응답에 적용한다.

준비 설정에는 운영 원점이 없다. 이때는 loopback 요청만 받는다. 향후 코드 경계에서 유효한 `HARU_AUTH_ORIGIN`을 전달하면 HTTPS 원점과 모든 요청을 비교한다. 현재 CLI의 고정 설정 검사는 이 운영 설정을 연결하는 경로를 제공하지 않는다. 원점 지정만으로 회원가입·로그인이 열리는 것도 아니다.

## 고정된 로컬 설정

`wrangler.standalone.jsonc`의 주요 준비 값:

| 설정 | 값과 의미 |
|---|---|
| Worker 원본 | `server/worker.mjs` |
| compatibility date | `2026-05-15`, 설치된 workerd 버전에 맞춤 |
| workers.dev / preview URL | 둘 다 비활성 |
| D1 | 로컬 placeholder ID, `remote:false` |
| Assets | 생성된 공개 폴더만, `run_worker_first:true`, HTML 자동 처리·fallback 없음 |
| CPU | 요청당 10ms. 월 과금 상한 아님 |
| 관찰 로그·예약 작업 | 원격 Observability 비활성, cron 없음 |
| 가입·인증 | 등록 false, 독립 서비스 로그인·재인증 false 유지 |

`scripts/standalone-worker.mjs`는 `build`, `dry-run`, `db`, `dev` 네 모드만 받는다. 추가 인수·원격 명령·실제 deploy 모드는 거절한다. 설정 경로·빈 env 파일·local 플래그·로컬 상태 경로를 고정한다. 자식 프로세스에는 필요한 OS 환경만 전달하므로 부모의 인증키·Cloudflare 토큰·NODE_OPTIONS는 가져가지 않는다. 명시한 빈 `--env-file`로 `.dev.vars` 탐색을 건너뛰며 dotenv와 임의 프로세스 값의 바인딩도 끈다.

직접 Wrangler 실행은 준비용 build gate에서 기본 거절한다. 이 검사는 **실수로 배포 명령을 실행하는 것을 줄이는 장치**다. 소스·환경·CLI를 수정할 수 있는 사람의 의도적인 실행을 막는 보안 경계라고 주장하지 않는다. 실제 운영 구성은 별도의 검토된 계정·DB·원점·접근 제한·권한을 마련한 뒤 작성해야 한다.

## 확인한 결과와 남은 범위

- 전체 **349개 테스트**, 구문·타입 검사, 기존 Sites 5단계 빌드 통과.
- 새 Worker 경계 테스트 7개는 전체 수에 포함.
- Wrangler dry-run 통과: 번들 272.02 KiB, gzip 65.19 KiB. 계정 인증·업로드 없음.
- 실제 로컬 D1 마이그레이션 6개 적용 성공. 시험 서버 종료 후 재실행 시 추가 적용 없음.
- 실제 로컬 HTTP에서 공개 파일 14개, GET/HEAD, 금지 메서드, DB ready, 익명 상태, 닫힌 가입·인증, 위조 Sites 헤더의 401, 비공개/알 수 없는 9개 경로의 404 확인.

위 실행으로 실제 소셜 인증·보호자 관계·아동 가입·운영 D1·CPU/사용량·원격 접근 제어·공개 배포가 검증된 것은 아니다. 이번 새 Worker의 브라우저 화면·실기기 검수는 추가로 하지 않았다. 시험 서버는 검증 후 종료했고 기존 5174 미리보기를 유지했다.

현재 가입·이용은 만 14세 이상이다. 실제 연령 확인·가입 허가·제공자 지원과 계약, 폐쇄 계정 권리 행사, 보관/백업 정책·운영 예약 삭제가 남아 있다. 신규 아동 가입·보호자 연결은 제외하고 기존 가족의 권리 행사와 정리는 유지한다. `guardianReady:false`, `selfRecoveryReady:false`, 본인 탈퇴·삭제 비활성을 유지한다. 소스 준비를 가입 개통으로 표시하지 않는다. [연령 정책](age-eligibility.md)을 따른다.

## 참고한 공식 문서

Context7을 먼저 조회하고 설치된 Wrangler 구현과 대조했다.

- [Wrangler 명령](https://developers.cloudflare.com/workers/wrangler/commands/)
- [정적 자산의 Worker 우선 실행](https://developers.cloudflare.com/workers/static-assets/routing/worker-script/)
- [D1 마이그레이션](https://developers.cloudflare.com/d1/reference/migrations/)
- [Workers 로컬 환경 변수](https://developers.cloudflare.com/workers/development-testing/environment-variables/)
