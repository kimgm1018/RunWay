# ADR-0003: 서비스 백엔드는 Java와 Spring으로 구현한다

| 항목 | 값 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-20 |
| 결정자 | BE 담당, 팀 합의 |
| 관련 | [S15P31E105-58](https://ssafy.atlassian.net/browse/S15P31E105-58), [워치 업로드 API 명세](../design/api/wear-upload-api.md), [ADR-0001](0001-react-native-mobile-app.md), [ADR-0004](0004-python-fastapi-ai-service.md) |

## 맥락

모바일 앱의 서비스 API와 운동 기록 등 서버 측 처리를 담당할 백엔드가 필요하다. 팀원들에게 익숙한 Java와 Spring을 활용해 제한된 일정 안에 핵심 기능 구현에 집중한다.

## 결정

서비스 백엔드는 Java와 Spring으로 구현하고 소스는 `backend/`에서 관리한다. AI 서비스는 Python과 FastAPI로 구현한다([ADR-0004](0004-python-fastapi-ai-service.md)). DB·인증·배포 방식은 추후 확정한다.

## 고려한 대안

새 언어·프레임워크 도입에 따른 학습 부담보다 팀의 기존 개발 경험 활용을 우선해 Java와 Spring을 채택했다.

## 결과

- **얻는 것**: 학습 부담 감소, 익숙한 기술을 활용한 구현·리뷰·오류 대응
- **감수하는 것**: Python·FastAPI AI 서비스와의 API 연동 필요
- **후속 작업**: 프로젝트 초기 구성, DB·인증 방식 확정, 모바일·워치 API 계약 정리
