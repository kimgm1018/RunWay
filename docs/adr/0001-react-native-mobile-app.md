# ADR-0001: 모바일 앱은 React Native로 구현한다

| 항목 | 값 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-20 |
| 결정자 | FE 담당, 팀 합의 |
| 관련 | [S15P31E105-58](https://ssafy.atlassian.net/browse/S15P31E105-58), [ADR-0002](0002-kotlin-wear-os-app.md), [ADR-0003](0003-java-spring-backend.md) |

## 맥락

러닝 목표 설정, 운동 중 정보 표시, 기록 조회를 제공하는 모바일 앱이 필요하다. 갤럭시(Android)와 아이폰(iOS) 사용자를 모두 지원해야 한다. Galaxy Watch 앱은 별도로 개발한다.

## 결정

Android와 iOS를 모두 지원하기 위해 모바일 앱은 React Native로 구현하고 소스는 `frontend/`에서 관리한다. 워치 앱은 Kotlin으로 개발한다([ADR-0002](0002-kotlin-wear-os-app.md)).

## 고려한 대안

Kotlin, React Native, Flutter를 검토했다. 갤럭시(Android)와 아이폰(iOS)을 모두 지원하기 위해 React Native를 채택했다.

## 결과

- **얻는 것**: 하나의 모바일 앱 코드베이스로 Android·iOS 지원
- **감수하는 것**: Android·iOS 각각의 동작 검증과 별도 워치 앱 개발 필요
- **후속 작업**: 프로젝트 초기 구성, Android·iOS 실행 검증, 워치 통신 및 백엔드 API 연동 설계
