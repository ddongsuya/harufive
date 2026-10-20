# 로컬 개발과 독립 서버 어댑터

## 실행

`package.json`이 있는 게임 폴더에서 실행한다. Node 22.16.0 이상인 22.x 또는 Node 24 이상이 필요하며 Node 24를 권장한다. 23.x는 지원 대상으로 선언하지 않는다. 검증한 현재 PC는 Windows + Node 24.13.0 / npm 11.10.0이다.

```sh
npm run install:ci
npm run check
npm test
npm run build
npm run db:local
npm run dev:local
```

마지막 명령은 `http://127.0.0.1:5174`에서 현재 게임의 공개 화면과 API를 실행한다. 같은 컴퓨터에서 접속한다. 종료는 실행한 창에서 Ctrl+C다. 포트가 사용 중이면 `HARU_LOCAL_PORT`를 지정할 수 있다. 서버 바인딩은 항상 127.0.0.1이고 Host도 실제 포트와 일치해야 한다.

`npm run dev`·`npm run build`·`npm start`는 기존 Sites/Vinext 경로로 남아 있다. `dev:local`은 현재 공개 JS·CSS·도트 자산과 동일한 게임/인증 서비스를 재사용하는 별도 Node 미리보기다. React/Vinext의 렌더링, Cloudflare Workers의 실행 제한, 실제 D1 성능까지 대체하는 환경은 아니다.

## 데이터

- `.local/haru-five.sqlite`는 이 PC의 개발 전용 파일이며 Git에서 제외한다. 실제 운영 DB를 읽거나 가져오지 않는다.
- `drizzle/*.sql`을 이름순으로 트랜잭션 적용하고 `local_schema_migrations`에 파일명·해시만 기록한다. 두 번째 실행에서 같은 SQL을 반복 적용하지 않는다.
- 이미 적용한 SQL을 수정하거나 삭제하면 시작을 거부한다. 새 마이그레이션을 추가하고 보존된 DB에서 검증한다. 실패한 배치는 전부 롤백한다.
- `local_schema_migrations`는 로컬 어댑터 전용이다. 운영 Drizzle 스키마나 D1에 새 테이블을 적용한 것이 아니다.
- 로컬 DB에도 향후 시험 자료가 생길 수 있으므로 공유 파일·공개 자산·로그에 넣지 않는다. 이 명령은 데이터 초기화 명령을 제공하지 않는다.

## 인증과 화면

로컬 서버는 운영 환경 변수나 `.env`의 실제 제공자 비밀값을 읽지 않는다. 자체 세션을 검사하지만 세션을 자동 발급하거나 시험 사용자를 생성하지 않는다. `__Host-` 쿠키의 Secure 속성과 HTTPS 운영 원점 요구를 약화하지 않는다. 따라서 브라우저에서는 준비 중인 카카오·Google·네이버와 문의·출시 안내를 확인한다. 기능 검증은 `tests/standalone-http.test.mjs`와 기존 서버/화면 통합 테스트의 격리된 가상 자료로 수행한다.

독립 어댑터가 반환한 `sites.enabled=false`에 따라 ChatGPT 로그인 UI를 숨긴다. 상태 정보가 없을 때도 해당 버튼은 숨긴다. 기존 Sites 어댑터는 명시된 플랫폼 기능을 유지한다. 독립 API는 임의 Sites 헤더, `__Host-haru_session=sites`, 호출 옵션에 잘못 섞인 Sites ID를 계정 근거로 사용하지 않는다.

신규 가입은 독립 어댑터가 항상 닫는다. 이 제한을 해제할 때는 환경 변수만 바꾸지 않고 연령 분기·동의·가입 허가를 실제 서버 계약에 연결해야 한다. `guardianReady=false`를 유지한다.

## 독립 호스팅에 연결할 다음 단계

`handleStandaloneRequest(request, { db, env })`가 플랫폼에 독립적인 API 진입점이다. Worker 등의 실제 진입점에서 검증한 DB와 서버 비밀 설정만 전달한다. `getChatGPTUser()`나 외부 인증 헤더를 넘기지 않는다. 이 어댑터는 API 처리용이며 정적 자산 배포·호스트 계약·운영 DB 바인딩을 만들지 않는다.

1. 운영 호스트·도메인·DB를 선택하고 기존 Sites 빌드와 구분된 설정을 추가한다.
2. 새 공개 원점을 `HARU_AUTH_ORIGIN`에 설정하고 세 제공자 콜백을 등록한다.
3. 실제 세션 발급·로그아웃·계정 연결·취소를 해당 HTTPS 원점에서 검증한다.
4. 보호자 동의·계정 허가·권리 행사·예약 삭제를 구현한 후에만 가입 허용을 검토한다.

운영 제공자 키나 DB는 이 문서에 붙여 넣지 않는다. 실제 소셜 로그인·모바일 기기·D1·예약 작업·백업 복원은 아직 확인하지 않았다.
