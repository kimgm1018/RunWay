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

App Remote 인증은 **휴대폰 Spotify 앱의 계정**을 사용한다. 브라우저의 Web API PKCE 계정과는 별개다.
계정 변경은 Spotify 앱에서 수행한다. RunWay 로그아웃·세션 만료 시 SDK 연결과 로컬 연결 동의 표시를 지우며,
다음 RunWay 로그인은 다시 명시적으로 연결해야 한다. `UserNotAuthorizedException`이 발생하면 Android 등록,
허용 사용자, 연결 동의를 확인한다. SDK 연결 실패를 Web API의 다른 활성 기기 제어로 자동 우회하지 않는다.

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
