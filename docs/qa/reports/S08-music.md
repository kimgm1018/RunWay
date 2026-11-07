# S08 음악 — 테스트 보고서

| 항목 | 내용 |
| --- | --- |
| Suite | S08 음악 |
| 실행일 | 2026-11-07 |
| 환경 | Android 에뮬(`emulator-5554`) · 설치앱 `com.runway.health` · FE 코드·설정 정적 검증 · Jest(spotify/melon/withSavedMusic) |
| 계정 | 에뮬 UI 세션(기존 로그인). Spotify Premium·멜론 이용권 계정은 에뮬에서 미보유 |
| 실행자 | AI |
| 종합 판정 | Partial (TC-S08-03 통과 · 01·02 Blocked) |
| 스크린샷 정책 | **불통과 항목만** 첨부. 본 Suite 불통과 없음(Blocked만) |

기준 시나리오: `docs/qa/local-integration-test-scenarios.md` §9

### 환경·연동 사전 확인 (비밀값 미노출)

| 항목 | 결과 |
| --- | --- |
| Spotify Client ID (`frontend/src/config.ts` `appConfig.spotifyClientId`) | **존재** (비어 있지 않음). 값 전문은 보고하지 않음 |
| `android/local.properties` Spotify 키 | **없음** (키 이름: `sdk.dir`, `MOBILE_NAVER_MAP_CLIENT_ID`만 확인) |
| Redirect URI | Manifest `runway` / `spotify-callback` 등록 (`spotifyRedirectUri`와 일치) |
| 저장소 배선 | `createRepositories`: Melon 네이티브 있으면 `withMelon` → Client ID 있으면 `withSpotify` → `withSavedMusic` |
| 에뮬 패키지 `com.iloen.melon` | **미설치** |
| 에뮬 패키지 `com.spotify.music` | **미설치** |
| 에뮬 알림 리스너에 RunWay MelonListener | 미포함(미설치 경로와 무관) |
| Jest | `spotify.test.ts` · `melon.test.ts` · `withSavedMusic.test.ts` **PASS**. `homeRun.test.tsx` 1건 타임아웃(음악 TC와 무관) |

### 에뮬 UI 스모크 (비밀번호·토큰 미출력)

경로: 러닝 → 자유 러닝 → 음악 → 음악 연결 설정

| 관찰 | 내용 |
| --- | --- |
| 음악 카드 | 저장된 소스가 Spotify인 상태에서 **연결이 끊겼어요** / Spotify 재확인 안내(2.7b) |
| 음원 시트 | 멜론 → **설치**(`멜론 설치`) · Spotify → **로그인**(`Spotify 로그인`) · 음악 없음 선택 가능 |
| 멜론 설치 탭 | Play Store(`com.android.vending`) 진입. 멜론 미설치 유지. **강제 재생 없음** |

---

## TC-S08-01 — Spotify 연결·제어

| 항목 | 내용 |
| --- | --- |
| ID | TC-S08-01 |
| 우선순위 | Med |
| 사전조건 | Client ID, Spotify Premium, (재생 제어용) 활성 Spotify 기기/앱 |
| 절차 | 1. Client ID·배선·콜백 확인 2. 에뮬 음원 시트에서 Spotify 로그인 CTA 확인 3. Premium 재생/일시정지는 실기기 전제라 에뮬에서 미실행 |
| 기대 결과 | 재생/일시정지 후 카드 상태 반영 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음. Client ID·PKCE·Web API 제어 코드·로그인 CTA는 확인됨. 에뮬에 Spotify 앱·Premium 세션 없어 실제 재생/일시정지·상태 반영 E2E 불가 |
| 개선점 | 실기기 Premium + Spotify 앱으로 OAuth → 재생/일시정지·Premium 미보유 토스트 재검증 |

코드 근거(요약): `withSpotify`가 `/me/player/play|pause` 호출 후 settle 재조회. 실패 사유 `PREMIUM_REQUIRED` / `NO_ACTIVE_DEVICE` 메시지 매핑. 유닛 테스트 PASS.

