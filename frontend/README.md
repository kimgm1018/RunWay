# RunWay 모바일 앱

React Native로 만드는 RunWay 앱입니다. 화면 이동·디자인 토큰·공통 컴포넌트·목 데이터 구조는
[모바일 앱 공통 구조](CONVENTION.md)를 따릅니다.
아직 구현하지 않은 화면은 프로토타입 v15 화면 번호와 담당 업무를 보여 주는 자리 화면으로 이어져 있습니다.

Node22.11 이상 / pnpm11 / Android JDK17을 사용합니다.

```sh
pnpm install --frozen-lockfile
pnpm test --runInBand
pnpm typecheck
pnpm lint
```

### 화면 잠금 중 러닝 기록 검증 (S15P31E105-753)

`RunTimersKeeper`의 headless 작업은 RN 타이머가 백그라운드에서도 실행될 수 있게 한다.
하지만 작업 등록과 foreground 알림만으로 CPU 절전을 막지는 않는다. 러닝 서비스가 foreground로
시작된 뒤 `PARTIAL_WAKE_LOCK` 하나를 유지하고 서비스 종료 시 해제한다. 화면은 계속 꺼질 수 있다.
폰 단독·WATCH·PHONE_FALLBACK은 기존 서비스와 수집·업로드 경로를 그대로 사용한다.
또한 폰 GPS 재시도 대기 중 취소된 운동은 대기 종료 후 새 업로드를 시작하지 않는다.

진행 중 러닝에서 Activity가 중지됐다가 창 포커스를 되찾으면 다음 프레임에 기존 뷰의 재레이아웃·재그리기를 요청한다.
React 화면·러닝 세션·수집 구독을 재시작하지 않는다. 개인 러닝 시작 확정·종료·세션 복원에 따른 화면 전환은
앱이 foreground로 돌아올 때까지 보류하고, 대기 중 일시정지·종료된 경우 최신 상태에 맞춰 이동한다.
Android 포커스 이벤트를 관찰하며, foreground 상태에서 이미 마운트된 창의 초기 포커스는 가정한다.
그룹 진행 화면의 자동 종료 전환은 이 변경의 대상이 아니다.

네이티브 회귀 테스트는 `frontend/android`에서 실행한다. 기존 지도 Client ID와 삼성 SDK 설정이 필요하다.

```powershell
.\gradlew.bat :app:testDebugUnitTest --console=plain
```

