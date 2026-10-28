# RunWay 문서

현재 사용하는 설계·기술 결정·개발 운영 문서와 공통 양식을 관리한다.

## 설계

- [1차 MVP 기능](design/mvp.md)
- [상세 요구사항](design/requirements.md)
- [데이터 모델 설명](design/db/erd.md) · [기준 스키마](design/db/schema.sql) · [ERD 이미지](design/db/erd.png)
- [API 명세](design/api/README.md)
- [기술 결정 기록](adr/README.md)
- [일상 심박·IBI 기술 검증 결과](design/watch-passive-health-feasibility.md)
- [워치·휴대폰·서버 연동 구조와 데이터 흐름](design/watch-mobile-server-integration.md) — Galaxy Watch+갤럭시 MVP, 명령 순서·목표 고정·백그라운드·재전송 설계

설계 문서는 `design/`, 기술 결정 기록은 `adr/`에 둔다. 기능 구현 시 현재 Jira와 관련된 문서만 확인한다. 요구사항이 충돌하면 임의로 정하지 않고 제품 결정을 확인하며, 데이터 모델 내부가 충돌하면 `schema.sql`을 우선한다. API 문서는 문서에 표시된 상태를 확인한다.

## 개발 운영

- [Git 규칙](development/git-convention.md)
- [Jira 자동화](development/jira-automation.md)
- [GitLab 자동화](development/gitlab-automation.md)
- [백엔드 코드 컨벤션](development/backend-convention.md)
- [백엔드 역할 분담](development/backend-role-assignment.md) — 작성 틀, 담당 미정
- [물리 스키마·마이그레이션 규칙](development/db-schema-convention.md) — 작성 틀, ERD 변경 정리 후 작성
- [Secret 및 환경변수 관리 규칙](development/secret-environment-variables.md)
- [백엔드 개발 지침](../backend/AGENTS.md)

AI Agent의 공통 보안·작업 규칙은 루트 [`AGENTS.md`](../AGENTS.md)를 따른다. 코드 실행·빌드 방법은 해당 코드 디렉터리의 `README.md`에서 관리한다. 아직 사용하지 않는 문서 분류나 빈 폴더는 미리 만들지 않는다.

## 백엔드 작업 양식

- [작업 계획](../backend/templates/plan.md)
- [독립 리뷰](../backend/templates/review.md)

백엔드 전용이며 다른 영역에 강제하지 않는다. 사용 조건과 작업 기록 위치는 [백엔드 개발 지침](../backend/AGENTS.md)을 따른다.
