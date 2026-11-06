# RunWay 백엔드

Java 21·Spring MVC 기반의 실행·테스트 초기 구성과 서비스용 Flyway 마이그레이션 V1을 포함한다.
크루·게시글·댓글 API는 공통 JWT 인증을 사용한다. 문서 접속 인증과 회원 API 인증은 구분한다.

## 1. 준비와 버전

| 항목 | 설정 |
| --- | --- |
| Java | 21. 개발 확인 환경: Eclipse Temurin 21.0.12.1 |
| Spring Boot | 4.1.1 |
| Gradle | 9.8.2, 저장소 Wrapper 사용. 별도 설치 불필요 |
| 개발·테스트 DB | PostgreSQL 17 + PostGIS 3.6, `postgis/postgis:17-3.6` |
| 기타 의존성 | Spring Boot BOM이 관리하는 버전. `build.gradle` 참고 |

Docker Desktop의 **Linux 컨테이너 엔진**을 실행한다. `docker version`에서 Client뿐 아니라
Server도 표시되어야 DB 통합 테스트와 개발 DB를 실행할 수 있다. 초기 다운로드에는 인터넷이 필요하다.
DB 이미지 태그는 패치 업데이트될 수 있다. 운영 이미지·버전 고정 정책은 배포 구성에서 정한다.

이 문서의 명령은 **`backend` 디렉터리에서** 실행한다.

## 2. IntelliJ에서 열기

1. `backend/build.gradle`을 Gradle 프로젝트로 연다.
2. Project SDK와 Gradle JVM을 Java 21로 지정하고 Gradle은 Wrapper를 사용한다.
3. 빌드·테스트 실행 도구를 Gradle로 지정한다. Lombok은 Gradle의 annotation processor로 처리한다.
4. `com.runway.backend.BackendApplication`의 실행 구성을 만든다. 작업 디렉터리는 `backend`로 지정한다.
5. 아래 DB 준비 후, 실행 구성의 **환경변수**에 `BACKEND_DB_URL`, `BACKEND_DB_USERNAME`,
   `BACKEND_DB_PASSWORD`를 로컬에서 입력한다. 실행 구성을 프로젝트 파일로 공유하지 않는다.

IntelliJ UI에서 직접 실행한 결과와 Wrapper 검증은 별개다. 프로젝트를 열었다는 사실만으로
전체 빌드·DB 테스트를 통과한 것은 아니다.

## 3. 개발 DB 준비

`.env.example`을 개인 `.env`로 복사하고 **사용자가 직접** 비밀번호를 입력한다.
기존 `.env`가 있으면 덮어쓰지 않는다. 실제 `.env`와 내용을 AI에게 전달하지 않는다.

PowerShell:

```powershell
if (!(Test-Path .env)) { Copy-Item .env.example .env }
docker compose --env-file .env up -d --wait db redis
docker compose --env-file .env ps
```

Bash:

```bash
test -e .env || cp .env.example .env
docker compose --env-file .env up -d --wait db redis
docker compose --env-file .env ps
```

| 변수 | 필수 여부·용도 |
| --- | --- |
| `BACKEND_DB_URL` | 서버 필수. 예: `jdbc:postgresql://localhost:5432/runway`. 인증정보를 URL에 넣으면 기동 전에 거부한다. |
| `BACKEND_DB_USERNAME` | 서버·Compose 필수. 개발 DB 사용자 이름 |
| `BACKEND_DB_PASSWORD` | 서버·Compose 필수 Secret. 예시 파일에는 빈 값만 둔다. |
| `BACKEND_DB_NAME` | Compose 필수. URL 마지막의 DB 이름과 일치시킨다. |
| `BACKEND_DB_PORT` | Compose 선택, 기본 5432. 변경하면 서버 URL 포트도 바꾼다. |
| `BACKEND_BIND_ADDRESS` | 서버 선택, 기본 `127.0.0.1`. 빈 값이면 기동을 거부한다. 외부 기기 연결은 인증·접근 범위 검토 후 별도 구성 |
| `BACKEND_PORT` | 서버 선택, 기본 8080 |
| `BACKEND_DB_CONNECTION_TIMEOUT_MS` | 서버 선택, 기본 5000. 연결 풀에서 DB 연결을 얻을 때까지 기다리는 상한(밀리초 정수). 연결 생존 검사 2초보다 커야 하므로 2001 이상을 쓴다. 넘으면 503 |
| `BACKEND_DB_LOCK_TIMEOUT_MS` | 서버 선택, 기본 5000. 잠금 1회의 대기 상한(PostgreSQL `lock_timeout`, 밀리초 정수). 행 잠금뿐 아니라 advisory lock·DDL의 테이블 잠금 대기에도 적용된다. 넘으면 503 |
| `BACKEND_DB_STATEMENT_TIMEOUT_MS` | 서버 선택, 기본 10000. 쿼리 1건의 실행 상한(PostgreSQL `statement_timeout`, 밀리초 정수, 잠금 대기 포함). 소켓 상한보다 작아야 한다. 넘으면 503 |
| `BACKEND_DB_SOCKET_TIMEOUT_S` | 서버 선택, 기본 15. DB 무응답·네트워크 단절 시 응답을 기다리는 소켓 읽기 상한(초 정수). 쿼리 실행 상한보다 길게 둔다 |
| `BACKEND_AI_BASE_URL` | 서버 선택, 기본 빈 값. HR 추론 AI 서버 origin(예: `http://ai:8000`). AI04 실시간 코칭, AI06 심박 개인화, AI05 코스 구간 난이도 비율 계산(S15P31E105-297)이 함께 쓴다(아래 AI06 설명 참조). 경로·쿼리·사용자 정보는 넣지 않으며 잘못된 값이면 기동을 거부한다. 비면 기동은 하고 자동 코칭과 코스 구간 비율 계산을 하지 않는다 |

DB 대기 상한(S15P31E105-294)은 DB 장애·잠금 경합에서 요청 스레드가 무한히 쌓이지 않고 `503 SERVICE_UNAVAILABLE`을
돌려주기 위한 값이다. 연결 획득 5초·잠금 대기 5초·쿼리 10초·소켓 15초가 기본이다.

- 각 값은 **대기 지점 1회의 상한**이며 요청 전체의 상한이 아니다. 연결 획득은 마지막 생존 검사(2초)만큼 늦어져
  최대 약 7초가 걸릴 수 있다. 한 요청이 여러 잠금을 차례로 잡거나 여러 쿼리를 실행하면 대기가 더해진다
  (예: 그룹런 세션 삭제는 그룹런 → 세션 → 게시물 순서로 잠근다). 따라서 앱·워치 HTTP 타임아웃(통상 10~15초)보다
  항상 먼저 503이 온다고 보장하지 않으며, 클라이언트는 응답 없이 끊긴 요청을 기존 규칙대로 재조회로 판단한다.