2026-11-12 확인: React Native **0.85.3** 설치 소스의 `JavaTimerManager`, `HeadlessJsTaskContext`,
`HeadlessJsTaskService`를 대조했다. Context7 조회는 성공했으나 해당 버전 문서를 제공하지 않아
설치 소스로 버전을 맞췄다. wake lock 사용법은 [Android 공식 문서](https://developer.android.com/develop/background-work/background-tasks/awake/wakelock)를 확인했다.
Robolectric **4.16.1**의 Context7 상세 API 조회는 결과가 없어 [공식 4.16 API 문서](https://robolectric.org/javadoc/4.16/org/robolectric/shadows/ShadowService.html)로 보완했다.
네이티브 테스트는 Android API 29·34 시뮬레이션에서 반복 시작·위치 서비스 유형 전환·종료 해제를 검증한다.
compile/target SDK는 기존 **36**이며, JDK 17 자동 테스트 런타임은 API 29·34를 사용했다.
2026-11-13 최종 검증: `:app:testDebugUnitTest` 9개 suite/78개 테스트와 전체 Jest 158개 suite/1,700개 테스트가
종료 코드 0으로 통과했다. TypeScript 검사와 lint도 오류 없이 통과했다(기존 shareWebRoute 테스트 경고 4개).
수정 전 wake lock 누락·취소 후 재시도·잠금 중 화면 전환·복귀 대기 중 일시정지·초기 포커스 경계의 실패를 확인했다.
native 복귀 테스트는 재그리기 요청과 기존 뷰 보존을 검증하며, 실제 GPU의 버퍼 복구를 직접 검증하는 테스트는 아니다.

최종 통합 기준은 dev `e438988f`다. ARM64 디버그 APK를 빌드했다.
Galaxy S22(SM-S901N), Android 16/API 36에 `adb install -r`로 업데이트 설치하고 MainActivity 실행을 확인했다
(versionName 1.0/versionCode 1). 위치·알림·wake lock 권한과 위치 서비스·Bluetooth가 켜져 있다.
절전 모드는 켜져 있고 자동 화면 꺼짐은 10분이다. 반영한 dev와 753 수정에는 워치 코드 변경이 없어 워치 재설치는 필요하지 않다.
수정 후 시작 직후 화면 잠금→복귀와 절전 ON·정지 상태에서 10분 이상 잠금→복귀를 확인했다.
최근 앱을 열지 않고 정상 표시됐고 같은 앱 프로세스가 유지됐다. 일시정지·재개·종료 후 결과 화면까지 확인했다.
사용자는 절전 모드의 실제 이동 후 기록이 이어졌다고 보고했지만, 최소 이동 시간·경계별 건수·서버 COMMITTED 연속성은
독립 검증하지 않았다. 원래의 지속적인 전체 검정 화면은 완전히 재현하거나 원인을 확정하지 못했다.
기존 러닝 시간대의 Surface `queueBuffer -19` 로그와 장시간 잠금 직후의 검정 프레임을 관찰했으나,
관찰 시에는 최근 앱을 열지 않아도 화면이 돌아왔다. 모든 기기에서 지속 검정 화면이 해결됐다고 단정하지 않는다.
워치 앱의 실제 연결·심박 수집 상태와 폰 단독·WATCH·PHONE_FALLBACK 각 모드의 10분 이동·서버 저장 연속성은 미검증이다.
자동 테스트의 서비스 리소스 검증을 실제 GPS 생산·심박 수신·서버 저장 연속성 검증으로 해석하지 않는다.
기기가 연결되면 다음 순서로 확인한다.

1. APK 버전·기종·OS·위치/알림/워치 센서 권한·배터리 절전 상태·연결된 심박 수집원·러닝 모드를 기록한다.
2. 폰 단독·WATCH·기존 PHONE_FALLBACK 각각에서 화면 켜짐을 기준으로 자동 꺼짐·전원 버튼 잠금·홈/다른 앱 전환을 비교한다.
   각 화면 꺼짐 시나리오에서 최소 10분 실제 이동하고, 잠금 직전·잠금 중·복귀 후의 측정 시각·수신 건수·COMMITTED 건수를 확인한다.
3. 센서/GPS 생산 → 폰 네이티브 수신 → JS 수신/타이머 → batch 업로드 → 서버 저장 → 화면 표시를 구분한다.
   첫 중단 경계를 확인하며, 화면에서 경로가 보이는 것만으로 저장 성공으로 판단하지 않는다.
4. 복귀 → 일시정지 → 재개 → 종료 → 기록 상세를 확인한다. 원래 측정 시각·생산 기기·중복 제거를 유지하고,
   일시정지/결측 구간에 가짜 점·심박·연결 선이 없어야 한다. 폰 단독의 심박 미측정은 정상 제한이다.
5. 반복 화면 전환·종료·취소 후 GPS 구독과 업로드가 정리되고 서비스 wake lock이 남지 않는지 확인한다.
   `adb logcat -s RunWayWatch`의 `run CPU kept on/off`와 `timers kept on/off`는 실행 자원 상태만 의미한다.
   절전·권한 거부·심박 수집원 중단은 별도로 비교하며, 원본 좌표·심박 수치·인증정보는 로그나 Jira에 남기지 않는다.

### Windows에서 Android APK 빌드

해당 Jira worktree의 `frontend/android`에서 실행한다. 네이버 지도 Client ID와 삼성 헬스 SDK는 아래 설정을 먼저 준비한다.

```powershell
.\gradlew.bat :app:assembleDebug -PreactNativeArchitectures=arm64-v8a --max-workers=4 --console=plain
```

`arm64-v8a`는 ARM64 휴대폰용이다. x86_64 에뮬레이터는 `-PreactNativeArchitectures=x86_64`로 바꾼다.
APK는 `app/build/outputs/apk/debug/app-debug.apk`에 생성된다. 삼성 SDK가 기본 경로에 없으면
`-PsamsungHealthSdk=<AAR의 절대 경로>`를 함께 지정한다.

긴 Windows worktree 경로에서는 CMake/Ninja가 `build.ninja still dirty after 100 tries` 또는
`Filename longer than 260 characters`로 실패할 수 있다. Android 루트 Gradle 설정은 Windows에서
CMake 중간 산출물을 Java 임시 디렉터리의 `runway-cxx/<모듈 경로 해시>`에 저장한다.
해시는 worktree와 모듈을 구분한다. 더 짧은 경로가 필요하면 `-PrunwayNativeBuildRoot=C:/rw-cxx`로 지정한다.
이 디렉터리는 CMake 재사용을 위해 `clean` 이후에도 유지되며, 소스와 APK 출력 위치는 그대로다.

`Could not read workspace metadata .../transforms/<해시>/metadata.bin`은 별도 Gradle 캐시 오류다.
실패한 빌드가 종료된 뒤 오류에 명시된 캐시 항목만 격리하고 다시 빌드해 재생성한다.
다른 빌드가 사용 중인 캐시나 사용자 전체 `.gradle` 디렉터리를 일괄 삭제하지 않는다.

설정 참고: [AGP 8.12 Cmake.buildStagingDirectory](https://developer.android.com/reference/tools/gradle-api/8.12/com/android/build/api/dsl/Cmake).
2026-11-09에 사용 중인 AGP 8.12.0 기준으로 공식 API 문서를 확인했다. Context7은 미연결 상태여서 공식 문서를 직접 조회했다.

글꼴은 `assets/fonts/`에 있고 `npx react-native-asset`으로 Android·iOS 프로젝트에 연결했습니다.
글꼴을 더하거나 빼면 같은 명령을 다시 실행합니다.

## 네이버 지도 키

지도는 네이버 지도 SDK를 사용합니다([ADR-0018](../docs/adr/0018-naver-map-sdk.md)). Android 빌드에는 네이버 클라우드
Maps Application `runway-mobile`의 **Client ID**가 필요하며, 없으면 Gradle이 변수 이름을 안내하고 빌드를 멈춥니다.

| 변수 | 필수 | 용도 |
| --- | --- | --- |
| `MOBILE_NAVER_MAP_CLIENT_ID` | O | Android 매니페스트 `com.naver.maps.map.NCP_KEY_ID`에 들어가는 Client ID |

- Gradle은 `android/local.properties`(Git 제외)의 값을 먼저 읽고, 없으면 같은 이름의 환경변수를 읽습니다.
  `.env`는 읽지 않습니다.
- Client ID는 콘솔 Maps > Application > `runway-mobile` > 인증 정보에서 확인해 아래 한 줄로 넣습니다.

  ```properties
  MOBILE_NAVER_MAP_CLIENT_ID=
  ```

- Client ID는 APK에 포함되므로 비밀값이 아닙니다. 콘솔에서 Android 패키지명·iOS Bundle ID `com.runway.health`로
  사용을 제한합니다. **Client Secret은 앱에 넣지 않습니다.**
- 지도·현재 위치·코스 선은 설정 > 개발용 > 지도 확인에서 확인합니다.
- iOS 키 설정(`Info.plist`의 `NMFNcpKeyId`)은 macOS/Xcode 환경에서 후속으로 추가합니다.

## 앱 밖 푸시 알림 (FCM, S15P31E105-815)

알림함에 쌓이는 알림을 Android 기기 푸시로도 받습니다([ADR-0025](../docs/adr/0025-fcm-device-push.md),
[notifications.md](../docs/design/api/notifications.md)). `@react-native-firebase/messaging`을 쓰며 iOS는 범위 밖이라
iOS 자동 연결에서 제외했습니다(`react-native.config.js`).

- Firebase 콘솔에서 Android 앱(패키지명 `com.runway.health`)을 등록하고 받은 `google-services.json`을
  `android/app/google-services.json`에 둡니다. 이 파일은 Git에서 제외되며 개발자가 각자 로컬에 둡니다.
- 파일이 없으면 Google Services 플러그인을 적용하지 않아 기존처럼 빌드되고, 푸시만 꺼집니다(토큰 등록·수신 없음).
- 로그인하면 Android 13 이상에서 알림 권한을 묻고, 허용하면 FCM 토큰을 N03으로 등록합니다. 거절하면 등록하지 않고
  이전에 등록한 토큰을 N04로 지웁니다. 로그아웃 직전에 N04로 토큰을 지우고 기기 토큰도 삭제합니다(최대 3초).
  로그인 만료·러닝 전 다시 로그인처럼 로그아웃 없이 세션이 끝나면 기기 토큰만 삭제합니다. 다음 로그인은 이전 삭제가
  끝날 때까지(최대 15초) 기다렸다가 새 토큰을 등록합니다.
- 푸시를 누르면 알림함에서 누를 때와 같은 화면이 열립니다. 팔로우 요청·알 수 없는 종류는 알림 화면을 엽니다.
  앱이 켜져 있을 때 온 푸시는 시스템 알림을 띄우지 않고 홈의 알림 표시만 바로 갱신합니다.
- 알림 채널은 `runway_default`(이름 "알림")이며 앱 시작 시 만듭니다(`firebase.json`, `MainApplication.kt`).
- 서버 쪽 키(`BACKEND_FCM_SERVICE_ACCOUNT_BASE64`)·켜기 설정은 [백엔드 README](../backend/README.md)를 따릅니다.
- 실제 수신은 서버 푸시를 켠 환경과 실기기에서 확인합니다. 자동 테스트는 가짜 기기·서버로 검증합니다.

## Spotify 연동

Android의 음악 카드와 러닝 중 플레이어는 공식 **App Remote 0.8.0**으로 휴대폰 Spotify 앱에 연결한다
(S15P31E105-501, [ADR-0020 제안](../docs/adr/0020-spotify-android-app-remote.md)). 재생 버튼은 현재 폰으로
기기를 전환한 뒤 마지막 음악을 재개한다. 재생·일시정지·이전·다음과 곡·앨범 아트·상태 이벤트를 SDK로 처리한다.
Spotify 앱에서 미리 재생 버튼을 누르는 과정을 요구하지 않으며, 이력이 없으면 임의의 곡을 틀지 않고 안내한다.
곡·플레이리스트 선택 화면은 S15P31E105-493의 별도 범위다.

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)의 RunWay 앱에서 사용하는 API에 **Android**를 추가한다.
2. Redirect URI `runway://spotify-callback`을 등록한다. Client ID는 공개 식별자이므로 `src/config.ts`의 `spotifyClientId`에 설정한다. Client Secret은 앱에 넣지 않는다.
3. Android 패키지 `com.runway.health`와 **실제 APK 서명 인증서의 SHA-1**을 등록한다. 현재 저장소의 디버그 키는
   `5E:8F:16:06:2E:A3:CD:2C:4A:0D:54:78:76:BA:A6:F3:8C:AB:F6:25`이다. 배포 키를 바꾸면 그 서명도 별도로 등록한다.
4. 개발 모드에서는 휴대폰 Spotify 앱에 로그인한 계정을 허용 사용자로 등록한다. Spotify 앱 설치·로그인과 최초 연결 동의가 필요하다.
5. 2.8에서 Spotify의 로그인 버튼 또는 2.7의 다시 연결을 누른다. 연결 읽기만으로 인증 화면을 자동 실행하지 않는다.

Android 인증은 **휴대폰 Spotify 앱의 계정** 하나로 한다(S15P31E105-573, [ADR-0021 제안](../docs/adr/0021-spotify-android-app-sign-in.md)).
최초 연결은 Spotify Auth 5.0.0의 앱 SSO(PKCE)로 재생(`app-remote-control`)과 목록 scope를 한 번에 동의받는다.
받은 code는 JS가 교환해 Keychain에 저장하고, 목록 재진입·앱 재실행·만료 시 자동 갱신을 재사용한다. 2.8에 연결된
계정 이름이 보이며, 계정은 Spotify 앱에서 바꾼 뒤 2.8의 다시 연결로 반영한다. Spotify 앱은 이미 동의한 계정에도 SSO마다
동의 화면을 띄우므로, 연결만 끊긴 2.7b 다시 연결은 저장된 앱 로그인이 있으면 App Remote만 다시 연결한다. 573 이전 브라우저 로그인 토큰은 폰 계정으로
가정하지 않고 목록 재연결을 요구한다. Spotify 앱이 PKCE를 지원하지 않는 버전이면 업데이트를 안내한다.
리다이렉트 `runway://spotify-callback`은 Auth 라이브러리의 `RedirectUriReceiverActivity`가 받는다(5.0.0 필수 선언).
RunWay 로그아웃·세션 만료 시 SDK 연결·로컬 연결 동의 표시·목록 토큰을 지우며, 다음 RunWay 로그인은 다시 명시적으로
연결해야 한다. `UserNotAuthorizedException`이 발생하면 Android 등록, 허용 사용자, 연결 동의를 확인하며 이때 목록 토큰도
지운다. SDK 연결 실패를 Web API의 다른 활성 기기 제어로 자동 우회하지 않는다.

Android 14 이상에서는 SDK 서비스 연결용 Context가 명시적 연결에 한해 Spotify 동의 화면 실행을 허용한다.
SDK 원본 AAR은 수정하지 않는다. 최초 동의를 읽고 응답할 시간은 최대 2분, 자동 재연결 제한은 20초다.

SDK의 `canPlayOnDemand`와 실제 오류로 이용권 제한을 확인한다. 특정 곡 URI 지정 재생에는 Premium이 필요하다.
연결 명령 전송만으로 재생 성공을 표시하지 않고 실제 PlayerState를 확인한다. 재생 상태·앨범 아트는 로그에 기록하지 않는다.

SDK AAR은 공식 GitHub 0.8.0 배포본을 `android/app/libs/`에 고정했다. 다운로드 출처와 SHA-256은 ADR-0020에 있다.
iOS의 기존 Spotify Web API 구현과 PKCE `show_dialog=true`, 403 오류 분류는 유지한다. Client ID가 비어 있거나
네이티브 모듈이 없는 환경에서는 기존 경로를 쓴다. iOS의 실제 callback 연결은 아직 별도 검증이 필요하다.

## 건강 데이터 PoC

Android 삼성 헬스 직접 조회·Health Connect 보완과 iOS HealthKit의 실제 기록을 확인하는 화면은
설정 > 개발용 > 건강 데이터 PoC에서 엽니다.

- [이번 작업의 검증 결과 및 남은 실기기 확인](verification/S15P31E105-60.md)

Android 설치용 디버그 빌드는 JS를 포함하며 Metro 연결 없이 실행하도록 구성했습니다. 개발 중 Metro를 사용하려면 `MainApplication.kt`의 `useDevSupport`와 `app/build.gradle`의 `debuggableVariants` 설정을 함께 조정하세요. 공개 배포용 서명은 포함하지 않습니다.

Windows에서 iOS 네이티브 빌드는 검증할 수 없습니다. macOS/Xcode에서 CocoaPods 설치, HealthKit entitlement와 서명을 확인해야 합니다.
