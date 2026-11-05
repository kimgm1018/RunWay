# API 명세 — AI 페이스·실시간 분석·BPM

[API 명세 색인](README.md)으로 돌아가기.

| ID | 이름 | Method | Endpoint | 단계 | 인증 |
| --- | --- | --- | --- | --- | --- |
| P07 | 세션 BPM 조절 | PUT | `/running-sessions/{sessionId}/bpm` | 1차 MVP | 회원 |

## ERD 응답 대응 기준

현재 BPM은 `running_sessions.current_bpm`, 명령 실행 결과는 `session_control_events`, AI 추천은 `coaching_decisions`에 저장한다. 초기 계획은 `pace_plans`를 사용한다. 자료형·제약은 [SQL](../db/schema.sql), 중복·버전 처리는 [세션 제어 공통 계약](sessions.md#세션-제어-공통-계약)을 따른다.

## P07 세션 BPM 조절

`PUT /api/v1/running-sessions/{sessionId}/bpm`

본인 세션·등록된 제어 워치를 확인한다. 앱의 수동 SET_BPM은 건강정보를 사용하지 않으므로 동의를 검사하지 않는다. 서버 내부 COACHING은 건강정보 미동의 세션에 발행하지 않으며, 이미 승인된 COACHING의 RESULT 저장은 동의 철회만으로 막지 않는다(2026-11-05 S15P31E105-257 확정). **변경 승인(REQUEST) → 워치 적용 → 결과 저장(RESULT)** 순서다. 승인 응답만으로 BPM이 실제 적용됐다고 표시하지 않는다.

### Path Parameters

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `sessionId` | integer (int64) | O | 본인 운동 세션 ID. 양의 정수 |

Query Parameters는 없다. 모든 ID는 양의 정수다. 필수 O는 키를 포함한다는 뜻이며, 값 없음은 null로 구분한다.

### 1. 변경 승인 — REQUEST

#### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | `REQUEST`(변경 승인 요청) 고정값 |
| `operation` | string (enum) | O | 앱은 `SET_BPM`(사용자가 지정한 BPM으로 변경)만 사용.<br>`COACHING`(자동 코칭)은 서버 내부 전용 |
| `deviceId` | integer (int64) | O | BPM을 적용할 현재 제어 워치 ID. 양의 정수 |
| `expectedVersion` | integer (int64) | O | 변경 기준 stateVersion. 1 이상 |
| `targetBpm` | integer | O | 변경할 박자. 60~220, 1 BPM 단위 |
| `coachingId` | integer (int64) / null | O | 앱의 SET_BPM 요청은 null. 서버 내부 COACHING은 적용할 추천 ID 사용 |

```json
{"phase":"REQUEST","operation":"SET_BPM","deviceId":101,"expectedVersion":2,"targetBpm":165,"coachingId":null}
```

#### Response — 200 OK

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 서버가 발급한 명령 번호. 재전송 시 같은 번호 반환 |
| `action` | string (enum) | O | `SET_BPM`(수동 BPM 변경), `COACHING`(서버 자동 코칭).<br>위 앱 요청에 대한 응답은 `SET_BPM` |
| `expectedVersion` | integer (int64) | O | 이 명령의 승인 기준 버전 |
| `targetBpm` | integer | O | 이 명령으로 적용할 BPM |
| `coachingId` | integer (int64) / null | O | 연결된 AI 추천 ID. 수동 변경은 null |
| `result` | string (enum) | O | `PENDING`(실행 결과 대기), `APPLIED`(적용 완료), `REJECTED`(적용 거절), `IGNORED`(코칭 미적용), `UNKNOWN`(실행 여부 미확인).<br>최초 승인은 PENDING, 재요청은 저장된 현재 결과. IGNORED는 코칭에만 사용 |

```json
{"commandId":501,"action":"SET_BPM","expectedVersion":2,"targetBpm":165,"coachingId":null,"result":"PENDING"}
```

### 2. 워치 적용 결과 저장 — RESULT

폰이 워치의 실행 결과를 받아 같은 API로 보고한다.

#### Request Body

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `phase` | string (enum) | O | `RESULT`(워치 실행 결과 보고) 고정값 |
| `commandId` | integer (int64) | O | 결과를 보고할 서버 명령 번호 |
| `deviceId` | integer (int64) | O | 해당 명령을 실행한 워치 ID |
| `result` | string (enum) | O | `APPLIED`(적용 완료), `REJECTED`(적용 거절), `IGNORED`(코칭 미적용), `UNKNOWN`(실행 여부 미확인).<br>IGNORED는 코칭에만 사용하며 PENDING은 보고할 수 없음 |
| `appliedAt` | string (date-time, UTC) / null | O | APPLIED이면 실제 적용시각, 그 외는 null |
| `reasonCode` | string / null | O | 거절·미적용·미확인 등의 사유 코드. 없으면 null |

```json
{"phase":"RESULT","commandId":501,"deviceId":101,"result":"APPLIED","appliedAt":"2026-10-28T01:00:01Z","reasonCode":null}
```

#### Response — 200 OK

아래 명령 결과 필드와 [S02의 최신 세션 상태 전체](sessions.md#s02-러닝-세션-조회)를 함께 반환한다. 공통 상태 필드 정의는 S02를 재사용한다.

| 필드 | 타입 | 필수 | 설명 |
| --- | --- | :---: | --- |
| `commandId` | integer (int64) | O | 저장 확인한 명령 번호 |
| `result` | string (enum) | O | `APPLIED`(적용 완료), `REJECTED`(적용 거절), `IGNORED`(코칭 미적용), `UNKNOWN`(실행 여부 미확인) 중 저장된 결과.<br>IGNORED는 코칭에만 사용 |
| `persisted` | boolean | O | true: 실행 결과의 서버 저장 완료. result가 APPLIED라는 뜻은 아님 |
| `stateVersion` | integer (int64) | O | 결과 저장 후 최신 버전. 확정 결과 최초 저장 시 1 증가, UNKNOWN·같은 결과 재전송은 증가하지 않음 |
| `state` | string (enum) | O | `READY`(운동 준비), `RUNNING`(운동 중), `PAUSED`(일시정지), `COMPLETED`(종료), `CANCELLED`(취소), `INTERRUPTED`(중단) |
| `currentBpm` | integer / null | O | 서버에 확정된 현재 BPM. 거절·미확인 결과만으로 BPM을 바꾸지 않음 |

BPM 관련 필드만 발췌한 응답 예시(나머지 공통 상태 필드는 S02와 동일):

```json
{"commandId":501,"result":"APPLIED","persisted":true,"stateVersion":3,"state":"RUNNING","currentBpm":165}
```

### 적용 조건과 오류

| 현재 상태 | BPM 처리 |
| --- | --- |
| READY / PAUSED | 값만 저장, 박자 재생하지 않음(playbackActive=false). 운동 재개 시 최신값 사용 |
| RUNNING | 확정된 새 BPM으로 박자 재생(playbackActive=true) |
| 종료·취소·중단 | BPM 변경 거절 |
| 폰으로 기록 전환(PHONE_FALLBACK) | 수동·AI BPM 모두 중단, currentBpm=null. 새 요청은 409 COACHING_UNAVAILABLE |

같은 명령은 다시 실행하지 않는다. 같은 BPM의 새 명령을 확정해도 버전은 증가하지만 박자를 다시 초기화하지 않는다. 결과·현재 BPM·버전은 함께 저장한다. 400/401/403/404/409/503과 재시도 규칙은 [세션 공통 계약](sessions.md#세션-제어-공통-계약)을 따른다. 워치가 재연결돼도 해당 운동의 코칭은 자동 재개하지 않는다.

## 코칭 입력·20초 유효성

원본은 생산 기기에서 최대 5초 동안 모아 전송하고, 서버는 새 배치 저장 후 최신 입력으로 코칭 필요 여부를 판단한다. 계산 중이면 새 입력은 다음 계산에 반영한다. 전송 주기마다 코칭을 반드시 발행하는 것은 아니며, 아래 20초 기준은 전송·수신 시각이 아닌 실제 측정 시각을 기준으로 유지한다.

- 모델의 `modelVersion / requiredMetrics / windowSec / minSamples / missingPolicy`에 맞는 입력이 필요하다. 필수 입력이 부족하면 INPUT_INSUFFICIENT로 코칭을 중단하며 가짜 측정값으로 채우지 않는다.
- 입력 기준시각은 **필수 지표별 최신 측정시각 중 가장 오래된 시각**이다. 계산 중 stateVersion이 바뀌거나 입력이 20초 이상 오래되면 추천을 보내지 않는다.
- `expiresAt = min(추천 생성시각 + 20초, 입력 기준시각 + 20초)`다. 입력 12:00:00·추천 생성 12:00:03이면 만료는 12:00:20이다. 백엔드는 남은 유효시간이 5초 미만인 추천을 보내지 않으며, 그래서 입력 기준시각이 12초 이상 지난 입력으로는 AI04를 부르지 않는다(S15P31E105-421). DB에는 기존 `based_on_state_version / expires_at`만 사용하며 둘 다 null인 과거 추천은 적용하지 않는다.
- 계산 중 들어온 새 입력은 다음 계산에 반영한다. 다른 명령이 미확인이면 코칭을 쌓지 않고 다음 최신 입력으로 다시 판단한다.

서버는 추천의 세션·기준 버전·BPM·만료 여부를 확인한 뒤 COACHING 명령을 생성한다. `based_on_state_version=expectedVersion`, `cue_bpm=targetBpm`이어야 하며 기준 버전·만료 값이 모두 있어야 한다. 옛 추천의 버전만 바꿔 새 명령으로 만들지 않는다. 명령은 S10→폰→MessageClient로 전달한다.

워치는 같은 commandId의 저장 결과를 먼저 확인해 있으면 그대로 재응답한다. 최초 처리에서만 **RUNNING·버전 일치·아직 적용하지 않은 coachingId·만료 전**일 때 적용한다. 만료 판단은 서버 기준시각에 추정 오차를 더해 검사한다. 조건을 만족하지 않으면 IGNORED / GUIDE_STALE로 보고한다. 수동 BPM 변경·일시정지 뒤 도착한 옛 추천도 적용하지 않는다. 자세한 시각 규칙은 [서버 기준 시각](../watch-mobile-server-integration.md#서버-기준-시각과-gps)을 따른다.

## 만료된 승인 명령과 결과 보고

만료 전에 COACHING 명령이 승인됐다면, 전달 중 만료돼도 실제 적용 여부를 확인해야 한다. 폰은 기존 COACHING_GUIDE를 결과 확인용으로 전달하고 워치는 저장된 결과를 재응답한다. 최초 처리에서 이미 만료됐다면 적용 없이 `IGNORED / GUIDE_STALE`을 저장·보고한다. 서버 저장 확인 전에는 새 조작을 겹쳐 실행하지 않는다.

S02/S10은 최신 유효 `coaching`과 미확정 명령의 `pendingCommand.coachingGuide`를 구분한다. 후자는 만료 후에도 원래 승인 payload를 포함하므로 재접속으로 폰의 보관본이 없어도 결과를 확인할 수 있다. 새 REQUEST는 만료된 추천을 거절하지만, 같은 명령의 RESULT 저장은 추천 만료·자동 코칭 중단만으로 거절하지 않는다. 권한·기기 변경·이미 확정된 상충 결과의 검사는 유지한다.

결과·서버 ACK 유실·중복 재전달·워치 단절 시 처리는 [세션 공통 계약](sessions.md#만료된-코칭의-결과-확인)을 따른다. 새 명령·메시지 타입·DB 컬럼은 추가하지 않는다.

## 코칭을 보내는 시점

고정 주기 대신 다음 **두 조건 중 하나**를 만족하면 최신 데이터로 판단해 코칭을 보낸다.

| 발행 조건 | 안내 내용 |
| --- | --- |
| AI가 새 코칭이 필요하다고 판단 | 현재 안내와 비교해 페이스·BPM·음성 Cue의 조정이 필요한 경우 안내 |
| 코칭 없이 2분 경과 | 상태를 다시 평가해 안내. 조절이 필요 없으면 현재 페이스·BPM 유지 안내 |

- **2분 기준:** 마지막 실제 운동 시작·재개 시각과 마지막 코칭 적용시각 중 가장 최근 시각부터 계산한다. 서버에 APPLIED로 확인된 실제 시각을 사용하며, 생성·전송·폰 수신만으로 기준시각을 갱신하지 않는다.
- **발행 전제:** 워치로 기록 중이고 RUNNING이며, 20초 신선도와 모델 입력 조건을 만족해야 한다. 서버는 폰의 S10 구독이 열려 있는 세션에만 발행한다. 전달할 수 없는 미확정 명령이 사용자 조작을 막지 않게 하기 위해서다(2026-11-05 S15P31E105-257 확정). 일시정지·종료·폰 기록 전환·입력 부족이면 2분이 지나도 발행하지 않는다. 재개 시 실제 재개시각부터 다시 계산한다.
- **반복 방지:** 같은 조정 판단을 연속 발행하지 않는다. 현재 제어기기의 PENDING/UNKNOWN 명령은 결과부터 확인한다. 거절·미적용·미확인 결과는 코칭 적용으로 세지 않으며, 같은 실패를 새 명령으로 연달아 반복하지 않는다. 서버는 실패 사유를 해석하지 않고, 적용되지 않은 코칭(REJECTED·IGNORED) 뒤에는 그 명령의 발행 시각부터 **30초**가 지나야 다시 발행하는 방식으로 반복을 막는다(2026-11-05 S15P31E105-257 확정). AI 연동(S15P31E105-421) 뒤에도 사유별 해제 조건은 두지 않고 이 30초 간격을 유지한다. 2분 전 AI가 제안한 변경은 현재 안내와 페이스·BPM이 다를 때만 보내며, 마지막 실제 시작·재개·코칭 적용 후 30초가 지나야 한다(첫 감속 권고 `EASE_OFF`는 예외. 감속 권고가 이어지면 30초를 지키고 현재 안내보다 10초/km 이상 느릴 때만 보낸다. 2026-11-05 확정). 세션당 AI04 호출은 15초에 한 번이다. 상세는 [AI04 백엔드 호출 구현](ai-service.md#백엔드-호출-구현-s15p31e105-421).
- **유지 안내:** 2분 안내에는 같은 내용의 유지 안내도 허용한다. AI가 조정을 제안하지 않으면 현재 안내 페이스·BPM을 그대로 보낸다. 현재 BPM이 아직 없으면 AI 판단을 그대로 보낸다. BPM을 무조건 바꾸지 않으며 같은 BPM이면 박자를 초기화하지 않는다. 코칭은 기존 COACHING 명령과 적용 결과로 확인한다.
- **사용자 BPM 우선:** 러닝 시작 뒤 사용자가 직접 바꾼 BPM이 적용되면(출발 전 선택은 시작 BPM으로 보고 제외) 그 러닝이 끝날 때까지 자동 코칭은 BPM을 바꾸지 않고 페이스 안내만 갱신한다(2026-11-05 S15P31E105-421 확정).

**2분은 안내가 없을 때 다시 판단하는 기준**, **20초는 오래된 입력·코칭을 차단하는 유효시간**이다. 2분이 지나도 만료된 코칭을 재사용하지 않는다.

## 러닝 모드별 분석 정책

| 모드 | AI 동작 |
| --- | --- |
| 코스 지정 | 실제 미래 경사로 사전 계획 생성, 이후 30/60/120초 뒤 심박을 예측해 목표와 심박 부담에 맞는 페이스·BPM·음성 Cue 추천 |
| 목표 있는 자유러닝 | 미래 경사 0%로 사전 계획 생성, 이후 같은 방식으로 실시간 코칭 |
| 무목표 자유러닝 | 사전 계획 없이 미래 경사 0%에서 후보 페이스별 심박 예측. 심박 부담·페이스 급변 최소화·현재 페이스 유지를 기준으로 추천 |

상세는 [모드별 AI 동작](../requirements.md#러닝-모드별-ai-동작)을 따른다. 목표 대비 차이·예상 완주 시간은 계산 근거가 있을 때만 제공한다. 사전 계획이 없는 경우와 분석 실패를 구분한다.

## 자동 수집·분석과 지속 전달 — 내부 필수 처리

초기 계획은 S01/S08, 측정값 업로드는 W07, 상태·코칭 전달은 S10→MessageClient, 재진입 상태 조회는 S02를 사용한다. P01~P06 별도 REST는 추가하지 않는다. 폰으로 기록을 넘긴 운동과 온라인 입력이 부족한 경우에는 코칭을 중단한다. 인터넷 단절 중 운동 지속·장기 복구는 지원하지 않는다.
