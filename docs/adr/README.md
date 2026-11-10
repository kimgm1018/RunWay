# 기술 결정 기록 (ADR)

프로젝트 전체에 영향을 주는 아키텍처와 핵심 기술 선택을 **결정 1건당 문서 1개**로 기록한다. 결정 당시의 배경, 비교한 대안과 감수한 제약을 남겨 이후 구현과 재검토의 기준으로 사용한다.

## 기록 대상과 문서 경계

| 구분 | 기록 위치 |
| --- | --- |
| 아키텍처·서비스 경계·배포 단위·저장소 구성 | ADR |
| 핵심 프레임워크·저장소·통신 방식 선택 | ADR |
| 여러 영역에 적용되는 식별자·인증 등 공통 기술 규약의 선택 이유 | ADR |
| 테이블·컬럼·관계 등 데이터 모델 세부 | ERD·스키마 문서 |
| 요청·응답·오류 코드·페이지네이션 등 API 세부 계약 | API 명세 |
| 기능 범위·사용자 흐름·제품 정책·인수 조건 | 요구사항 문서 |
| 캐시 TTL·타임아웃 등 개별 설정값 | 해당 설정과 실행 안내 |

ADR에는 선택 이유를 기록하고, 구체적인 계약은 해당 기준 문서로 연결한다. 다른 문서의 규약을 복사해 중복 관리하지 않는다. 관련 문서가 아직 없으면 후속 작업에 작성할 문서를 적고, 존재하지 않는 파일로 링크하지 않는다.

## 파일명과 번호

- 새 ADR은 [공통 템플릿](0000-template.md)을 복사해 `NNNN-kebab-case.md`로 작성한다.
- `관련`에 Jira 업무, 합의 근거, 설계 문서와 대체 ADR의 식별자·링크를 적는다.
- `0000`은 템플릿 전용이며 실제 결정은 `0001`부터 순차 증가한다. 제목은 `ADR-NNNN: 결정 제목`으로 쓴다.
- 제안·대체·폐기 문서도 번호를 유지한다. 번호를 재사용하거나 기존 문서를 삭제하지 않는다.
- 새 번호는 목록과 파일의 가장 큰 번호 다음 값을 사용한다. 병렬 작업으로 번호가 겹치면 채택 전 MR에서 중복을 해소하고 제목·파일명·목록·참조 링크를 함께 수정한다.

## 상태와 전이

| 상태 | 의미와 기록 기준 |
| --- | --- |
| 제안 | 합의 전 검토안. 결정에 `(가정)`을 표시하고 결정일·결정자는 `-`로 둔다. |
| 채택 | 팀이 합의한 결정. 확인된 결정일·결정자를 채우고 `관련`에 합의 근거를 연결하며 `(가정)`을 제거한다. |
| 대체 | 채택된 결정이 새로 채택한 ADR로 바뀐 상태. 새 ADR과 이전 ADR을 서로 연결한다. |
| 폐기 | 제안이 기각되었거나 결정의 전제가 사라져 무효가 된 상태. 폐기일·사유·확인 근거를 남긴다. |

- `제안 → 채택`: 팀의 합의를 확인하고 결정 메타데이터와 목록을 갱신한다. 관련 기준 문서의 가정 표기도 합의된 내용에 맞춰 정리한다.
- `채택 → 대체`: 새 ADR이 채택될 때 이전 ADR의 상태와 대체 링크, 목록을 함께 변경한다. 새 ADR이 제안 단계인 동안에는 기존 채택 결정을 유지한다.
- `제안 또는 채택 → 폐기`: 기각 또는 전제 소멸의 근거를 확인하고 상태·폐기 기록·목록을 함께 변경한다. 다른 기술을 선택하는 변경이면 폐기 대신 새 ADR로 대체한다.
- 대체·폐기한 결정을 다시 사용하려면 새 ADR을 작성해 이전 기록에 연결한다.