- 일반적인 장애 시 응답 시간: DB 중지(연결 거부)는 즉시~약 7초, DB 무응답은 약 7초 또는 이미 실행 중인 쿼리는 약 15초,
  잠금 경합은 약 5초, 느린 쿼리는 약 10초다.
- `0`은 즉시가 아니라 **무제한(비활성)**이다. 상한을 끄려는 경우가 아니면 0을 쓰지 않는다. 빈 값은 기동이 실패한다.

- 잠금·쿼리 상한은 pgjdbc `options`로 연결 생성 시 서버 세션 설정에 넣는다. `BACKEND_DB_URL`에 `options`를
  넣으면 URL 값이 우선해 이 설정이 빠지므로 URL에 넣지 않는다.
- 트랜잭션 안의 `SET LOCAL lock_timeout`(예: 회원·프로필 잠금 2초)은 이 기본값보다 우선한다.
- Flyway 마이그레이션도 같은 상한을 받는다. 오래 걸리는 마이그레이션은 스크립트 안에서
  `SET LOCAL statement_timeout`·`SET LOCAL lock_timeout`으로 해당 트랜잭션만 늘린다. 15초를 넘는 단일 쿼리는
  소켓 상한에서도 끊기므로 그 마이그레이션을 실행하는 기동에서만 `BACKEND_DB_SOCKET_TIMEOUT_S`를 함께 올린다.
- 정상 부하에서 연결 풀(기본 10개)이 일시적으로 꽉 차도 5초 안에 연결을 돌려받으면 503이 나지 않는다.
- 잠금·쿼리 값은 `options` 문자열에 그대로 들어가므로 숫자만 넣는다.
- 배포용 `infra/backend/compose.yaml`은 이 변수들을 아직 전달하지 않는다. 공유 서버에서 기본값을 바꾸려면 인프라
  담당자가 compose의 환경변수 매핑을 추가해야 한다.

Compose는 `--env-file .env`에서 값을 읽으며 같은 이름의 셸 환경변수가 있으면 셸 값이
우선한다. **Spring Boot와 IntelliJ는 이 `.env`를 자동으로 읽지 않는다.** 서버 실행에는
IntelliJ 실행 구성 또는 실행할 터미널의 환경변수로 같은 값을 별도 주입한다.
Spring 표준 설정의 우선순위가 적용되므로 별도의 `SPRING_DATASOURCE_*`나 명령행 옵션으로
DB 설정을 중복 지정하지 않는다. 비밀번호를 명령행 인수·공유 실행 구성에 넣지 않는다.

DB 포트는 `127.0.0.1`에만 공개하며 데이터는 `runway-backend-local` 프로젝트의 named volume에
보존한다. 이 설정의 DB 사용자는 로컬 초기화용 관리자이므로 운영 계정으로 사용하지 않는다.
이미 데이터가 있는 볼륨에서는 `.env`의 사용자·비밀번호·DB 이름을 바꿔도 기존 DB가 자동 변경되지 않는다.
접속 실패를 해결하려고 볼륨을 삭제하지 말고 기존 설정과 변경 절차를 확인한다.

## 4. 서버 실행·종료

IntelliJ에서는 위 환경변수를 지정한 `BackendApplication`을 실행한다.
터미널에서는 동일 변수를 세션 환경에 주입한 후 아래 명령을 사용한다. 비밀번호를 직접
명령에 적는 대신 입력창을 사용한다. 실제 값은 사용자가 로컬에서 입력한다.

PowerShell 예시:

```powershell
$env:BACKEND_DB_URL = 'jdbc:postgresql://localhost:5432/runway'
$env:BACKEND_DB_USERNAME = 'runway_dev'
$localDbSecret = Read-Host '개인 개발 DB 비밀번호' -AsSecureString
$env:BACKEND_DB_PASSWORD = [System.Net.NetworkCredential]::new('', $localDbSecret).Password
try { .\gradlew.bat bootRun }
finally { Remove-Item Env:BACKEND_DB_PASSWORD -ErrorAction SilentlyContinue; $localDbSecret.Dispose() }
```

Bash 예시:

```bash
export BACKEND_DB_URL=jdbc:postgresql://localhost:5432/runway
export BACKEND_DB_USERNAME=runway_dev
read -r -s -p '개인 개발 DB 비밀번호: ' BACKEND_DB_PASSWORD
echo
export BACKEND_DB_PASSWORD
./gradlew bootRun
unset BACKEND_DB_PASSWORD
```

URL·사용자 이름은 개인 `.env`의 설정과 맞춘다. 정상 기동은 `Started BackendApplication`으로
확인한다. 루트 경로는 업무 API에 매핑하지 않으므로 무인증 요청의 404는 예상된 결과다. 테스트 전용
`/__test/echo`는 실행 JAR에 포함되지 않는다. 서버는 IntelliJ 종료 버튼 또는 Ctrl+C로 종료한다.

OpenAPI·Swagger UI는 springdoc-openapi로 제공한다. 서버 기동 후 로컬에서
`http://127.0.0.1:8080/swagger-ui.html`(또는 `/swagger-ui/index.html`)과
`http://127.0.0.1:8080/v3/api-docs`로 확인한다. Spring Boot 4.1.1 기준 의존성은
`org.springdoc:springdoc-openapi-starter-webmvc-ui:3.2.0`이다.

DB 중지·재시작(데이터 유지):

```text
docker compose --env-file .env stop db
docker compose --env-file .env up -d --wait db
```

정리할 때 `docker compose --env-file .env down`은 컨테이너·네트워크만 제거한다.
**`down -v`는 데이터를 삭제하므로 일반 종료 방법으로 사용하지 않는다.**
값이 펼쳐지는 `docker compose config` 출력, `docker inspect`의 환경변수, 환경 전체 출력은
채팅·로그에 공유하지 않는다. 구성 검사만 필요하면 `docker compose --env-file .env config --quiet`를 쓴다.

## 5. 검사·테스트·빌드

| 목적 | PowerShell | Bash |
| --- | --- | --- |
| 버전 확인 | `.\gradlew.bat --version` | `./gradlew --version` |
| 전체 테스트 | `.\gradlew.bat test` | `./gradlew test` |
| 완료 검증·JAR 생성 | `.\gradlew.bat clean build` | `./gradlew clean build` |

`build`에는 **DB 통합 테스트를 포함한 전체 테스트**가 들어간다.
Spotless 플러그인과 포맷 검사·자동 수정 태스크는 제거했다. `check`·`build`에서 코드 서식을 검사하지 않는다.
테스트 결과는 `build/reports/tests/test/index.html`, JAR은
`build/libs/runway-backend-0.0.1-SNAPSHOT.jar`에서 확인한다. Docker가 없을 때 DB 테스트를
자동으로 건너뛰지 않는다. 실패·미실행은 완료가 아니다.

