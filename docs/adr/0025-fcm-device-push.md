# ADR-0025: 앱 밖 알림은 FCM HTTP v1로 Android 기기에 푸시한다

| 항목 | 값 |
|---|---|
| 상태 | 채택 |
| 결정일 | 2026-11-14 |
| 결정자 | E105 팀 합의(S15P31E105-815 담당자가 확인) |
| 관련 | [S15P31E105-815](https://ssafy.atlassian.net/browse/S15P31E105-815), [S15P31E105-458](https://ssafy.atlassian.net/browse/S15P31E105-458)(앱 내 알림함만 제공하던 결정 변경), [알림 정책](../design/requirements.md#알림-정책), [N01~N04](../design/api/notifications.md), [ERD push_device_tokens](../design/db/erd.md), [Secret 규칙](../development/secret-environment-variables.md), [ADR-0001](0001-react-native-mobile-app.md), [ADR-0023](0023-run-share-app-links.md) |

## 맥락

S15P31E105-458(2026-11-06)은 1차 MVP 알림 채널을 앱 내 알림함으로 한정하고 FCM 등 앱 밖 푸시를 제외했다. 그 결과 그룹런 취소·크루 가입 결과·댓글·팔로우 소식을 앱을 열기 전까지 알 수 없어, 그룹런 취소처럼 시간이 중요한 알림을 놓친다. 팀은 S15P31E105-815에서 이 제외를 풀고 같은 알림을 기기 푸시로도 보내기로 합의했다.

제약은 다음과 같다.

- 모바일 앱은 Bare React Native(ADR-0001)이고 이번 대상은 Android다. iOS(APNs)·스토어 출시·마케팅성 대량 발송은 범위 밖이다.
- 알림함 행은 각 도메인 서비스 트랜잭션 안에서 공통 알림 모듈이 만든다. 팔로우 사건 소비는 같은 트랜잭션의 `@EventListener`여야 한다(notifications.md). 롤백된 사건이 푸시되면 안 되고, 외부 호출이 도메인 요청 응답을 늦추면 안 된다.
- 서버 Secret은 평문 파일로 두지 않고 환경변수·승인된 Secret 저장소로 주입한다.
- 알림 설정은 기존 groupRun·community 두 개뿐이며 새 설정 컬럼을 추가하지 않는다.

## 결정

알림함 행이 새로 생기면 생성 트랜잭션 **커밋 후** 별도 실행기에서 Firebase Cloud Messaging **HTTP v1**(서버 `firebase-admin` Java SDK)로 수신자의 Android 기기 토큰마다 푸시를 보낸다. 앱은 `@react-native-firebase/messaging`으로 토큰을 받아 새 API(N03/N04)로 등록·해제한다.

- 토큰은 `push_device_tokens`(전역 UNIQUE, 회원당 최근 10개)에 둔다. 같은 기기에서 계정을 바꾸면 소유자를 옮긴다.
- `notifications.delivery_status`/`sent_at`은 푸시 결과로 의미를 바꾼다. 새 행은 PENDING으로 저장되고 1개 이상 성공 시 SENT, 모두 실패 시 FAILED다. 기존 행은 바꾸지 않는다.
- FCM `UNREGISTERED`·`INVALID_ARGUMENT`·`SENDER_ID_MISMATCH` 토큰은 삭제하고, 일시 오류는 토큰을 유지한다. 재시도 큐는 두지 않는다.
- 현재 생성되는 알림 종류는 모두 푸시하며 기존 설정 두 개가 알림함과 푸시를 함께 결정한다. 앱이 열려 있으면 시스템 알림 대신 미읽음 수만 갱신한다.
- 서버 키는 서비스 계정 JSON의 base64 값(`BACKEND_FCM_SERVICE_ACCOUNT_BASE64`)으로, 기능은 `BACKEND_PUSH_ENABLED`로 켠다. 앱의 `google-services.json`은 Git에서 제외하고 개발자가 로컬에 둔다. 파일이 없으면 앱은 푸시 없이 빌드된다.

## 고려한 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| A. FCM HTTP v1 + firebase-admin, 커밋 후 비동기 발송 (선택) | Android 표준 경로. OAuth 토큰 갱신·오류 코드 분류를 SDK가 처리. 롤백 사건 미발송, 요청 응답 지연 없음 | Google 의존성 추가(Firestore·Storage 클라이언트는 제외). 서버 재시작·대기열 초과 시 그 푸시는 유실(행은 PENDING으로 남음) |
| B. FCM HTTP v1을 RestClient와 google-auth-library로 직접 호출 | 의존성이 더 가볍다 | 메시지 형식·오류 응답 해석·토큰 갱신을 직접 구현·유지해야 한다 |
| C. 같은 트랜잭션 안에서 동기 발송 | 구현이 단순 | 롤백돼도 푸시가 나가고, FCM 지연이 도메인 요청·DB 잠금 시간을 늘린다 |
| D. 아웃박스 테이블 + 스케줄러 재시도 | 재시작·일시 오류에도 다시 보낸다 | 이번 범위에 비해 스키마·운영 비용이 크다. 알림함이 이미 원본 기록이라 유실 영향이 제한적 |
| E. 앱 내 알림함만 유지(458) | 추가 작업 없음 | 앱 밖에서 시간이 중요한 알림을 받을 수 없다 |

## 결과

- **얻는 것**: 앱이 백그라운드·종료 상태여도 그룹런·크루·커뮤니티·팔로우 알림이 기기에 도착하고, 누르면 알림함과 같은 화면이 열린다. 알림함과 푸시가 같은 설정·중복 방지 키·트랜잭션 결과를 따른다.
- **감수하는 것**: 실패 푸시를 자동으로 다시 보내지 않는다. 앱이 열려 있을 때는 시스템 알림이 뜨지 않는다. Firebase 콘솔·키 관리라는 운영 의존성이 생긴다. `delivery_status`의 V42 이전·이후 의미가 다르다.
  - FCM 장애·지연 때는 SDK 기본 재시도(일시 오류 재시도, 대기 최대 60초)와 토큰별 순차 발송 때문에 발송 스레드 2개가 오래 묶일 수 있다. 대기열(1000건)이 차면 그 뒤 알림의 푸시는 건너뛰고 행은 PENDING으로 남는다. 알림함은 영향이 없다. 장애가 잦으면 발송 시간 상한·아웃박스를 후속으로 다룬다.
  - 같은 회원이 서로 다른 새 토큰을 동시에 등록하면 상한 정리가 서로의 새 행을 보지 못해 잠시 10개를 넘을 수 있다. 다음 등록 때 정리된다.
  - 발송 직전 소유자 재확인 뒤에도 토큰 1개를 보내는 동안 그 기기가 다른 계정으로 재등록되면 이전 수신자의 알림이 그 기기에 뜰 수 있다(창은 FCM 호출 1회 길이). 로그아웃은 기기 토큰을 삭제하므로 정상 계정 전환에서는 토큰이 바뀌어 이 경우가 생기지 않는다.
  - 로그아웃·세션 만료 때 기기 토큰 삭제를 다음 로그인 등록이 최대 15초 기다린다. 삭제가 그보다 늦게 끝나면 새 계정의 토큰이 지워져 다음 앱 실행·토큰 갱신까지 그 계정에 푸시가 오지 않는다.
  - 로그아웃 시 refresh token까지 거절되는 상태면 N04 요청이 세션 만료 처리로 이어져 로그아웃 뒤 로그인 화면이 열린다(데이터 영향 없음).
  - 로그아웃 상태에서 누른 푸시는 다음 로그인 뒤 그 화면을 연다. 같은 기기의 다른 계정일 수 있으나 대상 화면 API가 열람 권한을 다시 검사하므로 데이터는 노출되지 않는다.
  - 서버 서비스 계정 키와 앱 `google-services.json`이 다른 Firebase 프로젝트면 FCM이 `SENDER_ID_MISMATCH`를 돌려주어 발송된 토큰이 삭제된다. 두 값을 같은 프로젝트로 맞추고, 잘못 배포한 경우 앱을 다시 열면 토큰이 재등록된다.
- **후속 작업**:
  - 인프라 담당과 운영 Secret(`BACKEND_FCM_SERVICE_ACCOUNT_BASE64`)·`BACKEND_PUSH_ENABLED` 주입 연결.
  - FCM이 등록 토큰 API(`getToken`, 서버 `setToken`)를 설치 ID(FID) 등록으로 옮기는 중이다(react-native-firebase v27, firebase-admin 9.11에서 사용 중단 예고). 토큰 API가 막히기 전에 앱 `register`/`onRegistered`와 서버 `setFid`로 전환한다.
  - 그룹런 시작 임박 알림의 생산자(예약 발송)가 생기면 같은 경로로 푸시된다. 필요하면 실패 재시도(아웃박스)와 iOS(APNs)를 별도 ADR로 다룬다.
