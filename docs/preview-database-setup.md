# 시험용 D1 저장소 연결

2026-10-21. 사용자는 `harufive-preview-db` 생성을 완료했다고 알렸다. 원격 관리 콘솔은 도구의 사이트 접근 제한 때문에 읽거나 수정하지 않았다. 아래는 새 빈 시험 DB에 사용자가 직접 적용할 절차다.

## 준비 파일

`npm run db:preview-files`는 기존 0000~0005 마이그레이션을 메모리 SQLite에 적용한 뒤 최종 테이블·인덱스 정의를 추출한다. 외부 접속이나 비밀값 접근은 없으며 `.local/connected-preview/`에 다음 파일을 만든다.

1. `initial-schema.sql`: 최종 앱 테이블 18개·인덱스와 Wrangler 적용 이력 표를 생성한다. 기존 테이블 삭제·재구성·데이터 입력·IF NOT EXISTS를 사용하지 않는다. 외래 키의 ON DELETE/UPDATE 선언은 보존한다.
2. `record-migrations.sql`: 모든 테이블·인덱스의 저장된 SQL 정의가 정확히 일치하고 앱 표가 비어 있는지 검사한 뒤 여섯 마이그레이션 이름을 기록한다. 조건이 틀리면 NOT NULL 제약으로 해당 INSERT 전체가 실패한다. 이력 열은 설치된 Wrangler 4.92.0과 동일하다.
3. `verify-schema.sql`: 표 수, 여섯 이력, 앱 표별 데이터 수, 외래 키 오류를 읽기 전용으로 확인한다.
4. `setup-database.sql`: 위 1~3번을 순서대로 합친 한 번 붙여넣기용 파일이다. 개별 파일 적용과 합본 적용 중 하나만 사용한다.
5. `schema-manifest.json`: 원본 마이그레이션과 생성 파일의 SHA-256을 기록한다.

기존 운영 DB·로컬 개발 DB에 적용하지 않는다. 이 초기화는 기존 자료 이전이나 백업 복원이 아니다. 일반 가입·첫 운영자 계정·게임 데이터도 생성하지 않는다.

## 대시보드 적용

1. **Storage & databases → D1 SQL Database → harufive-preview-db**를 선택한다. 새 DB가 맞는지 확인한다.
2. **Console**에서 아래 읽기 전용 검사로 비어 있는지 확인한다. D1 내부 `_cf_KV`, `_cf_METADATA`는 제외한다. 다른 표가 있으면 초기화 파일을 적용하지 않고 상태를 먼저 확인한다.

   ```sql
   SELECT name FROM sqlite_master
   WHERE type = 'table' AND name NOT LIKE 'sqlite_%'
   AND name NOT IN ('_cf_KV', '_cf_METADATA');
   ```

3. `initial-schema.sql` 전체를 Console에 붙여 넣고 **Execute**한다. 성공 결과를 확인한다.
4. 이전 입력을 지우고 `record-migrations.sql` 전체를 붙여 넣어 **Execute**한다.
5. `verify-schema.sql`을 실행한다. `app_tables=18`, 이력 6개, 모든 앱 데이터 수 0, 외래 키 오류 없음이 기대 결과다.

처음부터 합본 `setup-database.sql`을 한 번 실행해도 같은 순서로 적용된다. 이 경우 3~5번 개별 파일을 다시 실행하지 않는다. 마지막 결과의 `status=HARUFIVE_SCHEMA_READY`, `app_tables=18`, `migration_entries=6`, `saved_rows=0`을 확인한다.

Console의 여러 문장 전체를 하나의 원자적 작업으로 가정하지 않는다. 오류가 나면 전체 파일을 반복 실행하지 않고 성공한 부분과 오류를 확인한다. 오류를 무시하거나 기존 표를 삭제해 맞추지 않는다. 정확한 정의 비교는 콘솔이 SQL을 변경한 경우에도 실패하므로 이때 이력을 수동으로 강제 기록하지 않는다.

## Worker 연결

초기화 확인 뒤 **Workers & Pages → harufive-preview → Settings → Bindings → + Add binding**에서 **D1 database**를 선택한다. 사용자 화면의 실제 위치를 우선하며 새 UI에서는 별도 Bindings 탭일 수 있다. 변수 이름은 **`DB`**, 데이터베이스는 **`harufive-preview-db`**로 지정한다.

현재 배포된 정적 번들은 DB를 전달하지 않는다. 바인딩만 추가해서는 연결 안내가 사라지지 않는다. 검증한 `.local/connected-preview/worker.mjs`를 Edit code에 적용해야 한다. 기존 `HARU_PREVIEW_PASSWORD` secret을 유지한다. 로컬 설정 파일의 0으로 된 DB ID·`remote:false`는 로컬 검사 전용이므로 실제 배포 설정으로 복사하지 않는다.

JS 코드 붙여넣기는 Wrangler 설정을 적용하지 않는다. 대시보드의 Logs·Preview URLs·CPU 한도·runtime 설정은 별도로 대조해야 한다. 이전 사용자 스크린샷에서 Logs는 켜져 있었으므로 코드의 observability:false와 같다고 주장하지 않는다.

저장소 연결 후에도 실제 제공자 키·콜백 검증과 첫 계정 가입 허가가 남는다. 임의의 회원 데이터를 SQL로 넣어 로그인을 통과시키지 않는다. [연결 시험본](connected-preview.md)을 따른다.

## 근거

Context7을 먼저 확인했다. 공식 [D1 시작 안내](https://developers.cloudflare.com/d1/get-started/)는 Create Database → Create, Console의 여러 SQL → Execute, Worker DB 바인딩 절차를 제공한다. [가져오기 안내](https://developers.cloudflare.com/d1/best-practices/import-export-data/)와 [외래 키 안내](https://developers.cloudflare.com/d1/sql-api/foreign-keys/)에 따라 BEGIN/COMMIT이나 foreign_keys=OFF를 초기화본에 추가하지 않는다. [마이그레이션 이력](https://developers.cloudflare.com/d1/reference/migrations/)은 Console SQL과 별도로 일치시킨다.