`test`는 테스트 JVM 2개(`maxParallelForks = 2`, JVM당 힙 1536MiB)로 클래스를 나눠 실행한다. 각 JVM은
PostGIS 서버 하나(`support.SharedPostgres`)를 띄우고, 테스트 그룹마다 그 안의 전용 DB를 쓴다. 다른 JVM과 DB를 함께 쓰지 않는다.
전용 DB는 JVM마다 Flyway 마이그레이션을 한 번 적용해 만든 템플릿에서 복제하므로 컨텍스트 기동 시 Flyway는 적용 상태만 확인한다.
템플릿은 실행마다 새 컨테이너에 현재 마이그레이션으로 다시 만든다. 빈 DB부터 마이그레이션·스키마를 검증하는 테스트는
`SharedPostgres.emptyDatabase`로 빈 DB를 쓴다.

Spring 컨텍스트는 설정(속성·Mock·Spy·`@Import`·웹 환경)이 같은 테스트끼리만 재사용되므로 다음 규칙으로 기동 횟수를 줄인다.

- 별도 설정이 필요 없는 통합 테스트는 `support.SharedContextIntegrationSupport`를 상속한다. 컨텍스트와 DB를 함께 쓰며 매 테스트 전
  `flyway_schema_history`, 시드 테이블 `regions`, PostGIS 확장 테이블을 뺀 모든 테이블을 비운다. 시드를 넣는 마이그레이션을 추가하면
  보존 목록도 함께 고친다. 하위 클래스는 속성·Mock·`@Import`를 따로 선언하지 않으며, 필요하면 이 기반을 쓰지 않는다.
- 도메인별 `*IntegrationSupport`는 그룹에서 쓰는 `@MockitoSpyBean`을 모두 선언하고, 하위 클래스는 같은 빈을 `@Autowired`로 받아 스텁한다.
  Spy는 스텁하지 않으면 실제 빈과 같게 동작하고 테스트마다 초기화된다. 동작을 대체하는 `@MockitoBean`은 해당 클래스에만 둔다.
- DB 대기 상한(연결·잠금·쿼리·소켓)의 동작 테스트는 같은 설정 키에 짧은 테스트 값을 넣어 실제 대기를 줄이고, 원인은 SQLState 등 결과로
  확인한다. 운영 기본값의 적용은 `RunningSessionDbTimeoutDefaultsIntegrationTest`가 확인한다.
컨테이너를 멈추는 장애 테스트와 Redis 테스트는 자체 컨테이너를 쓴다. 테스트 클래스 안의 병렬 실행은 쓰지 않는다.

DB와 무관한 부분만 개발 중 확인할 때:

```powershell
.\gradlew.bat test --tests '*DatabaseSettingsTest' --tests '*BootstrapToolingTest' --tests '*MvcBootstrapTest'
```

Bash에서는 실행 부분을 `./gradlew`로 바꾼다. 이 부분 테스트 성공을 전체 완료 검증으로
보고하지 않는다. DB 테스트는 `BackendApplicationIntegrationTest`, `SchemaIntegrityTest`,
`FlywayMigrationTest`이며 Testcontainers 서버 안의
빈 전용 DB를 쓴다. 개발 `.env`는 읽지 않고 컨테이너 연결을 테스트에 주입한다.

테스트는 설정 누락·Lombok 생성·MVC JSON 및 입력 검증·DB/PostGIS 연결을 확인한다.
업무 로직·소유권·러닝 저장·동시성·공간 Entity 매핑 검증은 기능 구현 시 추가한다.

## 6. DB 구조 변경의 현재 범위

- JPA는 `ddl-auto=validate`로 검사만 하며 OSIV는 비활성화한다.
- Flyway는 활성화하고 `clean`과 자동 baseline을 허용하지 않는다.
- `src/main/resources/db/migration/V1__initial_schema.sql`은 초기 기준 스키마의 26개 업무
  테이블·타입·제약·트리거를 빈 DB에 설치한다. 현재 크루·커뮤니티 Entity를 포함하며 기동 성공만으로 모든 업무 Entity
  매핑 검증을 의미하지 않는다. 기존 워치 테이블 설치가 미확정 워치 API 정책을 확정하지 않는다.
- Flyway는 서버 기동 시 미적용 버전을 적용한다. 다른 개발자의 로컬 DB도 각자 설정한 접속
  대상에 적용되며, 개인 `.env`를 공유하지 않는다. IntelliJ에서 `.env` 파일을 실행 설정에
  지정하면 IDE가 변수를 전달할 수 있다. 파일을 만들기만 하면 자동 적용되는 것은 아니다.
- 최초 적용 전 접속 대상이 새 빈 개발 DB인지 확인한다. 기존 데이터가 있거나 출처가 불명확한
  Docker 볼륨이면 중단하고 기존 설정·이행 방법을 확인한다. 볼륨 삭제로 해결하지 않는다.