채택은 구현 완료나 성능 검증 완료를 의미하지 않는다. 합의 근거와 검증 근거를 구분하고, 실행하지 않은 검증은 후속 작업으로 남긴다. 코드가 존재하거나 MR이 병합되었다는 사실만으로 합의를 추정하지 않는다.

## 결정 변경과 이력 보존

채택된 ADR의 결정 내용은 덮어쓰지 않는다. 기술 선택·범위·제약을 실질적으로 바꾸려면 새 ADR에 변경 이유와 대안을 기록하고 이전 ADR을 대체한다.

결정 당시의 맥락·고려한 대안·결과는 이후 상황이 달라져도 보존한다. 상태·대체 관계·폐기 기록과 오타·참조 링크 정정은 가능하다. 현재 유효한 결정은 아래 목록의 상태와 대체 관계로 확인한다.

이미 확정된 결정을 소급 기록할 때도 확인 가능한 합의 근거를 연결하고 소급 기록임을 밝힌다. 결정 당시의 대안·이유를 확인할 수 없으면 확인되지 않았다고 적으며 추측으로 채우지 않는다.

## 작성·검토·반영 절차

1. 기존 ADR 목록과 관련 Jira·요구사항·API 명세·ERD를 확인해 중복·충돌과 영향을 받는 영역을 파악한다.
2. 결정의 작성·확정·변경을 Jira Task/Story로 관리한다.
3. [팀 Git 규칙](../development/git-convention.md)에 따라 최신 `dev` 기준의 `<type>/<JIRA-KEY>-<description>` 브랜치를 사용한다. ADR만 변경하는 업무는 `docs` type을 사용한다.
4. 템플릿으로 초안을 작성하고 관련 Jira·설계 문서·기존 ADR을 연결한다. 새 문서와 상태 변경을 목록에도 반영한다.
5. 합의가 필요한 항목은 영향받는 담당자와 확인한다. 합의 전에는 제안 상태를 유지하고, 채택할 때 확인된 근거를 기록한다.
6. 링크·번호·상태·대체 관계와 기준 문서의 정합성을 확인하고, [팀 MR 템플릿](../../.gitlab/merge_request_templates/Default.md)에 변경 내용과 실제 검증 결과를 적어 `dev` 대상 MR로 반영한다.

브랜치·MR 운영과 Jira 완료 처리는 [팀 Git 규칙](../development/git-convention.md)을 따른다.

## ADR 목록

초기 기술 선택의 소급 기록은 결정일을 2026-10-20으로 통일했다. 이후 결정은 실제 확인한
결정일과 합의 근거를 각 문서에 기록한다.

