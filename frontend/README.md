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

## 건강 데이터 PoC

Android 삼성 헬스 직접 조회·Health Connect 보완과 iOS HealthKit의 실제 기록을 확인하는 화면은
설정 > 개발용 > 건강 데이터 PoC에서 엽니다.

- [이번 작업의 검증 결과 및 남은 실기기 확인](verification/S15P31E105-60.md)

Android 설치용 디버그 빌드는 JS를 포함하며 Metro 연결 없이 실행하도록 구성했습니다. 개발 중 Metro를 사용하려면 `MainApplication.kt`의 `useDevSupport`와 `app/build.gradle`의 `debuggableVariants` 설정을 함께 조정하세요. 공개 배포용 서명은 포함하지 않습니다.

Windows에서 iOS 네이티브 빌드는 검증할 수 없습니다. macOS/Xcode에서 CocoaPods 설치, HealthKit entitlement와 서명을 확인해야 합니다.
