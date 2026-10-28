# ADR-0007: 백엔드 빌드는 Gradle과 Groovy DSL을 사용한다

| 항목 | 값 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-22 |
| 결정자 | 작업 요청자 — S15P31E105-96 컨벤션 검토 대화에서 승인 |
| 관련 | [S15P31E105-96](https://ssafy.atlassian.net/browse/S15P31E105-96), [ADR-0003](0003-java-spring-backend.md), [백엔드 컨벤션](../development/backend-convention.md) |

## 맥락

Java·Spring 백엔드의 의존성 관리·컴파일·테스트·배포 파일 생성을 통일할 빌드 도구가 필요하다.
개발자가 사용해 본 Gradle의 `build.gradle` 방식을 선택해 새로운 설정 방식의 학습 부담을 줄인다.
IntelliJ 사용 여부만으로 빌드 도구가 결정되는 것은 아니다.

## 결정

백엔드 빌드에 Gradle을 사용하고 Groovy DSL인 `build.gradle`로 설정한다. Gradle Wrapper로
개발자 환경과 CI의 Gradle 버전을 고정한다. 버전 선택과 실제 파일 생성은 초기 구성에서 진행한다.

합의 근거: 본 업무 대화에서 Gradle(`build.gradle`)·JPA·Flyway 조합을 제안했고,
작업 요청자가 “좋은 것같아”로 동의했다. 결정 당시에는 실제 설정·실행 검증 전이었다. 같은 업무의 초기 구성에서 전체 빌드(`clean build`)로 확인했다.

## 고려한 대안

| 대안 | 장점 | 단점 |
| --- | --- | --- |
| Gradle (선택) | 익숙한 설정 방식으로 로컬·CI 빌드를 통일할 수 있음 | 플러그인·Java·Spring Boot 간 버전 호환 확인 필요 |
| Maven | Spring Boot와 IntelliJ가 지원하는 다른 빌드 도구 | 이번 작업에서는 기존 Gradle 설정을 옮겨야 할 이점이 확인되지 않음 |

Kotlin DSL로의 전환은 비교 대상으로 삼지 않았으며 기존 Groovy DSL을 유지한다.

## 결과

- **얻는 것**: 기존 경험 재사용, 로컬·CI 빌드 방식 통일
- **감수하는 것**: 빌드 스크립트와 플러그인 버전 관리 필요
- **후속 작업**: 버전 선택, Wrapper·테스트·빌드 구성과 `backend/README.md` 작성은
  S15P31E105-96 초기 구성에서 완료했다. 의존성은 RunWay에서 필요한 항목만 추가한다.