| ADR | 결정 | 상태 | 대체 관계 |
| --- | --- | --- | --- |
| [ADR-0001](0001-react-native-mobile-app.md) | 모바일 앱은 React Native로 구현한다 | 채택 | — |
| [ADR-0002](0002-kotlin-wear-os-app.md) | Galaxy Watch 앱은 Kotlin으로 구현한다 | 채택 | — |
| [ADR-0003](0003-java-spring-backend.md) | 서비스 백엔드는 Java와 Spring으로 구현한다 | 채택 | — |
| [ADR-0004](0004-python-fastapi-ai-service.md) | AI 서비스는 Python과 FastAPI로 구현한다 | 채택 | — |
| [ADR-0005](0005-health-connect-mobile-read.md) | 건강 데이터는 Android Health Connect와 iOS HealthKit으로 조회한다 | 제안 | — |
| [ADR-0006](0006-samsung-health-direct-read.md) | 삼성 헬스 기존 기록은 SDK로 직접 읽고 Health Connect로 보완한다 | 제안 | ADR-0005의 후속 제안 |
| [ADR-0007](0007-gradle-backend-build.md) | 백엔드 빌드는 Gradle과 Groovy DSL을 사용한다 | 채택 | — |
| [ADR-0008](0008-spring-data-jpa.md) | 백엔드의 기본 DB 접근은 Spring Data JPA를 사용한다 | 채택 | — |
| [ADR-0009](0009-flyway-schema-migrations.md) | DB 구조 변경 이력은 Flyway로 관리한다 | 채택 | — |
| [ADR-0010](0010-spring-mvc-backend.md) | 백엔드 HTTP API는 Spring MVC로 구현한다 | 채택 | — |
| [ADR-0011](0011-local-postgresql-postgis.md) | 개발·테스트 DB는 PostgreSQL 17과 PostGIS 3.6을 사용한다 | 채택 | — |
| [ADR-0012](0012-watch-phone-data-layer.md) | 워치·폰은 MessageClient 배치와 DataItem 상태 공유를 사용한다 | 채택 | — |
| [ADR-0013](0013-jwt-authentication.md) | JWT 10분과 최대 30일 갱신 권한을 사용하고 로그아웃 시 갱신 권한을 폐기한다 | 대체 | 대체됨: [ADR-0014](0014-common-api-authentication.md) |
| [ADR-0014](0014-common-api-authentication.md) | 공통 회원 API의 짧은 Bearer JWT와 별도 문서 인증 | 채택 | 대체함: [ADR-0013](0013-jwt-authentication.md) |
| [ADR-0015](0015-redis-refresh-token-store.md) | Refresh Token과 로그인 계열 상태는 Redis에 저장한다 | 채택 | — (ADR-0014의 저장소 구체화) |
| [ADR-0016](0016-image-volume-storage.md) | 이미지 바이너리는 서버 볼륨에 저장한다 | 채택 | — |
| [ADR-0017](0017-redis-login-attempt-store.md) | 로그인 실패 횟수와 잠금 상태도 인증용 Redis에 저장한다 | 채택 | — (ADR-0015의 후속 범위 확장, 기존 결정 유지) |
| [ADR-0018](0018-naver-map-sdk.md) | 앱 지도는 네이버 지도 SDK로 그린다 | 채택 | — |
| [ADR-0019](0019-course-generation-backend.md) | 경사 계산은 백엔드에서 하고, 코스 생성은 AI 최적화를 먼저 시도한다 | 채택 | — |
| [ADR-0020](0020-spotify-android-app-remote.md) | Android Spotify 재생은 App Remote로 제어한다 | 제안 | — (인증은 [ADR-0021](0021-spotify-android-app-sign-in.md)로 보완) |
| [ADR-0021](0021-spotify-android-app-sign-in.md) | Android Spotify 재생·목록 권한은 Spotify 앱 SSO(PKCE) 한 번으로 받는다 | 제안 | — (ADR-0020 보완, 대체하지 않음) |
| [ADR-0022](0022-osm-course-thumbnail-basemap.md) | 코스 썸네일은 Route 전국 OSM 자료(건물 포함)로 서버가 PNG를 저장 시 한 번 그린다 | 제안 | — (ADR-0018 적용 범위에서 카드 썸네일만 제외, 기존 결정 유지) |

새 ADR을 추가할 때 번호에는 문서 링크를 연결하고, 대체 관계에는 `대체함: ADR-NNNN` 또는 `대체됨: ADR-NNNN`을 문서 링크와 함께 적는다. 관계가 없으면 `—`로 표시한다.

AI 모델·학습 프레임워크와 나머지 인프라 기술은 미정이며, 확정 후 별도 ADR로 기록한다. Refresh Token 저장소 선택은 ADR-0015, 로그인 실패 상태의 Redis 저장은 ADR-0017을 따른다. 현재 확정된 계약·복구 기준은 [인증 API](../design/api/users.md), 구체 실행 설정은 [백엔드 실행 안내](../../backend/README.md#8-로그인과-redis)를 따른다. 이미지 파일 저장은 [ADR-0016](0016-image-volume-storage.md)을 따른다.

정리 업무: [S15P31E105-58](https://ssafy.atlassian.net/browse/S15P31E105-58).

## 관련 문서

- [1차 MVP 기능](../design/mvp.md)
- [1차 MVP API 명세](../design/api/README.md)
- [데이터 모델](../design/db/erd.md): ERD 스키마 원본과 테이블 설명
