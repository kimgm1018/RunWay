# ADR-0020: Android Spotify 재생은 App Remote로 제어한다

| 항목 | 값 |
|---|---|
| 상태 | 제안 |
| 결정일 | - |
| 결정자 | - |
| 관련 | [S15P31E105-501](https://ssafy.atlassian.net/browse/S15P31E105-501), [음악 요구사항 MUS-001~006](../design/requirements.md#12-러닝-중-음악-재생-및-제어) |

## 맥락

Web API는 계정의 활성 기기를 제어하므로 Spotify 앱이 재생 기기로 활성화되지 않았거나 다른 폰이 활성 기기이면 현재 폰에서 바로 듣기 어렵다. 사용자는 501 범위를 확장하여 Spotify에서 미리 곡을 틀지 않고 RunWay에서 마지막 음악을 이어 듣는 Android 동작을 확정했다. 501의 기존 오류 수정은 유지하고, 502 업무와 493의 곡·목록 선택 화면은 변경하지 않는다.

## 결정

(가정) Android의 Spotify 재생·일시정지·이전·다음과 실제 곡 정보는 공식 App Remote 0.8.0으로 처리한다. 재생 요청 시 로컬 기기로 전환한 뒤 `resume()`하고, PlayerState 이벤트 및 실제 상태 조회로 결과를 확인한다. 재생 이력이 없으면 재개 성공으로 표시하지 않는다. 재생 이력이 없는 서비스에 임의의 기본 곡을 지정하지 않는다.

App Remote의 인증 주체는 **휴대폰 Spotify 앱의 로그인 계정**이다. SDK의 사용자 동의와 Web API PKCE 토큰은 별개이며, 브라우저 토큰으로 SDK의 계정을 변경했다고 표시하지 않는다. 명시적 연결 전에는 자동 동의 화면을 띄우지 않고, RunWay 로그아웃·세션 만료 시 로컬 연결 허용 표시와 SDK 연결을 정리한다. Web API 구현은 iOS의 기존 경로와 향후 목록 조회에 유지한다. Android SDK 실패 시 다른 기기로 재생 명령을 보낼 수 있는 Web API로 자동 우회하지 않는다.

## 고려한 대안

| 대안 | 장점 | 단점 |
|---|---|---|
| App Remote (선택 제안) | 현재 폰의 Spotify와 연결하고 로컬 기기 전환·마지막 음악 재개·상태 이벤트를 사용할 수 있다 | Spotify 앱 설치·로그인·최초 동의 및 Android 앱 등록이 필요하고 네이티브 SDK 의존성이 생긴다 |
| Web API 기기 조회·재생 전환 | 기존 PKCE와 HTTP 연동을 재사용한다 | Spotify 앱이 기기로 노출되지 않으면 활성화할 수 없고 계정 전체의 다른 기기를 제어할 위험이 있다. 명령·상태 반영에는 네트워크 조회가 필요하다 |

## 결과

- **얻는 것**: RunWay 재생 버튼에서 현재 폰의 마지막 음악을 재개하고, 곡·재생 상태를 이벤트로 갱신한다. 음악 카드와 러닝 중 플레이어에 같은 상태를 반영한다.
- **감수하는 것**: SDK는 Beta이며 최초 연결에는 인터넷과 Spotify 사용자 동의가 필요하다. 기능별 이용권 제한은 실제 SDK 오류·capabilities로 구분한다. SDK 연결·구독과 앨범 아트 캐시 수명주기를 관리한다.
- **후속 작업**: Android cold start·재개·거부·미설치·연결 복구·로그아웃을 검증한다. 두 폰 사이의 기기 이름 표시·전환 UI와 검증은 502에서 별도로 다룬다. 팀 합의가 확인될 때까지 제안 상태를 유지한다.

### 구현 참고 근거

2026-11-08 Context7에서 Spotify 공식 Android 연결·PlayerState 구독 문서를 조회했다. Context7 문서는 버전이 명시되지 않아 공식 0.8.0 AAR의 실제 API를 `javap`으로 추가 확인했다. React Native는 저장소의 0.85.3을 사용한다.

- [공식 0.8.0 릴리스](https://github.com/spotify/android-sdk/releases/tag/v0.8.0-appremote_v2.1.0-auth)
- [로컬 기기로 전환](https://spotify.github.io/android-sdk/app-remote-lib/docs/com/spotify/android/appremote/api/ConnectApi.html)
- [재개·제어·상태 구독](https://spotify.github.io/android-sdk/app-remote-lib/docs/com/spotify/android/appremote/api/PlayerApi.html)
- [SDK 인증 및 제약](https://github.com/spotify/android-sdk/blob/master/app-remote-lib/README.md)

공식 배포 AAR의 SHA-256은 `b5a6dd880eaf01f63a871cba9ef7af77c341f8a94ffc8fdf2e9021f9a9d4c198`이다. 문서 확인은 실기기 검증 완료를 뜻하지 않는다.

2026-11-08 S22(Android 16)에서 동의 화면이 열리지 않는 원인을 시스템의 background activity launch 차단 로그로 확인했다. SDK 0.8.0은 서비스 바인딩에 Android 14 이상에서 필요한 `BIND_ALLOW_ACTIVITY_STARTS`를 지정하지 않는다. 명시적인 연결 요청에서만, Spotify 패키지의 서비스 바인딩에 한정해 Context 어댑터로 이 옵션을 추가한다. 자동 재연결에는 추가하지 않으며 원본 AAR은 변경하지 않는다. Context7의 [Android 공식 Context 문서](https://developer.android.com/reference/android/content/Context#BIND_ALLOW_ACTIVITY_STARTS)에서 API 34 이상 동작을 조회하고, 고정된 AAR의 실제 바인딩 호출도 확인했다.
