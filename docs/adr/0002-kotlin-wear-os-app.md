# ADR-0002: Galaxy Watch 앱은 Kotlin으로 구현한다

| 항목 | 값 |
| --- | --- |
| 상태 | 채택 |
| 결정일 | 2026-10-20 |
| 결정자 | 워치 담당, 팀 합의 |
| 관련 | [S15P31E105-58](https://ssafy.atlassian.net/browse/S15P31E105-58), [S15P31E105-53](https://ssafy.atlassian.net/browse/S15P31E105-53), [워치 앱 안내](../../wear/README.md), [Android의 Kotlin 우선 지원](https://developer.android.com/kotlin/first), [Compose for Wear OS](https://developer.android.com/training/wearables/compose) |

## 맥락

Galaxy Watch에서 운동 데이터를 수집하고 운동 중 안내를 제공해야 한다. 센서 측정, 백그라운드 운동 기록, 진동 등 Wear OS 플랫폼 기능을 직접 제어할 수 있는 개발 방식이 필요하다.

## 결정

Galaxy Watch용 Wear OS 앱은 Kotlin으로 구현하고 소스는 `wear/`에서 관리한다. 기존 실험 앱을 바탕으로 서비스 연동을 진행한다.

## 고려한 대안

Android가 우선 지원하는 Kotlin은 Wear OS 네이티브 API와 Jetpack Compose를 활용하기에 적합하다. 운동 데이터 수집과 기기 제어를 직접 구현하고 공식 개발 도구를 활용할 수 있어 채택했다.

## 결과

- **얻는 것**: Wear OS 기능 직접 제어, 공식 UI 도구 활용, 기존 실험 앱 재사용
- **감수하는 것**: 모바일 앱과 별도의 빌드·실기기 검증 필요
- **후속 작업**: 모바일 앱 통신 방식 확정, 권한·연결 중단·백그라운드 동작 검증
