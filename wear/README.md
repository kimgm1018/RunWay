# RunWay 워치 앱

Android Studio에서 **이 `wear/` 폴더**를 프로젝트로 연다. 하나의 Gradle 프로젝트에 모듈 두 개가 있다.

| 모듈 | 폴더 | 내용 | applicationId |
| ---- | ---- | ---- | ------------- |
| `:app` | [`app/`](app/) | 제품 워치 앱. 공통 UI·화면 이동 구조(S15P31E105-264)부터 화면·기능을 더한다 | `com.runway.health` (폰 앱과 같아야 Data Layer로 연결된다) |
| `:demo` | [`demo/`](demo/) | 기존 BPM 실험·운동 데이터 수집 앱(S15P31E105-53). [실험 앱 안내](demo/README.md) | `com.runway.watchdemo` |

applicationId가 달라 두 앱을 한 기기에 함께 설치할 수 있다. 제품 기능은 `:app`에만 추가하고 `:demo`는 실험 용도로만 유지한다.

## 제품 앱 구조 (`app/`)

| 패키지 | 역할 |
| ------ | ---- |
| `run` | 운동 상태(READY·RUNNING·PAUSED·COMPLETED·CANCELLED·INTERRUPTED), 측정값, 과거 기록 비교 결과(`RecordComparison`), 그룹 상태(`GroupStatus`), 사용자 요청(`RunIntent`), 실행 제어 인터페이스(`RunControl`) |
| `dailyhr` | 일상 심박: Health Services 배경 수집, 최근 24시간 추정값 계산, 폰 전송·동의 수신 (S15P31E105-63) |
| `readiness` | 러닝 전 준비 상태(S15P31E105-265): 건강정보 동의·워치 센서 권한·서버 기기 등록·인터넷을 각각 `UNKNOWN`/`CHECKING`/`OK`/`MISSING`으로 구분한다. `DeviceReadiness`가 워치에서 직접 확인할 수 있는 동의·권한·기본 네트워크를 읽는다 |
| `cue` | 리듬 BPM 박자(소리·진동) 재생(S15P31E105-257). 데모 `WatchCuePlayer`를 옮긴 `WatchRhythmPlayer`이며 `RhythmPlayer` 인터페이스 뒤에 둔다 |
| `navigation` | 화면 이동 규칙. 화면은 **확정된 운동 상태**로 정해지고, 화면 이동은 운동을 시작·종료하지 않는다 |
| `ui/theme` | 색·글꼴. 모바일 디자인 기준([frontend/DESIGN.md](../frontend/DESIGN.md) 1-1·2-5)을 따른다 |
| `ui/component` | 공통 UI: 원형 화면(`RoundScreen`), 버튼, 측정값·단위, 상태 줄, 칩, 쪽 표시, 가장자리 링, 안내 화면 |
| `ui/format` | 값·단위·미수신(`– –`) 표시. 심박수(`♥ 152`)와 리듬 BPM(`♪ 172 BPM`)을 구분한다 |
| `ui` | 앱 화면 틀(`WatchApp`). 9.1~9.4 화면의 공통 뼈대이며 각 화면 업무(265~269, 256, 257)가 채운다 |
| `ui/screen` | 분리한 화면. `ResultScreen`(9.4, S15P31E105-269): 종료 처리 중·서버 저장 확인/미확인·분석 준비/중/실패/완료를 구분하고, 분석 READY에서만 서버 요약값과 목표 평가를 표시한다. 상태 값은 `run/RunResult.kt` |

화면 구성·흐름은 v15 와이어프레임 9.x, 색·글꼴은 모바일 디자인 기준을 따른다.