---

## TC-S08-02 — 멜론(Android)

| 항목 | 내용 |
| --- | --- |
| ID | TC-S08-02 |
| 우선순위 | Med |
| 사전조건 | 멜론 설치(`com.iloen.melon`), 알림 접근·이용권/로그인 상태 |
| 절차 | 에뮬 `pm path com.iloen.melon` → 미설치로 목록·재생 미실행 |
| 기대 결과 | 목록·재생, 권한/이용권 상태 구분 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **Blocked** |
| 불통과 사유 | 해당 없음. 에뮬에 멜론 미설치. 상태 머신·강제 제어 금지는 코드/유닛으로만 확인 |
| 개선점 | 실기기 멜론 설치 후 CONNECTED / PERMISSION_REQUIRED / LOGIN_REQUIRED 및 재생·일시정지·이전/다음 재실행 |

코드 근거(요약): `MelonPolicy.PACKAGE=com.iloen.melon`. `withMelon`은 `linked`·`connected` 아니면 명령 throw. 미설치/`!browsable` → `INSTALL_REQUIRED`. Jest melon 시나리오 PASS.

---

## TC-S08-03 — 미설치/권한 거부

| 항목 | 내용 |
| --- | --- |
| ID | TC-S08-03 |
| 우선순위 | Med |
| 사전조건 | 멜론 미설치(에뮬 기본) |
| 절차 | 1. 음원 시트 진입 2. 멜론 **설치** CTA 확인 3. 설치 탭 → 스토어 안내 4. 재생 명령이 나가지 않음(미연결) 확인 |
| 기대 결과 | 상태별 안내, 강제 재생 없음 |

### 판정

| 항목 | 내용 |
| --- | --- |
| 결과 | **통과** |
| 불통과 사유 | 해당 없음 |
| 개선점 | 실기기에서 알림 접근 거부 시 **허용** CTA → 설정 화면 경로 추가 확인(에뮬은 미설치만 검증) |

검증: UI `멜론 설치` / `설치` 노출 → 탭 시 Play Store 포커스 → Back 후 앱 복귀. 멜론 패키지 여전히 없음. `openMelon`은 미설치 시 `market://details?id=com.iloen.melon`(또는 Play HTTPS). `withMelon`은 미연결 시 `play` 등 미전송.

---

## 사람 재현 목록 (실기기)

| 우선 | TC | 필요 환경 | 절차 요약 | 확인 포인트 |
| --- | --- | --- | --- | --- |
| 1 | TC-S08-01 | Android 실기기 · Spotify 앱 · **Premium** · Client ID 빌드 | 음원 → Spotify 로그인(PKCE) → Spotify에서 곡 재생 → RunWay 카드 재생/일시정지/이전·다음 | 카드 nowPlaying·playing 반영. Free면 Premium 안내 토스트. 활성 기기 없으면 “Spotify 앱에서 먼저…” |
| 2 | TC-S08-02 | 동일 기기 · **멜론 설치** · 이용권/로그인 · 알림 접근 허용 | 멜론 선택·연결 → 목록/현재곡 · 재생·일시정지·다음·이전 | `CONNECTED`에서만 제어. 이용권·로그인 오류 시 `LOGIN_REQUIRED` 구분 |
| 3 | TC-S08-03 (권한) | 멜론 설치 후 알림 접근 **거부** | 음원 시트에서 멜론 **허용** → 설정 이동 → 거부 유지 시 제어 불가 | 강제 재생 없음. 허용 후에만 연결·제어 |
| 4 | (선택) TC-S08-03 (미설치) | 멜론 삭제/미설치 기기 | **설치** → 스토어 상세 | 에뮬과 동일 안내 경로 |

---

## 요약

| ID | 결과 |
| --- | --- |
| TC-S08-01 | Blocked (배선·Client ID·로그인 CTA OK / Premium E2E 불가) |
| TC-S08-02 | Blocked (멜론 미설치) |
| TC-S08-03 | 통과 (미설치 안내·스토어 이동·강제 재생 없음) |
