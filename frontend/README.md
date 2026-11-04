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

2.7 음악 카드는 Spotify Web API로 지금 재생 중인 곡·앨범 표지를 읽고 이전·재생/일시정지·다음을 보냅니다
(S15P31E105-374). 로그인은 앱 안에서 Authorization Code + PKCE로 하므로 **Client Secret은 쓰지 않습니다.**

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)에서 앱을 만들고 Web API를 고릅니다.
2. Redirect URI에 `runway://spotify-callback`을 등록합니다.
3. 개발 모드에서는 대시보드 User Management에 등록한 계정만 로그인됩니다.
4. Client ID를 `src/config.ts`의 `spotifyClientId`에 넣습니다. 비어 있으면 Spotify도 목업 데이터로 동작합니다.

- 표지와 지금 곡은 무료 계정도 보이지만, 재생 조작은 Spotify Premium 계정만 됩니다(Web API 제한).
- 곡은 계정의 다른 기기(폰·PC의 Spotify 앱)에서 재생 중이어야 보입니다. 카드는 5초마다 다시 읽습니다.
- RunWay에서 로그아웃하면 Spotify 토큰도 지웁니다. iOS의 redirect 처리는 아직 넣지 않았습니다.

## 건강 데이터 PoC

Android 삼성 헬스 직접 조회·Health Connect 보완과 iOS HealthKit의 실제 기록을 확인하는 화면은
설정 > 개발용 > 건강 데이터 PoC에서 엽니다.

- [이번 작업의 검증 결과 및 남은 실기기 확인](verification/S15P31E105-60.md)

Android 설치용 디버그 빌드는 JS를 포함하며 Metro 연결 없이 실행하도록 구성했습니다. 개발 중 Metro를 사용하려면 `MainApplication.kt`의 `useDevSupport`와 `app/build.gradle`의 `debuggableVariants` 설정을 함께 조정하세요. 공개 배포용 서명은 포함하지 않습니다.

Windows에서 iOS 네이티브 빌드는 검증할 수 없습니다. macOS/Xcode에서 CocoaPods 설치, HealthKit entitlement와 서명을 확인해야 합니다.
