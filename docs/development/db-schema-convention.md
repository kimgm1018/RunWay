# 물리 스키마 규칙과 마이그레이션 정책

> 상태: ID 생성·무결성·수정 시각 기준 반영(S15P31E105-170), 개발용 첫 Flyway 이력 구성(S15P31E105-174). 운영 적용은 별도 업무.

DB 구조와 변경 이력의 관리 기준이다. 현재 반영한 제약과 후속 결정을 구분한다.
전체 컬럼·제약은 [기준 SQL](../design/db/schema.sql), 역할·정책은 [ERD 설명](../design/db/erd.md)을 따른다.

## 1. 이미 결정된 기준

- DB 접근 기술: [Spring Data JPA](../adr/0008-spring-data-jpa.md)
- DB 구조 변경 이력 관리: [Flyway](../adr/0009-flyway-schema-migrations.md)
- 현재 합의된 매핑·DB 변경 원칙: [백엔드 컨벤션 6장](backend-convention.md#6-entity와-스키마-매핑)

위 결정은 유지한다. 기준 SQL의 격리 검증이 서비스용 마이그레이션 적용·Entity 매핑 완료를 뜻하지 않는다.

## 2. ID 생성과 타입

- 업무 테이블 PK는 `BIGINT GENERATED ALWAYS AS IDENTITY`, FK는 기존 BIGINT를 유지한다. DB가 ID를 생성하며 직접 지정은 기본 거부한다. 복원 등 예외 입력은 별도 절차로 검토한다. 현재 기준 스키마 테이블 수는 [ERD](../design/db/erd.md)를 따른다.
- JPA 구현은 DB 정의에 맞춰 `GenerationType.IDENTITY`로 매핑한다. 이번 작업에 Entity 구현은 포함하지 않는다. ID 번호의 빈칸을 오류로 취급하지 않고 이벤트 순서·실제 시각을 PK로 추정하지 않는다.
- 워치 UUID·원본 배치 ID는 서버 PK와 별개다. API의 UUID 초안을 이 규칙만으로 자동 변경하지 않는다.
- Enum은 PostgreSQL 명명 타입으로 선언하며 기존 허용 값을 유지한다. JPA Entity 작성 시 문자열 Enum과 PostgreSQL 타입의 실제 매핑을 통합 검증한다.
- 시각은 TIMESTAMPTZ, 공간 값은 기존 geography와 SRID 4326을 유지한다. PostGIS 확장 설치·존재 확인을 기준 SQL에 포함하되 운영 설치 권한은 배포 업무에서 정한다.

## 3. 무결성과 수정 시각

- UNIQUE·CHECK·복합 FK는 [ERD 7장](../design/db/erd.md#7-db가-보장하는-제약과-서비스-책임)의 조합을 따른다. 조회 후 저장만으로 중복을 방지했다고 취급하지 않는다. 충돌 시 사용자 응답·재시도 처리는 해당 API 계약에서 정한다.
- 기존 NULL 의미를 유지한다. 양수 목표와 0 이상 누적값을 구분하고 고도·경사를 일괄 양수로 제한하지 않는다. 확정된 크루 정원은 `crews.capacity`의 기존 NOT NULL과 `CHECK (capacity BETWEEN 1 AND 200)`으로 1~200명을 보장한다. 실제 승인 인원의 정원 초과 방지와 동시성 처리는 별도 서비스 책임이다. 생리 지표 등 미확정 정책을 CHECK에 넣지 않는다.
- 범위 검사 대상 NUMERIC은 `NaN`을 명시적으로 제외한다. 하한 비교만으로 NaN을 거부하지 못하는 PostgreSQL 특성을 반영하며 기존 NULL 허용을 유지한다.
- 크루 재가입은 회원·크루당 한 행을 갱신한다. 동기화 배치는 기기·클라이언트 배치 ID 조합을 유일하게 저장한다. 원본 이벤트 중복·스트림 순서 계약은 별도다.
- 기존 `updated_at` 컬럼은 DB의 `set_updated_at` 함수와 BEFORE UPDATE 트리거가 `clock_timestamp()`로 갱신한다. INSERT 기본값은 기존 `now()`를 유지한다. JPA 감사 기능이나 애플리케이션 코드가 같은 수정 시각을 중복 생성하지 않도록 매핑한다. DB 생성값의 Entity 재조회·반영은 Entity 구현에서 검증한다.
- 댓글은 동일 게시물 부모 복합 FK·자기 참조 금지 CHECK를 적용한다. 대댓글 깊이·리소스 소유권·정원 동시 승인·상태 전이는 별도 서비스 책임이다.

## 4. 실행·검증 경계

- `docs/design/db/schema.sql`은 빈 격리 DB의 기준 구조이며 반복 실행·운영 갱신용 스크립트가 아니다. 기존·공유·운영 DB에는 직접 적용하지 않는다.
- `SchemaIntegrityTest`는 Testcontainers의 PostgreSQL 17·PostGIS 3.6에서 기준 SQL을 직접 실행하고 삽입·수정의 허용/거부를 검증한다. 개발용 `.env`를 사용하지 않는다. 실행은 `backend`에서 `./gradlew test --tests '*SchemaIntegrityTest'`, 전체 완료 검증은 `./gradlew clean build`다. PowerShell은 `./gradlew.bat`를 쓴다.
- 서비스 V1은 `backend/src/main/resources/db/migration/V1__initial_schema.sql`에 있다.
  `BackendApplicationIntegrationTest`는 서비스 기동 시 V1 성공 이력과 26개 업무 테이블을 확인한다.
  `FlywayMigrationTest`는 재적용·데이터 보존·기존 DB 거부·변조 감지·실패 롤백 및 기준 SQL과
  실제 설치 구조의 정합성을 검증한다. Entity 매핑은 후속 기능 업무에서 검증한다.
- `erd.png`는 전체 테이블·관계선을 나타낸다. ID 생성·UNIQUE·CHECK·복합 FK·트리거의 정확한 정의는 SQL·ERD 설명을 따른다.

## 5. 이후 작성할 항목

| 항목 | 작성할 내용 | 상태 |
| --- | --- | --- |
| 이름 | 테이블·컬럼·제약·인덱스 명명 규칙 | 작성 대기 |
| 식별자와 타입 | BIGINT IDENTITY·Enum·시각·공간의 실제 JPA 매핑 검증 | DB 기준 반영, Entity 검증 대기 |
| NULL과 기본값 | 기존 NULL·기본값 유지, DB 수정 시각 갱신 | 기준 반영. 상태별 필수값 등은 후속 |
| 관계와 삭제 | 외래키·삭제 정책과 데이터 보존 기준 | 작성 대기 |
| 제약과 인덱스 | 승인한 UNIQUE·CHECK·복합 FK, 조회 목적별 인덱스 | 무결성 반영. 조회·공간 인덱스는 사용처별 후속 |
| DB 확장 | 확장 기능의 설치·권한·적용 책임 | 작성 대기 |
| 변경 파일 | Flyway 파일 위치·이름·번호와 병렬 작업 충돌 처리 | 7장 반영 |
| 적용과 복구 | 환경별 실행 시점·기존 DB 처리·실패 대응 | 개발 절차는 7장, 운영은 후속 |
| 검증 | 기준 SQL 생성·무결성, 기존 데이터 보존·변경 적용 테스트 | 기준 SQL 및 V1 격리 검증 구성. 운영 이행은 후속 |

## 6. 마이그레이션 업무에서 확인

- 변경이 정리된 [ERD](../design/db/erd.md)와 [기준 스키마](../design/db/schema.sql)의 합의 상태
- 실제 사용할 DB 환경과 버전, 기존 DB·보존할 데이터 유무
- 관련 API 계약 및 도메인·공통 기반 담당 범위

마이그레이션 업무에서 최신 합의·기존 DB를 확인한다. 적용된 이력은 덮어쓰지 않고 후속 버전으로 변경한다.
번호 충돌·실행 시점·실패 복구는 7장을 따르며, 기존 데이터를 삭제해 초기 구성하지 않는다.

## 7. Flyway 변경 적용과 복구

- 파일 위치는 `backend/src/main/resources/db/migration`, 이름은 `V<정수>__<설명>.sql`이다.
  첫 버전은 V1이며 현재 기준 스키마 전체를 설치한다. 미확정 API·추가 스키마를 임의 도입하지 않는다.
- 로컬은 개발자가 접속 대상과 빈 DB 여부를 확인한 뒤 서버를 실행하면 Flyway가 적용한다.
  기존 데이터·스키마가 있거나 출처가 불명확하면 중단한다. 이번 검증은 Testcontainers의
  새 DB만 사용하며 개인·공유·운영 DB의 상태 확인이나 데이터 이행을 대신하지 않는다.
- 버전은 단조 증가시키고 중복시키지 않는다. 작성 전 최신 `dev`와 진행 중인 DB 업무의
  예약 번호를 확인하고, 같은 번호가 생기면 담당자 간 조정 후 아직 공유 적용하지 않은 파일의
  번호를 변경한다. MR 전 최신 `dev`를 반영해 충돌·정합성과 전체 빌드를 다시 확인한다.
- 적용 이력은 `flyway_schema_history`에서 확인한다. 성공한 공유 적용 파일은 수정·삭제하지
  않고 새 버전으로 변경하며 기준 스키마도 같은 최종 구조로 갱신한다. 정합성 테스트는
  이후 버전까지 적용된 구조를 기준 스키마와 비교한다.
- 체크섬 불일치는 자동 `repair`로 지우지 않는다. 적용 원본을 확인·복원하고 필요한 구조
  변경은 후속 버전으로 작성한다. 실제 DB 상태가 불명확하면 원인·보존 데이터·복구안을 먼저 확인한다.
- 적용 실패 시 실행을 중단하고 적용 버전·트랜잭션 상태를 확인한다. PostgreSQL의 트랜잭션
  DDL은 격리 테스트로 롤백을 확인하지만 모든 SQL의 자동 복구를 보장하지 않는다. 공유 DB에
  부분 적용이 의심되면 별도 복구안을 검토한다. `clean`, 자동 baseline, 볼륨 삭제로 해결하지 않는다.
- 기존 DB를 Flyway 관리로 편입하거나 운영에 적용하는 주체·권한·백업·복구 절차는
  인프라 업무 S15P31E105-162 등 별도 승인 범위다. 로컬 검증 결과만으로 운영에 적용하지 않는다.

참고(2026-10-26, PostgreSQL 17): [IDENTITY](https://www.postgresql.org/docs/17/ddl-identity-columns.html),
[제약](https://www.postgresql.org/docs/17/ddl-constraints.html), [Enum](https://www.postgresql.org/docs/17/datatype-enum.html),
[트리거](https://www.postgresql.org/docs/17/plpgsql-trigger.html). Context7의 `/websites/postgresql_17`로 버전 일치 문서를 조회했다.
