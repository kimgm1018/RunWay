# RunWay 백엔드

Java 21·Spring MVC 기반의 실행·테스트 초기 구성과 서비스용 Flyway 마이그레이션 V1을 포함한다.
크루·게시글·댓글 API는 공통 JWT 인증을 사용한다. 문서 접속 인증과 회원 API 인증은 구분한다.

## 1. 준비와 버전

| 항목 | 설정 |
| --- | --- |
| Java | 21. 개발 확인 환경: Eclipse Temurin 21.0.12.1 |
| Spring Boot | 4.1.1 |
| Gradle | 9.8.2, 저장소 Wrapper 사용. 별도 설치 불필요 |
| Spotless / google-java-format | 8.10.4 / 1.28.0 AOSP |
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
docker compose --env-file .env up -d --wait db
docker compose --env-file .env ps
```

Bash:

```bash
test -e .env || cp .env.example .env
docker compose --env-file .env up -d --wait db
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
| 포맷 자동 수정 | `.\gradlew.bat spotlessApply` | `./gradlew spotlessApply` |
| 포맷 검사(소스 수정 없음) | `.\gradlew.bat spotlessCheck` | `./gradlew spotlessCheck` |
| 전체 테스트 | `.\gradlew.bat test` | `./gradlew test` |
| 완료 검증·JAR 생성 | `.\gradlew.bat clean build` | `./gradlew clean build` |

`build`에는 `spotlessCheck`와 **DB 통합 테스트를 포함한 전체 테스트**가 들어간다.
테스트 결과는 `build/reports/tests/test/index.html`, JAR은
`build/libs/runway-backend-0.0.1-SNAPSHOT.jar`에서 확인한다. Docker가 없을 때 DB 테스트를
자동으로 건너뛰지 않는다. 실패·미실행은 완료가 아니다.

DB와 무관한 부분만 개발 중 확인할 때:

```powershell
.\gradlew.bat test --tests '*DatabaseSettingsTest' --tests '*BootstrapToolingTest' --tests '*MvcBootstrapTest'
```

Bash에서는 실행 부분을 `./gradlew`로 바꾼다. 이 부분 테스트 성공을 전체 완료 검증으로
보고하지 않는다. DB 테스트는 `BackendApplicationIntegrationTest`, `SchemaIntegrityTest`,
`FlywayMigrationTest`이며 Testcontainers가
일회성 DB를 만들고 정리한다. 개발 `.env`는 읽지 않고 컨테이너 연결을 테스트에 주입한다.

테스트는 설정 누락·Lombok 생성·MVC JSON 및 입력 검증·DB/PostGIS 연결을 확인한다.
업무 로직·소유권·러닝 저장·동시성·공간 Entity 매핑 검증은 기능 구현 시 추가한다.

## 6. DB 구조 변경의 현재 범위

- JPA는 `ddl-auto=validate`로 검사만 하며 OSIV는 비활성화한다.
- Flyway는 활성화하고 `clean`과 자동 baseline을 허용하지 않는다.
- `src/main/resources/db/migration/V1__initial_schema.sql`은 현재 기준 스키마의 26개 업무
  테이블·타입·제약·트리거를 빈 DB에 설치한다. 현재 크루·커뮤니티 Entity를 포함하며 기동 성공만으로 모든 업무 Entity
  매핑 검증을 의미하지 않는다. 기존 워치 테이블 설치가 미확정 워치 API 정책을 확정하지 않는다.
- Flyway는 서버 기동 시 미적용 버전을 적용한다. 다른 개발자의 로컬 DB도 각자 설정한 접속
  대상에 적용되며, 개인 `.env`를 공유하지 않는다. IntelliJ에서 `.env` 파일을 실행 설정에
  지정하면 IDE가 변수를 전달할 수 있다. 파일을 만들기만 하면 자동 적용되는 것은 아니다.
- 최초 적용 전 접속 대상이 새 빈 개발 DB인지 확인한다. 기존 데이터가 있거나 출처가 불명확한
  Docker 볼륨이면 중단하고 기존 설정·이행 방법을 확인한다. 볼륨 삭제로 해결하지 않는다.
- 이미 적용한 V1은 수정하지 않는다. 변경은 `V2__설명.sql` 등 새 버전과 기준 스키마에 반영한다.
  병렬 번호 충돌·실패·체크섬 불일치 대응은 [DB 규칙](../docs/development/db-schema-convention.md#7-flyway-변경-적용과-복구)을 따른다.
- 격리 테스트는 첫 적용·이력·재적용 시 데이터 보존·기존 DB 거부·변조 감지·실패 롤백과
  기준 SQL 대비 실제 설치 구조를 검사한다. PostgreSQL 트랜잭션 DDL 검증이며 임의 SQL의
  자동 복구나 운영 이행을 보장하지 않는다.
- 기존·공유·운영 DB를 이 초기 구성에 연결하지 않는다.

## 7. 공통 인증과 Swagger

회원 API는 `Authorization: Bearer <accessToken>`을 사용한다. `X-User-Id`는 인증수단이 아니다.
검증되지 않거나 만료된 토큰은 `401 UNAUTHORIZED`다. 크루 관리자·작성자·공개 범위 등 기존 권한 검사도 유지한다.
로그인·회원가입·갱신·로그아웃 API 자체는 후속 업무이며, 이 작업은 내부 Access Token 발급기와 검증을 제공한다.
토큰을 받기 위한 임시 공개 발급 API는 제공하지 않는다.

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
문서 계정으로 회원 API를 호출할 수 없고 JWT만으로 공유 문서를 열 수 없다. 토큰 영속 저장은 꺼져 있다.

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

## 관련 기준

- [백엔드 작업 지침](AGENTS.md)
- [코드 컨벤션](../docs/development/backend-convention.md)
- [Secret 및 환경변수](../docs/development/secret-environment-variables.md)
- [개발·테스트 DB 결정](../docs/adr/0011-local-postgresql-postgis.md)

버전 확인 출처(2026-10-22): [Spring Boot 요구사항](https://docs.spring.io/spring-boot/system-requirements.html),
[Spring Initializr](https://start.spring.io), [Spotless](https://plugins.gradle.org/plugin/com.diffplug.spotless),
[google-java-format](https://github.com/google/google-java-format/releases/tag/v1.28.0),
[PostGIS 이미지](https://github.com/postgis/docker-postgis).