- 하단 버튼(뒤로): 러닝 중·일시정지·종료 확인에서는 앱을 닫거나 운동을 끝내지 않는다. 종료 확인에서는 일시정지 화면으로, 러닝 페이지에서는 첫 페이지로 돌아간다.
- 오른쪽으로 쓸어 넘겨 닫기: 대기·연결 문제·결과 화면에서만 앱을 닫는다. 러닝 중·일시정지·종료 확인에서는 좌우 넘기기 페이지와 겹치거나 실수로 닫히지 않도록 막는다(시스템 스와이프 닫기는 끄고 앱에서 화면별로 켠다).
- 준비 상태 안내(9.1b, S15P31E105-265)는 러닝 전 화면(대기·준비 전)에만 적용하며, 한 번에 하나의 문제만 해결 순서대로 보여준다: 폰 연결 → 건강정보 동의 → 센서 권한 → 기기 등록 → 인터넷. 서버 기기 등록은 블루투스 연결과 별개 절차라 폰 연결을 대신하지 않는다. 확인하지 못한 상태(`UNKNOWN`)는 정상으로 표시하지 않으며, `MISSING`만 시작을 막는다. 서버 왕복 확인은 폰이 준비 단계에서 하므로 워치의 인터넷 표시는 OS가 검증한 기본 네트워크 기준이다.
  - 실제 연결: 동의(폰이 공유한 동의 DataItem을 저장한 값), 권한(달리기 측정용 권한. 일상 심박용 백그라운드 권한은 시작을 막지 않는다), 인터넷(기본 네트워크의 `VALIDATED` 여부, 앱이 보이는 동안 감시).
  - 미연결: 서버 기기 등록 상태를 워치로 전달하는 메시지 계약이 없어 항상 `UNKNOWN`이며, 등록 필요 화면은 합성 상태로만 검증했다.
  - `권한 허용`은 권한을 다시 요청하고, OS가 더 이상 묻지 않으면 앱 설정을 연다. `다시 확인`은 폰의 동의 DataItem과 권한·네트워크를 다시 읽는다.
  - 러닝 중 인터넷이 끊기면 상단에 `오프라인 · 저장 미확인`을 표시한다. 오프라인 운동 지속이나 나중의 전체 기록 복구를 지원한다고 안내하지 않는다(온라인 MVP).
- 기록 비교(9.6·9.6b)는 받은 비교 결과만 표시한다. 비교 대상 선택·시간 차이 계산과 워치로 결과를 전달하는 계약은 아직 정하지 않았으며(S15P31E105-267 범위 밖), 실제 연동 전에 `RecordComparison`의 입력 경로를 확정해야 한다. 비교를 고르지 않았거나 비교 기록 이름(`targetLabel`)이 없으면 비교하지 않는 러닝으로 보고 기록 비교 페이지를 빼서(개인 러닝 2쪽) 비교 문구를 표시하지 않는다.
- 그룹런(9.7·9.8, S15P31E105-268)은 서버가 계산해 보낸 값만 표시한다. 순위·앞뒤 인원 수·바로 앞뒤와의 거리 차이는 G10 `participants` 제안 필드, 공동 안내 페이스는 `groupGuidePaceSecPerKm`에 맞췄고 워치는 순위·페이스를 계산하지 않는다. 와이어프레임 9.8은 순위 숫자 대신 선두–후미 간격과 그룹 범위를 두지만, 업무 완료 조건·WAT-008에 따라 순위를 표시한다. 선두–후미 간격(1등과 꼴등 사이 거리, `leaderToLastGapMeters`)은 그룹 전체 값으로 함께 표시하며, G10 제안에 아직 없어 S15P31E105-261에 응답 필드 추가를 요청했다. 그룹 범위 판정은 기준이 정해지지 않아 넣지 않았다. 워치로 전달하는 채널·메시지 계약은 아직 정하지 않았으므로(S15P31E105-261 연동 시 확정) `GroupStatus`의 입력 경로는 합성 데이터로만 검증했다.
  - 순위를 받지 못했거나 계산할 수 없거나 내 위치가 미수신·수집 중단이면 순위·거리 차이를 표시하지 않는다. 지연된 값과 폰 연결이 끊긴 동안의 값은 마지막 값을 흐리게 두고 `순위 지연`으로 구분한다.
  - 그룹 대기·출발·자동 종료·강제 종료(`GroupPhase`)를 개인 운동 상태와 따로 둔다. 그룹런은 그룹장이 출발해야 시작하므로 대기 화면에 시작 버튼이 없고, 준비하지 않아 함께 출발하지 못한 경우를 안내한다. 강제 종료는 결과 화면에 `그룹장이 그룹런을 종료`로 표시하며 목표 달성은 서버 평가만 따른다. 일시정지·종료 등 개인 제어는 개인 러닝과 같은 `RunIntent`를 쓴다.
  - 공동 페이스 변경은 9.7, 선두–후미 간격은 9.8에 표시하고 운동 현황(9.2)의 안내 페이스를 공동 페이스로 바꾼다. 별도 알림함이나 코칭 오버레이(9.2c)는 만들지 않으며 오버레이는 코칭 표시 업무(S15P31E105-257)에서 다룬다.
