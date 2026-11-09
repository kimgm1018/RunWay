# ADR-0021: Android Spotify 재생·목록 권한은 Spotify 앱 SSO(PKCE) 한 번으로 받는다

| 항목 | 값 |
|---|---|
| 상태 | 제안 |
| 결정일 | - |
| 결정자 | - |
| 관련 | [S15P31E105-573](https://ssafy.atlassian.net/browse/S15P31E105-573), [ADR-0020](0020-spotify-android-app-remote.md)(유지·보완), [음악 요구사항 MUS-002·005](../design/requirements.md#12-러닝-중-음악-재생-및-제어) |

## 맥락

ADR-0020으로 Android 재생은 App Remote가 휴대폰 Spotify 앱 계정으로 제어한다. 내 재생 목록·최근 들은 곡은 Web API 토큰이 필요한데, App Remote 내장 인증은 추가 scope와 토큰을 주지 않는다(공식 App Remote README). 그래서 목록은 별도 브라우저 PKCE 로그인(SCOPE_REQUIRED → 다시 로그인)을 거쳤다. 사용자는 동의를 두 번 했고, 브라우저 계정이 폰 Spotify 앱 계정과 달라도 알 수 없었다. App Remote에는 사용자 ID API가 없어 두 계정을 비교할 수도 없다.

## 결정

Android는 공식 Spotify Android Auth 라이브러리 **5.0.0**(`com.spotify.android:auth`, Maven Central)을 사용한다. 설치된 Spotify 앱 SSO로 `app-remote-control`과 Web API 목록 scope를 **한 번에** 요청한다. 응답 유형은 `CODE`이고 `PKCEInformation`에는 S256 challenge만 넣는다. 반환된 code는 JS가 verifier로 교환해 기존 Keychain 토큰 저장·자동 갱신을 재사용한다. 라이브러리의 TOKEN 변환은 사용하지 않는다. 이 변환은 code를 디버그 로그에 남기기 때문이다.

- 앱 SSO의 계정은 App Remote와 같은 폰 Spotify 앱 계정이다. 토큰에 `via: app`과 `/me` 계정 이름을 저장하고 2.8에 표시한다. 계정 전환은 Spotify 앱에서 한 뒤 2.8의 다시 연결로 한다(ADR-0020의 명시적 연결·계정 전환 원칙 유지).
- 기존 브라우저 토큰(`via` 없음)은 폰 계정으로 가정하지 않고 목록 재연결(ACCOUNT_CHECK)을 요구한다. App Remote 인증 상실(AUTH_REQUIRED·미등록)이면 계정이 바뀌었을 수 있으므로 목록 토큰도 지운다.
- Spotify 앱은 이미 동의한 계정에도 SSO 때마다 동의 화면을 띄운다(2026-11-09 Galaxy S22 확인). 그래서 앱 SSO는 최초 연결, 2.8의 명시적 연결·다시 연결(계정 확인), 목록 재연결에서만 실행한다. 연결만 끊긴 2.7b 다시 연결은 앱 SSO 토큰과 연결 동의가 남아 있으면 App Remote만 다시 연결한다.
- 라이브러리의 `getResponse()`는 OK가 아닌 결과를 모두 `EMPTY`로 바꾼다. 그래서 사용자가 닫은 경우(`RESULT_CANCELED`)는 결과 코드로 먼저 취소로 구분한다.
- 취소(CANCELED)·동의 거부(DENIED)·갱신 실패(LIBRARY_EXPIRED)·미동의(SCOPE_REQUIRED)·Spotify 앱 업데이트 필요(APP_UPDATE_REQUIRED)를 구분한다. PKCE를 지원하지 않는 Spotify 앱 버전은 라이브러리 기준값(`MIN_SPOTIFY_VERSION_FOR_TOKEN_CONVERSION`)으로 판별한다.
- 5.0.0은 `RedirectUriReceiverActivity` intent-filter를 앱이 선언해야 한다. 기존 `runway://spotify-callback`을 MainActivity에서 이 Activity로 옮겨 한 Activity만 받게 한다. Dashboard의 Redirect URI·패키지·SHA-1 등록은 그대로다. iOS의 브라우저 PKCE(`show_dialog=true`)는 변경하지 않는다.

## 고려한 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| Auth 5.0.0 SSO + PKCE, JS 교환 (선택) | 동의 1회, App Remote와 같은 계정, refresh token·기존 저장/갱신 재사용, verifier·code·토큰이 라이브러리 로그에 남지 않음 | 네이티브 의존성 추가(androidx.browser 1.5.0, kotlin-stdlib 1.9.22 전이), 공식 README에 5.x PKCE 사용 설명이 없어 AAR API로 확인, 실기기 검증 필요 |
| Auth 라이브러리 TOKEN 요청(라이브러리가 PKCE 교환) | 구현이 가장 짧다 | 라이브러리가 `Log.d`로 authorization code를 기록한다. 구버전 앱에서는 refresh token 없는 토큰이 될 수 있다 |
| 새 SDK 없이 두 인증 유지·연속 실행 | 의존성 변화 없음 | 동의 2회가 그대로이고, 브라우저 계정과 폰 계정 불일치를 감지할 수 없다 |
| App Remote 내장 인증만 사용 | 단순하다 | 추가 scope·토큰을 받을 수 없어 목록 기능을 제공할 수 없다 |

## 결과

- **얻는 것**: 최초 연결에서 재생·목록 권한을 Spotify 앱 동의 한 번으로 받는다. 목록 재진입·앱 재실행·만료 시 저장 토큰과 자동 갱신을 재사용한다. 연결 계정을 확인할 수 있다.
- **감수하는 것**: Spotify 앱에서 계정만 바꾸고 이미 그 계정이 RunWay를 허용했다면 App Remote가 조용히 새 계정으로 붙을 수 있다. App Remote에 계정 식별 API가 없기 때문이다. 이때 목록은 2.8의 다시 연결 전까지 이전 계정 토큰을 쓴다. 2.8 다시 연결은 Spotify 앱의 동의 화면을 매번 거친다. 라이브러리는 요청 URI(client_id·scope·state·code_challenge)를 디버그 로그에 남긴다. 이 값은 비밀이 아니다.
- **후속 작업**: 남은 실기기 확인은 동의 거부, 토큰 만료 후 자동 갱신(1시간 경과), 다른 Spotify 계정으로 전환, RunWay 로그아웃 후 재연결, 기존 558 다중 폰 재생 회귀다. 팀 합의가 확인될 때까지 제안 상태를 유지한다.

### 실기기 확인 (2026-11-09~10, Galaxy S22 SM-S901N, Android 16, Spotify 9.1.94, 573 worktree 디버그 APK·실제 배포 서버)

| 항목 | 결과 |
|---|---|
| 최초 연결 | 브라우저 없이 Spotify 앱 동의 화면 1회(계정 데이터·최근 재생·재생 목록·재생 제어 함께 표시). 동의 후 재생 카드·내 재생 목록·최근 들은 곡이 다른 로그인 없이 표시됨 |
| 재생 | 재생 버튼으로 현재 폰에서 재생, 일시정지 표시 확인 |
| 취소 | 동의 화면에서 뒤로 가기 → 안내 없이 원래 화면. 최초 빌드는 `EMPTY`를 실패로 처리해 수정 후 재확인 |
| 앱 재설치·재실행 | 로그인·동의 화면 없이 재생 연결과 목록 표시(`LoginActivity` 0회) |
| 2.8 계정 확인 | `Spotify 계정 <이름>로 연결돼 있어요`와 다시 연결 표시. 다시 연결 → 동의 화면 → 동의 시 유지. 취소해도 계정 표시 유지 |
| 연결 끊김 | Spotify 앱 강제 종료 후 재생 → 동의 화면 없이 App Remote 자동 재연결 |
| 로그 | RunWay 프로세스 로그에 access/refresh token·code·verifier·인증 요청 URI 없음 |

### 구현 참고 근거

2026-11-09 조회. Context7 `/spotify/android-sdk`: App Remote 인증 두 방식, 내장 인증은 추가 scope·토큰 불가, Auth 라이브러리로 `app-remote-control`을 요청하는 방식. Context7 문서와 공식 README에는 5.x PKCE 사용법이 없다. 그래서 다음으로 보완했다.

- Maven Central `com.spotify.android:auth:5.0.0` AAR(sha1 `d2f94daa15f8b1aeed22f69d2e65ff3338721872`, SHA-256 `806600c800ee148671ef674377912b3d757c4f5926ab43da84abcca7738ae4e7`)을 `javap`로 확인했다. `AuthorizationRequest.Builder.setPkceInformation`, `PKCEInformation`, Spotify 앱 인텐트에 `CODE_CHALLENGE` 전달, CODE 응답은 교환 없이 반환, `checkRedirectUriConfiguration`이 `authorize()`에서 항상 호출됨을 확인했다.
- [android-auth CHANGELOG](https://github.com/spotify/android-auth/blob/master/CHANGELOG.md): 2.2.0 PKCE·refresh token, 4.0.0 `CANCELLED` 구분, 5.0.0 `RedirectUriReceiverActivity` intent-filter 앱 선언 필수.
- [App Remote 인증 설명](https://github.com/spotify/android-sdk/blob/master/app-remote-lib/README.md). React Native는 저장소의 0.85.3, App Remote는 ADR-0020의 0.8.0 AAR을 유지한다.

문서·바이트코드 확인은 실기기 검증 완료를 뜻하지 않는다.
