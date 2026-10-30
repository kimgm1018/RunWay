# RunWay 워치 실험 앱

담당자: 강현 · Jira: S15P31E105-53

`wear/` Gradle 프로젝트의 `:demo` 모듈이다. 프로젝트 구성은 [워치 앱 안내](../README.md)를 따른다.

- [업로드 API와 JSON 필드 명세](../../docs/design/api/wear-upload-api.md): 백엔드·데이터 분석 공유 규격
- [S15P31E105-53 검증 보고서](verification/S15P31E105-53.md): 독립 리뷰 반영, 테스트·실기기 결과, 남은 검증. 보고서의 `:app` 명령은 모듈 이동 전 기준이며 지금은 `:demo`로 실행한다

신규 설치 기본값은 **120BPM**, 프리셋은 **120·140·160**, 증감은 **±1**이다. 업데이트 시 기존 저장 BPM을 유지한다. 측정값은 워치에 저장하고 종료 후 수동 전송한다.

## 빠른 빌드

SDK 경로를 `local.properties` 또는 `ANDROID_HOME`으로 설정하고 Android Studio의 JBR을 사용한다. 아래 명령은 `wear/`에서 실행한다.

```powershell
.\gradlew.bat :demo:testDebugUnitTest :demo:lintDebug :demo:assembleDebug
```

설치 APK: `demo/build/outputs/apk/debug/demo-debug.apk`

로컬 설정·서명 키·빌드 결과·실제 실험 JSON은 Git에 넣지 않는다.
