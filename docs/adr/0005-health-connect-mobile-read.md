# ADR-0005: 건강 데이터는 Android Health Connect와 iOS HealthKit으로 조회한다

| 항목 | 값 |
| --- | --- |
| 상태 | 제안 |
| 결정일 | - |
| 결정자 | - |
| 관련 | [S15P31E105-60](https://ssafy.atlassian.net/browse/S15P31E105-60), [ADR-0001](0001-react-native-mobile-app.md) |

## 맥락

후속 제안: [ADR-0006](0006-samsung-health-direct-read.md)은 사용자의 기존 기록 직접 조회 요청에 따라 Android 경로를 확장한다. 두 문서는 팀 합의 전 제안 상태이며 채택/대체로 임의 변경하지 않는다.

Android의 삼성 헬스·Health Connect 및 iPhone의 Apple 건강 앱에 있는
수면·일반 심박·안정 시 심박·HRV·걸음 수·최근 운동·거리 기록을 읽는 검증 기능이 필요하다.
사용자는 iPhone에서 워치 연결 없이 기존 건강 기록을 조회하도록 요청했다.
기존 워치 앱의 Health Services 운동 수집과 별도로 과거 건강 기록을 읽는 경로가 필요하다.
모바일 프레임워크는 React Native로 채택되어 있다.

## 결정

(가정) React Native 앱에서 OS를 자동 판별하고 Android는 Health Connect,
iOS는 HealthKit 읽기 API를 사용한다. 공통 화면·결과 모델에 플랫폼별 어댑터를 둔다.
Android는 `react-native-health-connect`, iOS는 `@kingstinct/react-native-healthkit`을
우선 검토하고 실제 버전 호환성과 필요한 API 지원을 확인한 뒤 고정한다.

Android 안정 시 심박은 삼성 헬스 출처를 먼저 조회하고 빈 결과면 같은 Health Connect의
다른 출처를 조회해 실제 출처를 표시한다. 삼성 직접 SDK 연동을 추가하거나
공유되지 않은 삼성 데이터를 Health Connect가 생성한다고 가정하지 않는다.
iOS에서는 워치 페어링·WatchConnectivity를 요구하지 않고 HealthKit의 기존 기록을 읽는다.

검증 앱은 읽기 권한만 요청하고 서버 전송·백그라운드 수집·건강 기록 쓰기를 하지 않는다.
일반 심박과 안정 시 심박을 별도로 표시한다. HRV는 Android RMSSD와 iOS SDNN을
구분하며 값이 없을 때 심박수로 추정하지 않는다. iOS 읽기 권한 거부와 데이터 없음은
구분할 수 없으므로 권한 요청 성공을 읽기 허용으로 표시하지 않는다.

## 고려한 대안

| 대안 | 장점 | 단점 |
| --- | --- | --- |
| React Native + Health Connect/HealthKit 래퍼 (제안) | 팀 프레임워크 유지, 플랫폼별 공식 저장소 조회 | 래퍼 호환성 검증과 양쪽 네이티브 빌드가 필요하고 원천 앱의 공유 범위에 의존 |
| React Native + 자체 Kotlin/Swift 모듈 | 양쪽 공식 API 직접 제어 | 네이티브 모듈·권한·변환 코드의 유지 비용 증가 |
| Samsung Health Data SDK 직접 연동 | 삼성 전용 데이터 접근 가능성 | 공개 배포용 삼성 파트너 승인·앱 등록 및 SDK 연결 검토 필요 |
| 별도 Kotlin 휴대폰 앱 | Android API 직접 사용 | 채택된 모바일 앱과 코드베이스가 분리되고 기능 통합 비용 발생 |

## 결과

- **얻는 것**: 기존 모바일 방향을 유지하면서 삼성 헬스 기록의 실제 수집 가능 여부를
  항목별로 확인하고, 향후 서버·모델 연동에 앞서 결측·권한·출처를 구분할 수 있다.
- **감수하는 것**: 각 건강 저장소에 존재하는 값만 조회한다. 삼성 안정 시 심박과 HRV의
  공유 여부는 실기기 확인이 필요하다. 아이폰 자체가 모든 지표를 측정하는 것은 아니며
  Apple Watch 없는 상태에서도 기존 기록이 있어야 심박·HRV 등을 볼 수 있다.
  Bluetooth 연결·배터리·실시간 워치 스트림을 이 경로로 확인했다고 볼 수 없다.
  HRV 지표와 읽기 권한 상태 모델을 플랫폼 간 단순 통합할 수 없다.
- **후속 작업**: 설계 검토, 패키지 호환성·빌드 검증, 권한·출처·날짜 처리 구현,
  양쪽 실기기 비교 및 배포 시 건강 앱·데이터 이용 신고 조건 문서화.
  iOS 빌드·서명·실기기 검증은 macOS/Xcode 환경이 필요하다. 팀 합의 전까지 제안 상태를 유지한다.