- 이미 적용한 V1은 수정하지 않는다. 변경은 `V3__설명.sql` 등 새 버전과 기준 스키마에 반영한다.
  병렬 번호 충돌·실패·체크섬 불일치 대응은 [DB 규칙](../docs/development/db-schema-convention.md#7-flyway-변경-적용과-복구)을 따른다.
- 격리 테스트는 첫 적용·이력·재적용 시 데이터 보존·기존 DB 거부·변조 감지·실패 롤백과
  기준 SQL 대비 실제 설치 구조를 검사한다. PostgreSQL 트랜잭션 DDL 검증이며 임의 SQL의
  자동 복구나 운영 이행을 보장하지 않는다.
- 기존·공유·운영 DB를 이 초기 구성에 연결하지 않는다.

## 7. 공통 인증과 Swagger

회원 API는 `Authorization: Bearer <accessToken>`을 사용한다. `X-User-Id`는 인증수단이 아니다.
검증되지 않거나 만료된 토큰은 `401 UNAUTHORIZED`다. 크루 관리자·작성자·공개 범위 등 기존 권한 검사도 유지한다.
아이디·비밀번호 로그인 U01은 아래 8장의 Redis 최초 계열 저장을 사용한다. 회원가입·아이디 확인은 아래 가입 절을 따른다. 갱신·로그아웃 API와 193번 로그인 실패 제한은 후속 업무다.
토큰을 받기 위한 임시 공개 발급 API는 제공하지 않는다.

Refresh Token과 로그인 계열은 [ADR-0015](../docs/adr/0015-redis-refresh-token-store.md)에 따라 Redis를 사용한다. 사용자·비밀번호 해시·러닝 프로필은 PostgreSQL에 유지한다. Redis 준비·설정·복구 절차는 아래 8장을 따른다.

| 변수 | 필수·용도 |
| --- | --- |
| `BACKEND_JWT_SECRET_BASE64` | 모든 환경 필수. 암호학적 난수 최소 32바이트를 Base64로 인코딩한 키. 기본값 없음 |
| `BACKEND_DOCS_ACCESS_MODE` | `local` 또는 `password`. 생략 시 `password`. local은 server.address가 `127.0.0.1` 또는 `::1`일 때만 허용 |
| `BACKEND_DOCS_USERNAME` | password 모드 필수 팀 문서 계정. 회원 계정과 별개 |
| `BACKEND_DOCS_PASSWORD_HASH` | password 모드 필수. `{bcrypt}` 접두사가 붙은 BCrypt 해시. 실제 값은 개인/서버 Secret 저장소에서 주입 |

로컬은 기존 DB 설정과 JWT 키를 환경변수로 주입하고 `BACKEND_DOCS_ACCESS_MODE=local`로 실행한다.
브라우저에서 `http://127.0.0.1:8080/swagger-ui/index.html`로 접속한다. 로컬 문서는 별도 비밀번호가 필요 없다.
로컬 예시 파일의 Secret은 비어 있으므로 `.env.example`만 복사해서는 서버가 시작되지 않는다.
Spring Boot는 `.env`를 자동으로 읽지 않으므로 IntelliJ 실행 환경 또는 터미널 환경으로 주입한다.

공유 서버는 `password` 모드와 문서 계정/해시를 먼저 등록하고 컨테이너 환경으로 전달한다.
HTTPS의 `/swagger-ui/index.html`에 접속해 브라우저의 문서 전용 인증창에 팀 계정과 원래 비밀번호를 입력한다.
`/swagger-ui.html`, 문서 CSS/JS, `/v3/api-docs`, `/v3/api-docs.yaml`, `/v3/api-docs/swagger-config`도 보호된다.
문서에서는 GET/HEAD만 허용하며 실제 회원 API 시험에는 별도로 Swagger **Authorize**에 Access Token을 입력한다.
문서 계정으로 회원 API를 호출할 수 없고 JWT만으로 공유 문서를 열 수 없다. Swagger 브라우저의 토큰 영속 저장은 꺼져 있다.

문서 해시는 Spring의 BCrypt 인코더 등 신뢰할 수 있는 로컬 도구로 사용자가 생성한다. 접두사를 포함한 해시만 주입하며
실제 비밀번호·키·해시는 채팅·Git·로그에 넣지 않는다. 비밀번호를 코드·셸 기록에 직접 적지 않는다.
필수 Secret 누락·형식 오류 또는 공유 서버 설정 오타는 값이 아닌 변수 이름을 안내하고 기동을 거부한다.
키는 재시작할 때 새로 생성하지 않고 환경별로 분리한다. 키를 바꾸면 이전 Access Token은 검증에 실패하므로
재인증 영향을 확인하고 운영자가 교체한다. 복수 키를 통한 무중단 회전은 현재 제공하지 않는다.

로컬 모드를 공유 서버나 프록시 뒤에서 사용하지 않는다. 루프백 바인딩만으로 프록시의 외부 공개가 방지되는 것은 아니다.
새 버전 배포 전에 서버 관리자가 환경변수 4개의 적용과 HTTPS를 확인해야 한다. 서버의 별도 Compose에서 컨테이너로
변수를 전달하는 매핑도 필요하며, 이 저장소의 배포 코드만으로 Secret이 자동 등록되지는 않는다.
배포 점검의 무인증 `GET /`는 기존 404를 유지한다. 이를 readiness 성공 API로 해석하지 않는다.

JWT는 HS256, 최대 600초이며 발급 시 로그인 계열의 최초 로그인부터 30일 상한도 넘지 않는다.
서버 시각이 exp 이상이면 거절하고 토큰 검증을 위해 요청마다 계정/로그인 상태를 조회하지 않는다.
탈퇴 후 기존 토큰의 잔여 인증은 최대 10분 허용하지만 기존 자원 존재·소유권·동의 검사를 우회하지 않는다.
새 발급·갱신을 허용한다는 뜻은 아니다. 자세한 결정은 [ADR-0014](../docs/adr/0014-common-api-authentication.md)를 따른다.

테스트 설정의 키와 문서 계정은 합성 데이터이며 실행 JAR에 포함되지 않는다. 실제 서비스에 재사용하지 않는다.

## 8. 로그인과 Redis

U01 `POST /api/v1/auth/login`은 8~20 Unicode 코드 포인트·공백 불가·특수문자 허용 정책을 적용한다. 비밀번호를 trim·정규화하지 않으며 Argon2id(64MiB·3회·병렬도 1, salt 16바이트·hash 32바이트)로 검증한다. users.password는 `$argon2id$v=19$m=65536,t=3,p=1$...` 형식이며 로그인에서 자동 재해싱하지 않는다. 손상·미지원 저장 해시는 비밀값 없는 503으로 처리한다. 회원가입 구현도 같은 `MemberPasswordHasher`와 입력 정책을 사용해야 한다. 별도 가입·계정 생성 API를 이 작업에서 제공하지 않는다.

없는 아이디·잘못된 비밀번호·탈퇴 계정은 같은 `401 INVALID_CREDENTIALS`로 응답한다. 인증 후에는 사용자 행 잠금 아래 계정 ACTIVE·검증한 해시 불변을 재확인하고 Redis 계열 저장 및 PostgreSQL 트랜잭션 종료 후 토큰을 반환한다. 초기 설정은 프로필의 수준·유효 페이스 저장 여부로 계산한다. 성공 응답은 `Cache-Control: no-store`다. 계약과 교차 저장소 실패 처리는 [인증 API](../docs/design/api/users.md#갱신-권한-저장소)를 따른다.

### 로컬 준비와 변수

기존 `.env`가 있으면 덮어쓰지 않고 사용자가 아래 누락된 변수만 로컬에서 추가한다. `.env.example`의 Redis 비밀번호는 빈 값이며 실제 값은 채팅·Git·로그에 넣지 않는다. Compose는 `.env`를 내부적으로 읽지만 Spring Boot·IntelliJ에는 환경변수를 별도로 주입해야 한다. 아래 변수는 로컬 Compose뿐 아니라 로그인 서버에도 필요하다.

| 변수 | 필수 여부·용도 |
| --- | --- |
| `BACKEND_REDIS_HOST` | 필수, 호스트만 지정. 로컬 `127.0.0.1`. 인증정보나 URI를 넣지 않음 |
| `BACKEND_REDIS_PORT` | 필수, 1~65535. 로컬 Compose 공개 포트는 6379 |
| `BACKEND_REDIS_USERNAME` | 필수, 영문으로 시작하는 영문·숫자·밑줄·하이픈 1~32자. 로컬 예시는 `runway_app` |
| `BACKEND_REDIS_PASSWORD` | 필수 Secret. 사용자가 정한 비밀번호를 서버·Compose에 동일하게 주입 |
| `BACKEND_REDIS_SSL_ENABLED` | `true`/`false`, 기본 false. 로컬 루프백·동일 신뢰 내부망에서만 false. 신뢰 경계를 통과하는 연결은 인증서 검증 TLS와 true 사용 |

백엔드 폴더에서 `docker compose --env-file .env up -d --wait db redis` 후 `docker compose --env-file .env ps`로 상태만 확인한다. 실제 `.env` 또는 생성된 ACL 파일을 출력하지 않는다. IntelliJ·서버 환경변수에는 DB·JWT 설정과 위 Redis 설정을 함께 주입한다. 기존 공유 서버의 배포 환경에도 이 변수 매핑·Redis 준비가 필요하며 저장소 코드만으로 Secret이 자동 등록되지 않는다. 로컬 확인이 배포 서버의 준비 완료를 뜻하지 않는다.

### 저장·접근 설정

- Redis 8.2.11 공식 이미지의 digest를 compose.yaml과 테스트에 고정한다. Spring Data Redis 4.1.1·Lettuce 7.5.2.RELEASE는 Boot 4.1.1 BOM을 따르고 Argon2용 Bouncy Castle 1.86은 명시한다.
- 로컬 Redis 포트는 127.0.0.1:6379에만 공개하고 `redis-auth-data` 영속 볼륨을 사용한다. AOF always, rewrite 중 디스크 반영 유지, 손상 AOF 기동 거부, maxmemory 256MiB·noeviction, 컨테이너 메모리 상한 1GiB다. 운영 용량은 동시 계열·30일 교체 이력을 포함해 따로 산정한다.
- entrypoint가 환경변수의 비밀번호를 내부적으로 해시해 권한을 제한한 임시 ACL 파일을 만든다. 기본 계정은 비활성화하고 앱 계정에는 `runway:auth:*` 및 인증 스크립트에 필요한 명령만 허용한다. 앱 계정은 FLUSHALL·CONFIG 같은 관리 명령을 사용할 수 없다. 운영 관리 계정·접근은 별도 Secret/운영 절차로 관리한다.
- 연결 1초·명령 2초 timeout, 단절 중 명령 거절과 자동 명령 재전송 방지를 적용한다. 저장·판정 장애는 503이다. Redis는 매 회원 API의 JWT 검증을 위한 조회 대상이 아니므로 기존 JWT 검증은 Redis를 호출하지 않는다.
- 계열 Hash에는 해시·사용자·최초/절대 만료시각·상태를 저장하고 사용자 ZSET 인덱스로 계열을 찾는다. Lua의 첫 쓰기는 메모리를 할당하는 ZADD로 해 Redis의 OOM 검사 우회를 피한다. PENDING 구성·절대 만료 설정 뒤 마지막 HSET으로 ACTIVE를 확정한다. Lua가 실패하면 자동 롤백되지 않으며 미완성 계열은 인증 근거가 아니다.
- 193번 실패 제한은 같은 Redis의 `runway:auth:attempt:<loginId>` String에 `횟수:종료시각(ms)`로 저장한다. Redis 서버 시각과 SET PXAT으로 값·만료를 함께 기록한다. 1~4회는 마지막 실패부터 24시간, 5번째는 그때부터 10분이며 제한 중 요청으로 연장하지 않는다. 최종 제한 확인·계열 활성화·실패 기록 삭제를 같은 Lua에서 처리한다. ACTIVE 뒤 삭제할 DEL 권한은 쓰기 전에 검사하며 기존 PENDING·OOM 기준을 유지한다.
- 앱 ACL은 기존 인증 명령에 GET·SET·DEL을 추가하되 키 범위를 `runway:auth:*`로 유지한다. 사용자는 로그에 키·아이디·비밀번호·토큰을 남기지 않는다. 만료 기준과 성공 초기화·불확실한 쓰기 결과는 [U01 계약](../docs/design/api/users.md#로그인-연속-실패-제한)을 따른다.
- 후속 갱신·탈퇴는 같은 사용자 행 잠금 → Redis 변경 순서를 지켜야 한다. U18 전체 구현과 194번 회전·재사용·로그아웃 검증은 별도 업무다.

### 재시작과 장애 복구

정상 최신 볼륨에서 Redis를 재시작하면 저장 상태를 유지한다. 단일 primary 구성으로 자동 replica/Cluster 장애 전환은 없다. AOF always는 디스크 기록을 기다리므로 everysec보다 쓰기 지연이 커질 수 있다. 성공 응답 뒤의 상태 보존은 정상적인 디스크 fsync 보장 범위에서 확인하며 하드웨어 유실까지 무손실이라고 주장하지 않는다.

메모리 부족 시 기존 인증 데이터를 퇴출하지 않고 저장이 필요한 요청이 503으로 실패한다. 임의로 캐시 삭제·토큰 이력 조기 정리로 해결하지 않는다. 운영자가 계열/이력 사용량과 자원을 확인하고 용량을 조정한다.

볼륨 유실·AOF 손상·과거 백업만 남은 경우에는 인증 경로를 중단한다. 운영자가 원인·대상·영향을 확인한 뒤 새 빈 인증 저장소로 재개하고 사용자에게 재로그인을 안내한다. 과거 상태를 그대로 되살리거나 손상 AOF를 자동 잘라 기동하지 않는다. 앱은 데이터 삭제·볼륨 교체·자동 초기화를 실행하지 않는다. 기존 Refresh Token은 전부 무효이고 기존 JWT는 원래 만료까지 최대 10분 남을 수 있다. 명령 실행·데이터 삭제는 그 시점의 별도 승인 범위다.

193번 실패 기록·잠금도 정상 최신 볼륨 재시작에는 유지한다. 위 절차로 운영자가 빈 저장소 복구를 선택한 경우에만 기존 실패 횟수·잠금도 초기화되는 예외를 허용한다. 단순 연결 장애·시간초과는 503이며 기록 삭제나 DB·앱 메모리로 자동 대체하지 않는다. 시간초과 전에 증가·성공 초기화가 이미 반영됐을 수 있으므로 쓰기를 자동 재전송하지 않는다.

### 검증

`./gradlew clean build`(PowerShell: `.\gradlew.bat clean build`)는 비밀번호 성능 측정을 제외한 전체 기능·통합 테스트를 실행한다. 로그인 테스트는 격리 PostgreSQL·Redis를 사용하고 비밀번호·토큰은 합성 값이다. 실패 제한 테스트는 24시간·10분 만료 경계, 동시 성공·실패, 실제 응답 유실·쓰기 전 단절, 정상/강제 재시작·빈 복구, OOM·권한 부족을 검사한다. `RefreshTokenStoreIntegrationTest`는 자체 컨테이너의 강제 종료·손상 AOF·새 빈 복구·메모리 부족·실제 entrypoint ACL을 검사한다. 운영 볼륨·계정에 장애를 주입하지 않는다. 제품 인수 테스트와 로컬 Argon2 비용 측정을 실제 배포 부하 검증으로 대신하지 않는다.

Argon2id의 합의된 비용(64MiB·반복 3회·병렬도 1)은 유지한다. 비밀번호 일치·오답·해시 형식과 비용 값 방어는 일반 CI에서 계속 검사한다. 단일/동시 검증의 p95 실행 시간 검사는 `password-performance` 태그로 분리하며, 공유 CI 자원에 따른 시간 초과를 일반 빌드 실패 조건으로 사용하지 않는다.

비용을 다시 측정할 필요가 있을 때만 자원 조건을 정한 환경에서 `./gradlew passwordPerformanceTest`(PowerShell: `.\gradlew.bat passwordPerformanceTest`)를 명시적으로 실행한다. 이 태스크는 일반 `build`에 연결하지 않는다. 기존 단일 30회 p95 1초 이하·8개 동시 40건 p95 2초 미만 조건은 유지하며 결과는 `build/reports/tests/passwordPerformanceTest/index.html`에 생성한다. 로컬 비용 측정을 실제 배포 부하 검증으로 대신하지 않는다.

## 9. 코스 DEM 고도와 경사 계산

[ADR-0019](../docs/adr/0019-course-generation-backend.md)에 따라 경사는 백엔드에서 계산한다.
`CourseGradeService`는 GeoJSON LineString과 코스 거리(m)를 받아 `GradeSegment` 목록을 반환하는
내부 계산 서비스다. 20m 재표본 → 중앙값 5칸 → 평균 3칸 → 100m 경사를 계산하고,
45km 초과 시 폭을 넓혀 최대 450개로 맞춘 뒤 기존 `GradeProfileValidator`를 통과시킨다.

운영 DEM을 준비한 호출부는 다음처럼 생성/주입한다. `demPath`는 서버 로컬 파일,
`expectedSha256`은 신뢰하는 manifest의 SHA-256이다. 외부 DEM API를 호출하지 않는다.

```java
var source = GeoTiffElevationSource.load(demPath, expectedSha256);
var calculator = new CourseGradeService(source);
var grades = calculator.calculate(route, distanceM);
```

- 읽기 라이브러리는 순수 Java `mil.nga:tiff:3.0.0`(MIT)이다. 단일 밴드·EPSG:4326·북쪽이 위인
  GeoTIFF clip을 지원하며 strip/tile, DEFLATE, float predictor와 PixelIsArea/Point를 테스트한다.
  회전·투영 좌표계·해시 불일치·깨진 파일은 `SERVICE_UNAVAILABLE`로 거절한다.
- 범위 밖·NoData·비유한 고도는 거리 기준으로 보간하고, 양 끝의 결측은 가장 가까운 유효 고도를
  사용한다. 유효 고도 2개 미만 또는 유효 경사 부재는 오류이며 평지 0%로 대체하지 않는다.
  ±100% 밖 경사는 인접 유효 경사로 보간한다. 경사는 소수 4자리로 반올림한다.
- 다리·터널을 경로 좌표만으로 식별할 수는 없다. 해당 정보가 있는 호출부는
  `calculate(route, distanceM, List<UnmeasuredSection>)`에 미확인 거리 구간을 전달한다.
  겹치거나 맞닿는 구간은 합치고 양 끝 고도 사이를 보간한다.
- 계산 소스는 불변 배열이며 동시 조회 시 TIFF reader를 공유하지 않는다. 경로 조회는 요청당
  최대 1,000,000개 DEM 표본으로 작업량을 보호하고 초과 시 `SERVICE_UNAVAILABLE`로 거절한다.
  이는 공개 API의 거리 상한을 정하는 정책이 아니다. 순수 고도→경사 계산은 전체 20m 격자를
  할당하지 않아 스키마의 최대 거리도 계산할 수 있다.
- 기동 시 파일 연결과 준비 상태 처리는 아래 "C01 코스 생성 설정"(S15P31E105-423)을 따른다.
  DEM 원본 배포(볼륨·manifest·준비 스크립트)는 인프라 후속 업무다.
  고도 데이터는 Copernicus DEM 라이선스와 출처 표기 기준을 따른다.

### C01 코스 생성 설정 (S15P31E105-423)

C01은 Route 서버를 HTTP로 호출해 후보를 받고, 후보마다 위 계산으로 100m 경사를 붙인다.
계약은 [courses.md C01·코스 생성 후속](../docs/design/api/courses.md#코스-생성-후속-필요-사항)과
[ai-service.md Route 내부 계약](../docs/design/api/ai-service.md#route-코스-생성-내부-http-계약-초안)이다.
설정이 비어 있어도 서버는 기동하며, C01만 `503 SERVICE_UNAVAILABLE`과 `details.reason`으로 실패한다.

| 환경변수 | 설명 |
| --- | --- |
| `BACKEND_ROUTE_MODE` | `http`(기본) 또는 `stub`. stub은 개발자가 Route 없이 화면을 확인할 때만 쓰는 가짜 경로이며 응답 `notices`에 개발용임을 표시한다. 서버에는 쓰지 않는다. 다른 값은 기동 실패 |
| `BACKEND_ROUTE_BASE_URL` | Route 전용 내부 origin(예: `http://route:8000`). 경로·쿼리·사용자 정보가 있거나 호스트 이름에 밑줄(`_`)이 있으면 기동 실패(Compose 서비스 이름은 하이픈 사용). 비우면 C01이 `ROUTE_UNAVAILABLE` |
| `BACKEND_COURSE_DEM_PATH` | 서버 로컬 DEM 파일 경로. 비우면 C01이 `GRADE_NOT_READY`(stub 모드는 합성 고도). 파일 없음·검증 실패는 기동 로그로 구분하며, 파일을 넣은 뒤에는 재기동해야 반영된다 |
| `BACKEND_COURSE_DEM_SHA256` | 선택. 기본값은 아래 공유 DEM의 SHA-256. 해시가 다르면 기동은 하고 `GRADE_NOT_READY` |
| `BACKEND_AI_BASE_URL` | HR 추론 AI 서버(`ai/service`) 내부 origin(예: `http://ai:8000`). AI06 심박 개인화(`POST /v1/hr/personalize`), AI04 실시간 코칭(`POST /v1/pace/decide`), 생성 코스 저장 후 AI05 코스 구간 난이도 비율 계산(`POST /v1/pace/plan`, S15P31E105-297)이 함께 쓴다. 코스 추천 Route는 별도 컨테이너로 `BACKEND_ROUTE_BASE_URL`을 쓴다. 경로·쿼리·사용자 정보가 있으면 기동 실패. 비우면 기동은 하고 개인화 호출이 실패해 저장하지 않으며 자동 코칭과 코스 구간 비율 계산을 하지 않는다(세션 계획은 균등 분배) |

시간 상한은 Route 연결 1초·전체 호출 15초, C01 전체 20초이며 자동 재시도·스텁 전환은 하지 않는다. Route에는 `X-Request-Deadline`(마감 − 6초, epoch ms)을 보내 늦게 끝날 계산을 시작하지 않게 한다. Route 서비스 API는 `ai/route_service/API.md`(381)이다.
Route 응답 본문은 256KB까지만 읽는다. 로그에는 상태·지연·후보 수·사유만 남기고 좌표·문구 원문은 남기지 않는다.

**공유 DEM(2026-11-05 AI 팀 공유, Route 엔진과 같은 파일)**

| 항목 | 값 |
| --- | --- |
| 위치 | HF 비공개 저장소 `AnSeongYun/runway-hr-models`, revision `4952478476ce2d76579e1b6ba16363214e6a6914`, `route_data_v2/reports/_route_canonical_work/dem/copernicus_glo30_canonical_clip.tif` (접근 권한 필요) |
| SHA-256·크기 | `45faaa5e36c710a235658e1172183279007ac3b3fdcc29a14246222fdabb3a1f`, 8,266,122 bytes |
| 범위·형식 | 부산 전역(경도 128.73~129.35, 위도 34.85~35.42). GeoTIFF 1밴드 float32(m), EPSG:4326, 1초(약 30m), 2232×2052, deflate, nodata 없음(바다 0m) |
| 원본 | Copernicus DEM GLO-30 4타일 병합 |
| 출처 표기 | "Copernicus DEM GLO-30 (c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018, provided under COPERNICUS by the European Union and ESA." |

바다를 nodata가 아닌 0m로 두므로, 해안·교량 구간의 0m 표본은 결측으로 보간되지 않고 실제 0m로 계산된다.
출처 표기의 앱 노출 위치는 FE와 후속으로 정한다.

공유 DEM을 받은 경우 실제 파일 검증은 `BACKEND_COURSE_DEM_PATH`를 지정하고
`.\gradlew.bat test --tests "*SharedBusanDemTest"`로 실행한다. 변수가 없으면 이 테스트는 건너뛰며,
기본 빌드는 합성 DEM 테스트로 같은 코드를 검증한다. 운영 배포는 인프라가 HR 모델처럼 HF에서 받아
DEM 볼륨에 넣는다(AI 팀 요청 예정).

테스트는 실제 DEM 없이 `src/test/resources/course-grade/dem/`의 작은 합성 파일을 사용한다.
`generate_dem_fixtures.py`에 독립 재생성 명령이 있으며 실제 좌표·건강 데이터는 포함하지 않는다.
`python-grade.json`은 실제 AI `course_grade.py`에서 생성한 24개 사례로, 동일 고도 입력의 경사
차이를 0.0001%p 이하로 비교한다. `generate_fixture.py`의 명령으로 재생성하며 원본 코드의
SHA-256과 사용한 numpy/pydantic 버전을 기록한다.

## 관련 기준

- [백엔드 작업 지침](AGENTS.md)
- [코드 컨벤션](../docs/development/backend-convention.md)
- [Secret 및 환경변수](../docs/development/secret-environment-variables.md)
- [개발·테스트 DB 결정](../docs/adr/0011-local-postgresql-postgis.md)

버전 확인 출처(2026-10-22): [Spring Boot 요구사항](https://docs.spring.io/spring-boot/system-requirements.html),
[Spring Initializr](https://start.spring.io),
[PostGIS 이미지](https://github.com/postgis/docker-postgis).

### 세션 제어 스키마 (V3)

V3는 세션의 현재 상태, 실제 제어 결과, 코칭 유효성을 저장하는 컬럼과 `session_control_events` 테이블을 추가한다. 컬럼과 제약은 [ERD 설명서](../docs/design/db/erd.md), 처리 규칙은 [세션 계약](../docs/design/api/sessions.md#준비코칭종료-후-분석-상태)을 따른다.

적용 전 진행 중이거나 일시정지 중인 운동을 종료하고 구버전 서버의 쓰기를 중지해야 한다. 기존 세션은 `state_version=0`, `analysis_status=LEGACY`로 보존하며, 신규 세션은 `state_version=1`로 생성한다.

V1과 V2 지역 초기 데이터는 수정하지 않는다. V3는 `running_sessions`를 잠근 뒤 `RUNNING`/`PAUSED` 세션이 있으면 전체 적용을 롤백한다. 이 작업에서는 공유·운영 DB에 적용하지 않는다. 이미 V3가 적용된 DB에 수정된 V3를 덮어쓰지 않으며, 로컬 임시 DB는 재생성한다.

`sync_batches.client_batch_id`는 기존 문자열에서 UUID로 변환한다. 변환 불가능한 값이 있으면 전체 마이그레이션을 롤백하며, 값을 임의 변경하거나 삭제하지 않는다. 기존 `payload_hash`는 유지한다.

### 기기 연결 유일성 (V5)

V5는 `user_devices`에 회원별·유형별 연결 중(`unlinked_at IS NULL`) 기기를 하나만 허용하는 부분 유니크 인덱스 `uq_user_devices_active`를 추가한다. 처리 규칙은 [기기 API W01~W03](../docs/design/api/devices-health.md#w01-기기-등록)을 따른다.

같은 회원·유형으로 연결 중인 행이 이미 두 개 이상 있으면 V5는 실패하고 데이터는 바뀌지 않는다. 적용 전에 해당 행을 확인해 남길 기기를 정하고 나머지에 `unlinked_at`을 기록해야 한다. 이 작업에서는 공유·운영 DB에 적용하지 않는다.

### 러닝 구간 집계 스키마 (V6)

V6는 H03 조회용 `running_session_splits` 테이블을 추가한다. 종료 후 1km 단위로 원본에서 한 번 계산한 실측 구간 페이스·심박·케이던스를 저장하며, 계획 구간(`pace_plan_segments`)과 구분한다. 컬럼·제약은 [ERD 설명서](../docs/design/db/erd.md), 조회 계약은 [러닝 기록 API H03](../docs/design/api/running-records.md#h03-구간별-러닝-분석-결과-조회)을 따른다.

V1~V5는 수정하지 않는다. 이미 V6가 적용된 DB에 수정된 V6를 덮어쓰지 않으며, 로컬 임시 DB는 재생성한다.

## 회원가입과 아이디 확인 (S15P31E105-222)

- U15는 네 종류 동의 배열, 필수 회원정보를 검증해 users·user_settings를 같은 트랜잭션으로 생성한다. 필수3종 동의는 true를 검증만 하며 건강 동의만 기존 users.health_data_access에 저장한다. 초기 공개 범위 PRIVATE, 위치 수집 OFF, 음성·BPM·그룹/커뮤니티알림은 false다. 임시 러닝 프로필을 만들지 않는다. 전화번호는 010+숫자8자리, 닉네임은 공백 없는 Unicode2~10자·중복 불가다.
- V4는 기존 nickname 중복이 있으면 실패한다. 중복 데이터를 임의 삭제·개명하거나 V1/V2 체크섬을 바꾸지 않는다. 운영 적용 전 중복 여부를 운영자가 확인하고 이행 방법을 합의한다. 플랜·자동 테스트는 격리 DB에서만 수행한다.
- U16은 IP당 최근60초60회, 초과429다. Redis sorted set과 서버 시각을 사용해 인스턴스 간 원자적으로 집계하며 Redis 장애는503이다. IP당 최대60개 허용 요청을 약61초 TTL로 보관하고 아이디·원본 IP는 저장하지 않는다. IP SHA256 키도 익명성을 보장하는 것은 아니다.
- Redis 앱 ACL에 ZCARD·ZREM을 추가했다. 기존 Redis 프로세스는 재기동/승인된 ACL 갱신을 해야 적용되며 이 작업이 운영 변경을 자동 실행하지 않는다.
- BACKEND_AUTH_TRUSTED_PROXIES는 선택 설정으로 쉼표 구분 프록시 IP/CIDR 목록이다. 기본 빈값은 X-Forwarded-For를 무시하고 직접 연결 주소를 사용한다. 배포자는 실제 백엔드 앞의 프록시 주소/범위만 주입하고 백엔드 직접 외부 접근을 차단한다. 전체 인터넷·일반 사용자 범위를 신뢰 목록에 넣지 않는다.
- 직접 연결자가 신뢰 프록시이면 X-Forwarded-For를 오른쪽부터 해석해 첫 비신뢰 주소를 사용한다. IPv4/IPv6 리터럴만 허용, 잘못된 신뢰 경로 헤더는400이다. Spring/Tomcat의 별도 전역 전달 헤더 변환을 중복 활성화하지 않는다. 프록시 설정이 빠지면 여러 사용자가 같은 프록시 IP의60회 제한을 공유하므로 운영 시 반드시 설정한다.
- DB·Redis 공동 트랜잭션은 없다. 실패 때 성공 토큰을 보내지 않고 롤백·미전달 계열 폐기를 시도한다. 보상 실패에는 비밀값 없는 경고만 기록하며 미전달 계열이 만료까지 남을 수 있다. 가입 결과 불명확·응답 유실 후 같은 아이디 재요청은409이며 로그인으로 복구한다.
- 별도 동의 이력 테이블·약관 버전·동의 시각 저장은 만들지 않는다. 가입 후 건강정보 동의 변경·조회는 W04/W05(S15P31E105-250)를 따른다.

## 내부 상태 검사

Actuator의 `GET http://127.0.0.1:8082/actuator/health/readiness`는 백엔드 실행 환경의 루프백에서만 접근한다.
앱 준비 상태·DB 연결·인증 Redis PING이 모두 정상이면 `200 {"status":"UP"}`, 장애 시 `503`을 반환한다.
응답에 연결 정보나 오류 상세는 포함하지 않는다. 업무 API 포트·Swagger·Nginx에는 공개하지 않는다.
DB 데이터·Redis 키를 쓰지 않으며 INFO 권한을 추가하지 않는다. 배포 검사는 이 주소와 업무 HTTP 포트 응답을 함께 확인한다.

### 팔로우 요청 이력 스키마 (V14, S15P31E105-249)

`V14__follow_request_history.sql`은 요청별 처리 결과를 별도 테이블에 보관한다. 기존 `user_follows`의 현재 관계·승인 여부와 구분하며 이력을 집계·열람 권한으로 사용하지 않는다. 취소·거절 후 재요청은 새 관계 ID로 구별하고, 이력은 자동 삭제하지 않는다. 새 DB는 Flyway가 순서대로 적용하며 기존 V1~V13은 수정하지 않는다. 기준 SQL은 빈 격리 DB 검증용이며 운영 DB에 직접 실행하지 않는다.

U21은 기존 계정 접근 판정과 작성자별 전체 게시물 조회를 재사용한다. U22/U23/U25의 대상 사용자 행은 `FOR NO KEY UPDATE`로 잠그고 대상 설정→관계 순서로 처리하여 공개 전환과 직렬화하면서 외래키 검사에 따른 상호 팔로우 교착을 피한다.

알림은 `FollowNotificationEvent`를 트랜잭션 내에서 발행하는 연계 지점만 제공한다. S15P31E105-458에서 사건을 같은 트랜잭션의 동기 처리 또는 BEFORE_COMMIT에서 내구성 있게 저장하고, 수신자의 community 설정 적용·중복 제거·푸시 전달을 구현해야 한다. 현재 사건 발행만으로 실제 저장·전달·재시작 복구가 완료된 것이 아니며 458 통합 전 관련 완료 검증은 미실행이다.


## 회원탈퇴 개인 이미지 정리 (S15P31E105-248)

정리 테이블을 추가하지 않고 커밋된 WITHDRAWN·withdrawn_at과 잔여 이미지 파일을 기준으로 재시도한다. 최초 작업은 기동 후 scheduler에서 실행하며, 완료 뒤 60초마다 최대 100명씩 ID 순서로 순회한다. 각 순회 시작에 최대 탈퇴 ID를 고정하고 그 상한까지 확인한 뒤 처음부터 재검사한다. 새 탈퇴가 계속 유입돼도 기존 실패 회원을 다시 확인하며 재시작 시에도 처음부터 시작한다. 삭제 실패는 다음 전체 순회에서 재시도하며 경고에는 파일명·원문 예외·개인정보를 넣지 않는다.

profile/post의 개인 원본과 by-id 사본만 정리하고 crew 및 다른 회원의 경로는 보존한다. 사용자 원본보다 by-id 사본을 먼저 지워 중단 후 재시도 단서를 유지한다. 업로드는 사용자 행 잠금 아래 ACTIVE를 검사하므로 후속 탈퇴와 같은 사용자 잠금 순서를 사용해야 한다. 자세한 계약은 [이미지 API](../docs/design/api/files.md)의 회원탈퇴 정리 절을 따른다.

`runway.images.cleanup-enabled`의 기본값은 true다. 테스트 기본 설정은 false로 두고 전용 파일/DB 테스트에서 임시 볼륨·격리 DB만 사용한다. U17/U18은 회원탈퇴 서비스에서 처리하며 DB 커밋 후 즉시 개인 이미지 정리를 호출한다. worker는 정리 실패·응답 유실·서버 재시작 뒤 남은 파일의 재처리를 담당한다.
