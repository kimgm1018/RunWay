# ADR-0010: 백엔드 HTTP API는 Spring MVC로 구현한다

| 항목 | 값 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-22 |
| 결정자 | 작업 요청자 — 백엔드 초기 구성 검토 대화에서 승인 |
| 관련 | [S15P31E105-96](https://ssafy.atlassian.net/browse/S15P31E105-96), [ADR-0003](0003-java-spring-backend.md), [ADR-0008](0008-spring-data-jpa.md), [백엔드 컨벤션](../development/backend-convention.md) |

## 맥락

서비스 백엔드는 Java·Spring과 Spring Data JPA를 사용한다. 모바일·워치의 HTTP 요청을 받아
업무 규칙을 처리하고 JSON으로 응답할 웹 구현 방식이 필요하다. 요청부터 DB 접근까지의 흐름을
이해하고 검증하기 쉬운 구성을 우선한다.

## 결정

백엔드 HTTP API는 Spring MVC로 구현한다. 서버 측 화면 템플릿은 전제로 하지 않는다.
Controller·Service·Repository 책임은 백엔드 컨벤션을 따른다.

합의 근거: 본 업무 대화에서 JPA와의 적합성 및 WebFlux와의 차이를 설명한 뒤 작업 요청자가
“좋아 이대로 쓰도록할게”로 승인했다. ADR-0003의 Java·Spring 선택을 구체화하는 결정이며
기존 결정을 대체하지 않는다. 결정 당시에는 프로젝트 생성·실행 검증 전이었다.
같은 업무의 초기 구성에서 MVC 테스트와 전체 빌드로 확인했다. 개발 DB를 사용한 서버 실행 확인은
별도로 기록한다.

## 고려한 대안

| 대안 | 장점 | 감수할 점 |
| --- | --- | --- |
| Spring MVC (선택) | 동기식 JPA 접근과 자연스럽게 연결되고 요청 처리 순서를 읽고 디버깅하기 쉬움 | DB·외부 호출의 대기 시간과 요청 처리 자원은 별도로 관리해야 함 |
| Spring WebFlux | 비동기·논블로킹 처리에 맞춰 설계할 수 있음 | 동기식 JPA 호출을 함께 사용하려면 별도 실행 경계가 필요하고 구현 복잡성이 늘어남 |

공식 문서도 JPA·JDBC 같은 blocking API를 사용하는 일반적인 구조에 MVC를 권한다.
[Spring 공식 설명](https://docs.spring.io/spring-framework/reference/web/webflux/new-framework.html).
성능 비교 실험을 수행해 더 빠르다고 결론 내린 것은 아니다.

## 결과

- **얻는 것**: JPA와 일관된 요청 처리 방식, 명시적인 계층별 책임과 테스트 경계
- **감수하는 것**: MVC 선택만으로 동시 수정·중복 요청 문제가 해결되지는 않음
- **후속 작업**: Spring Boot·의존성 버전 구성과 MVC 테스트는 초기 구성에서 완료했다.
  인증·공통 응답 계약과 실시간 전송 방식은 별도 기능 설계에서 확정한다.