- 페이스 코칭(9.5, S15P31E105-257)은 서버가 승인한 코칭(`COACHING_GUIDE`)과 사용자의 리듬 BPM 변경(`SET_BPM`)을 처리한다. 계약은 [연동 흐름 9.3~9.5·9.7](../docs/design/watch-mobile-server-integration.md#9-워치폰-messageclient-메시지-명세)과 [페이스 코칭 API](../docs/design/api/pace-coaching.md)를 따른다.
  - −/+ 버튼은 `COMMAND_REQUEST(REQUEST, SET_BPM)` 요청만 보낸다. 서버 승인 `APPLY`를 실행한 뒤에야 박자가 바뀌며 요청 중·적용됨·거절·확인 불가를 표시한다. 앞선 명령(코칭 결과 포함)의 서버 저장 확인 전에는 다음 요청을 보내지 않는다.
  - 박자는 RUNNING에서만 재생하고 READY·PAUSED는 값만 보관한다. 일시정지·종료에서 멈추고 재개하면 최신 BPM으로 다시 재생한다. 같은 BPM은 박자를 다시 시작하지 않는다.
  - 코칭은 같은 commandId의 저장 결과를 먼저 재응답하고, 최초 처리에서만 RUNNING·버전 일치·처음 적용하는 coachingId·만료 전(서버 기준 시각 추정 + 오차)일 때 적용한다. 그 밖에는 `IGNORED`/`GUIDE_STALE`로 저장·보고한다. 서버 시각은 `STATE_QUERY(SERVER)` 왕복으로 추정하며(시작·재개 때와 60초마다, 추정이 없으면 10초마다) 기기 시계를 바꾸지 않는다.
  - 안내 문장은 워치가 만든다(같은 BPM이면 `현재 페이스·리듬 유지`, 다르면 `리듬 BPM 165로 조정`). 서버가 AI04 판단으로 코칭을 보내므로 `더미 안내` 배지는 꺼져 있다(S15P31E105-768). `run/RunModel.kt`의 `Coaching.DUMMY_GUIDE` 하나로 켜고 끈다. 리듬은 `리듬 BPM`, 심박수는 `심박`으로 표시해 구분한다.
  - 운동 중 서버 상태(`STATE_RESULT(SERVER)`)를 45초 동안 받지 못하면 `서버 연결 끊김`을 표시하고, 다시 받으면 지운다. 폰이 서버 스냅샷마다 보내는 이 메시지가 전제다.
- 러닝 중 화면 복귀(S15P31E105-617): 워치가 기록하는 러닝(RUNNING·PAUSED, 휴대폰 인계·측정 끊김 아님) 동안 러닝 서비스 알림을 Wear OS Ongoing Activity로 등록해, 화면이 꺼졌다 켜지면 러닝 화면(마지막으로 보던 쪽)으로 돌아오고 시계 화면·최근 앱에 `러닝 중`/`일시정지`가 나온다. 종료·취소·인계·측정 끊김이 되면 Ongoing Activity를 뺀 알림으로 바꾸고, 서비스가 끝나면 알림도 사라진다. API 33+에서는 알림 권한이 있어야 보이므로 준비 단계에서 선택 권한으로 묻는다(거절해도 러닝은 막지 않음).
  - Ambient(항상 켜짐)를 지원한다. 저전력 화면은 검은 배경에 흰 글자만 쓰고 버튼·게이지·채움 영역이 없다. 러닝 중·일시정지에는 상태·경과 시간(분 단위)·거리만, 그 밖의 화면은 한 줄만 보인다. 값은 시스템 Ambient 갱신(약 1분)이나 화면 상태가 바뀔 때만 바꾸고, 번인 방지가 필요한 기기에서는 갱신마다 내용을 몇 픽셀씩 옮긴다.
- debug와 release 빌드 모두 실제 세션 제어기(`RunSessions`)로 실행한다(S15P31E105-658). 폰이 세션을 준비하기 전에는 고정 코스명·거리·시간·심박을 보이지 않고 대기 화면만 보이며, 앱을 다시 열어도 합성 데이터로 대체하지 않는다. 합성 데이터로 상태를 바로 바꾸는 `SimulatedRunControl`은 `app/src/androidTest`의 UI 테스트 전용이라 제품 APK에 포함되지 않는다. 화면 검증은 `connectedDebugAndroidTest`로 하고, 제품 앱에서 시작·일시정지·재개·종료를 확인하려면 폰에서 세션을 준비해 워치와 연동해야 한다.

## 빠른 빌드

SDK 경로를 `local.properties` 또는 `ANDROID_HOME`으로 설정하고 Android Studio의 JBR을 사용한다. 아래 명령은 `wear/`에서 실행한다.

```powershell
# 제품 앱
.\gradlew.bat :app:testDebugUnitTest :app:lintDebug :app:assembleDebug
# 에뮬레이터·기기 연결 시 화면 이동 검증
.\gradlew.bat :app:connectedDebugAndroidTest
# 실험 앱
.\gradlew.bat :demo:testDebugUnitTest :demo:lintDebug :demo:assembleDebug
```

`connectedDebugAndroidTest`는 AGP 내장 테스트 플랫폼(`gradle.properties`의 `android.experimental.androidTest.builtin_test_platform`)으로 실행한다. 기본 UTP는 AGP 9.4.1에서 Wi-Fi 디버깅 워치(`ip:port` 시리얼)의 결과를 찾지 못해 모든 테스트가 통과해도 작업을 실패로 끝낸다. 실기기 화면이 꺼지면 테스트 화면이 뜨지 않아 실패하므로 실행 중에는 화면을 켜 둔다.

설치 APK: `app/build/outputs/apk/debug/app-debug.apk`, `demo/build/outputs/apk/debug/demo-debug.apk`

제품 `:app`의 debug 빌드는 폰과 Data Layer로 연결되도록 `frontend/android/app/debug.keystore`를 함께 사용한다. 기존 테스트용 파일을 참조하며 새 키를 Git에 추가하지 않는다. 이전에 다른 서명으로 설치한 워치 앱은 삭제 후 재설치해야 하며 앱 내부 데이터는 초기화된다. 정식 배포 서명은 별도다.

제품 `:app`의 release 빌드는 `optimization.packageScope`로 `androidx`·`kotlin`·`kotlinx` 라이브러리만 R8 최적화한다. 이 조합에서 생기는 시작 시 종료를 막는 keep 규칙(Room `*_Impl` 기본 생성자 보존, `-dontrepackage`)과 이유는 `app/src/main/keepRules/release-optimization.keep`에 둔다. 최적화 범위나 WorkManager·Room 버전을 바꾸면 `:app:assembleRelease` 결과를 실기기에서 실행해 확인한다.

로컬 설정·서명 키·빌드 결과·실제 실험 JSON은 Git에 넣지 않는다.
