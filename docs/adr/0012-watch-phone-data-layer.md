# ADR-0012: 워치·폰 통신은 MessageClient 배치와 DataItem 상태 공유를 사용한다

| 항목 | 값 |
|---|---|
| 상태 | 채택 |
| 결정일 | 2026-10-26 |
| 결정자 | 설계 담당자(강현) |
| 관련 | [S15P31E105-175](https://ssafy.atlassian.net/browse/S15P31E105-175), [173번 상세 계약](https://ssafy.atlassian.net/browse/S15P31E105-173), [연동 설계](../design/watch-mobile-server-integration.md), [Kotlin 워치 앱 ADR-0002](0002-kotlin-wear-os-app.md) |

## 맥락

이번 MVP는 Galaxy Watch와 갤럭시 폰을 사용한다. 폰은 서버 인증과 업로드를 중계한다. 워치에서 만든 작은 운동 기록 배치와 명령을 폰으로 전달하고, 연결이 끊겼다가 복구되면 저장 여부를 확인하지 못한 배치를 다시 보내야 한다. 큰 미디어 파일이나 음성 원본을 연속 전송하는 기능은 이번 범위에 없다.

실시간 기록과 복구 기록은 모두 배치 식별·저장 확인·중복 제거·재시도가 필요하다. 두 경로에 다른 전송 방식을 사용하면 채널 관리와 실패 복구를 각각 구현하고 검증해야 한다.

2026-10-26 설계 담당자 강현이 MessageClient 통합과 배치 생성 규칙을 설계·ADR에 반영하도록 확정했다. 이 결정에 대한 구현과 실기기 성능 검증은 아직 수행하지 않았다.

## 결정

워치↔폰에서 명령을 전달하거나 현재 기록·누적 기록을 보낼 때는 Wear OS Data Layer의 MessageClient를 사용한다. 최신 상태 스냅샷은 DataClient/DataItem으로 공유한다. ChannelClient는 이번 MVP에서 사용하지 않는다.

- 워치 앱은 원본을 작은 배치로 만든다. 폰은 배치의 원래 ID와 내용을 유지해 서버로 중계한다. 배치 생성 주기·크기·전송 우선순위는 연동 설계에서 관리한다.
- MessageClient의 발신 성공만으로 상대 기기나 서버의 영속 저장이 끝났다고 판단하지 않는다. 앱의 영속 큐·단계별 ACK·멱등 처리·재시도로 전송 신뢰성을 확보한다. 연결이 없으면 로컬에 보관하고, 재연결 후 복구한다.
- DataItem은 워치와 폰의 최신 상태를 맞추는 용도다. DataItem만 보고 명령을 실행하지 않으며, 전체 이력 저장소나 배치 저장 완료 확인을 대신하는 수단으로도 쓰지 않는다. 버전을 검사해 오래된 스냅샷이 이미 적용한 명령 결과를 되돌리지 못하게 한다.
- `user_devices`·`sync_batches`의 역할은 전송 수단과 독립적이다. 사용 흐름은 연동 설계의 2장, 상세 DB·API 계약은 해당 기준 문서와 173번을 따른다.

## 고려한 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| MessageClient로 명령·현재/복구 배치 통합 + DataItem 최신 상태 (선택) | 현재 기록과 복구 기록에 같은 배치 처리·ACK·재시도를 사용해 전송 경로를 줄일 수 있음 | MessageClient가 자동 재시도나 영속 보관을 대신하지 않음. 배치가 많이 쌓였을 때 복구 처리량 검증 필요 |
| 현재 원본은 MessageClient, 복구는 ChannelClient | 큰 파일이나 많은 데이터를 연속 바이트 스트림으로 전송할 수 있음 | 채널 열기·닫기, 메시지 경계, 중단 후 복구를 별도로 관리해야 함. 누적 기록도 작은 배치로 나눠 보낼 수 있어 현재는 도입 필요성이 낮음 |
| 원본 배치도 DataItem으로 동기화 | 전송 계층의 영속 동기화를 활용할 수 있음 | 최신 상태와 전체 원본 이력은 보관 기간과 삭제 정책이 다름. 배치별 정리와 서버 ACK 연결이 복잡해짐 |

## 결과

- **얻는 것**: MVP의 전송 경로와 장애 테스트 범위를 줄이고 실시간·복구 데이터의 동일 식별 규칙을 유지한다.
- **감수하는 것**: 앱에서 저장 확인·재시도·메시지 크기 제한을 관리해야 한다. 지연·처리량·전력은 실측하며, ChannelClient보다 항상 유리하다고 가정하지 않는다.
- **후속 작업**: 173번에서 원본/배치 식별·해시·ACK·부분 실패 계약을 확정한다. 폰·워치의 앱 ID와 서명을 맞추고 실제 사용할 Wearable 라이브러리 버전을 확정한다. 화면 꺼짐·연결 단절·ACK 유실·큰 복구 대기열 상황에서 지연·처리량·전력을 검증한다. 복구 성능이 제품 허용 기준에 미달하거나 큰 파일 전송이 필요해지면 별도 ADR에서 ChannelClient 도입을 재검토한다.

## 기술 근거

확인일: 2026-10-26. 현재 워치 버전 카탈로그에는 `play-services-wearable:18.0.0`이 선언돼 있지만 앱 의존성에는 연결되지 않았다. 아래 공식 가이드와 API 문서를 참고했으며, 해당 버전의 실제 동작·설치 검증은 아직 수행하지 않았다. MessageClient는 `sendMessage`를 기준으로 사용하며, 더 최신 API인 `sendRequest`의 지원을 전제로 하지 않는다.

- [Data Layer 클라이언트 비교](https://developer.android.com/training/wearables/data/client-types): MessageClient의 연결 전제·자동 재시도 부재, DataItem의 영속 동기화, ChannelClient의 큰 파일·스트림 용도를 비교한다.
- [MessageClient](https://developers.google.com/android/reference/com/google/android/gms/wearable/MessageClient): sendMessage는 작은 메시지(일반적으로 100k 이하)용이며 성공 결과도 전달을 보장하지 않는다. 상세 크기 초기값은 연동 설계를 따른다.
- [연결·보안 조건](https://developer.android.com/training/wearables/data/overview): 폰과 워치 앱은 같은 패키지명·서명을 사용해야 한다.
