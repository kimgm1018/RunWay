# ADR-0018: 앱 지도는 네이버 지도 SDK로 그린다

| 항목 | 값 |
|---|---|
| 상태 | 채택 |
| 결정일 | 2026-11-02 |
| 결정자 | 팀 합의 (작업 요청자 확인) — [S15P31E105-180](https://ssafy.atlassian.net/browse/S15P31E105-180) |
| 관련 | [S15P31E105-180](https://ssafy.atlassian.net/browse/S15P31E105-180), [ADR-0001](0001-react-native-mobile-app.md), [CRS-001·STA-001·GRP-008](../design/requirements.md), [코스 API](../design/api/courses.md), [그룹런 API](../design/api/group-runs.md), [Secret 규칙](../development/secret-environment-variables.md) |

## 맥락

러닝 현재 위치(2.0·2.0F·2.0N), 코스(3.x), 러닝 진행(4.2), 기록 상세(5.2), 그룹런 진행(6.6), 만남 장소 선택(6.9)이 모두 지도 위에 그려진다. 지금은 S15P31E105-146 등에서 SVG 목 지도로 화면을 먼저 완성했고, 이 결정으로 고른 SDK로 교체한다.

결정을 강제하는 조건은 다음과 같다.

- **국내 길 상세도**: 러닝 코스는 해변길·하천길·공원 산책로를 지난다. 차도만 자세한 지도로는 코스 선이 지도와 맞지 않는다.
- **React Native 0.85 New Architecture**: 앱은 RN 0.85.3, `newArchEnabled=true`이다(ADR-0001). Fabric을 지원하지 않거나 관리가 멈춘 래퍼는 쓸 수 없다.
- **지도 색 지정**: [DESIGN.md](../../frontend/DESIGN.md)는 낮 지도를 K1 색(땅 `#D5DEE7`, 물 `#B9C8D6`, 길 흰색)으로, 4.2·5.2·6.x는 어두운 지도(`#0A111D`, 물 `#02050E`)로 그린다. 기본 지도 색만 쓰는 SDK는 디자인과 맞지 않는다.
- **경로와 위치**: 코스·기록은 GeoJSON `[lon, lat]` LineString이다(코스 API). 경로 선, 진행한 구간, 현재 위치 점, 그룹런 멤버 표식을 지도 위에 올려야 한다.
- **비용과 키**: 팀 프로젝트라 무료 범위나 아주 낮은 단가 안에서 써야 하고, 키는 Secret 규칙에 맞게 Git 밖에서 넣어야 한다.

## 결정

앱 지도는 **네이버 지도 Android·iOS SDK**를 **`@mj-studio/react-native-naver-map`** 래퍼로 쓴다.

- 낮 지도와 어두운 지도는 네이버 지도 **스타일 에디터**로 K1 색 스타일 두 개를 만들고 `customStyleId`로 고른다. 2.0N(일몰 후)과 4.2·5.2·6.x는 어두운 스타일을 쓴다.
- 코스·기록 경로는 GeoJSON 좌표를 `{latitude, longitude}`로 바꿔 경로 오버레이로 그린다. 현재 위치는 SDK의 위치 오버레이를 쓰고 점 모양은 디자인에 맞춘다.
- 키 관리
  - 앱에는 네이버 클라우드 Maps Application의 **Client ID만** 넣는다. Android는 `AndroidManifest.xml`의 `com.naver.maps.map.NCP_KEY_ID` meta-data로 넣는다. 값은 Git 제외 파일(`android/local.properties`) 또는 빌드 환경변수에서 Gradle `manifestPlaceholders`로 주입하고 저장소에는 값 없는 예시만 둔다.
  - Client ID는 APK에 포함되므로 Secret 보관 수단이 아니다. 대신 Application에 Android 패키지명 `com.runway.health`(iOS는 Bundle ID)를 등록해 다른 앱에서 쓰지 못하게 제한한다. 네이버 Maps 제한은 패키지명 기준이며 SHA-1 등록 항목은 공식 가이드에서 확인되지 않았다.
  - **Client Secret은 앱에 넣지 않는다.** 6.9 장소 검색·주소 변환(Geocoding·Reverse Geocoding)처럼 Secret이 필요한 REST 호출은 백엔드가 대신 호출한다.

## 고려한 대안

2026-11-02에 npm 최신 버전과 각 공식 문서로 확인한 내용이다. 단가·한도는 정책이 자주 바뀌므로 채택 전에 콘솔에서 다시 확인한다.

| 기준 | 네이버 지도 (선택) | react-native-maps (Google) | 카카오 지도 | MapLibre |
|---|---|---|---|---|
| 국내 길 상세도 | 국내 지도라 산책로·하천길·자전거길이 자세하다 | 국내 정밀 지도(1:5000) 반출이 2025-11 보류됐다. 국내 도보길·길 이름이 부족하다 | 국내 지도라 상세하다 | 타일 데이터(OSM 등)에 따라 다르다. 국내 OSM은 지역별 편차가 크다 |
| RN 연동 | `@mj-studio/react-native-naver-map` 2.9.1 (2026-10 갱신), codegen으로 Fabric 지원, 네이티브 SDK 3.23.2 | `react-native-maps` 1.29.11 (2026-09 갱신), RN ≥ 0.76, 가장 널리 쓰인다 | `@react-native-kakao/map` 2.2.7은 2025-03 이후 갱신이 없어 RN 0.85 호환이 불확실하다. 아니면 WebView로 JS SDK를 띄워야 한다 | `@maplibre/maplibre-react-native` 11.5.1 (2026-10 갱신), RN ≥ 0.80 |
| 지도 색 지정 | 스타일 에디터 + `customStyleId` (SDK 3.21.0 이상) | JSON 지도 스타일 | 네이티브 SDK에서 색 지정이 제한적이다 | 스타일 JSON으로 완전히 지정한다 |
| 경로·현재 위치 | 경로·폴리라인 오버레이, 위치 추적 모드 | 폴리라인, 내 위치 표시 | 지원하나 래퍼 범위가 불확실하다 | GeoJSON 소스를 그대로 쓴다, 위치 표시 지원 |
| 키 발급·제한 | NCP Maps Application, Client ID + 패키지명·Bundle ID 제한 | Google Cloud API 키 + 패키지명·SHA-1 제한, 결제 계정 등록 필수 | 네이티브 앱 키 + 키 해시·패키지명 | 타일 제공처(MapTiler 등) 키 별도 |
| 비용·한도 | 지도 뷰 생성 1회당 1건. 2025-07부터 기존 AI NAVER API 상품은 0.1원/건, 무료 이용량 없음. 신규 Maps 상품의 무료 이용량 목록에 Mobile Dynamic Map은 없다. 장소·주소 변환은 대표 계정 무료 이용량이 있다 | 모바일 SDK 지도 사용량은 무제한, 결제 계정 필요 | 지도 SDK 일 30만 건, 전체 월 300만 건 무료(첫 앱만), 초과 시 429 또는 유료 | 제공처 무료 등급 한도 안에서만 무료 |
| 판단 | 국내 상세도·Fabric 지원·색 지정을 모두 만족한다. 비용은 뷰당 0.1원 수준 | 비용은 가장 낫지만 국내 길 상세도가 러닝 코스에 부족하다 | 상세도는 좋지만 RN 0.85 래퍼가 불확실하다 | 색 지정은 가장 자유롭지만 국내 데이터와 타일 제공처를 따로 해결해야 한다 |

## 결과

- **얻는 것**: 러닝 코스가 지나는 국내 길이 지도에 그대로 보인다. 디자인의 K1 낮·밤 지도를 SDK 스타일로 맞출 수 있다. 코스·기록·그룹런 화면이 같은 지도 컴포넌트를 쓴다. 장소 검색·주소 변환도 같은 네이버 클라우드 계정에서 해결한다.
- **감수하는 것**: 지도 뷰를 만들 때마다 과금될 수 있어 화면 이동마다 지도를 새로 만들지 않도록 주의한다. 커스텀 스타일을 쓰면 기본 지도 유형·레이어 기능을 함께 쓸 수 없다. 래퍼는 개인 관리 오픈소스라 RN 업그레이드 때 호환을 먼저 확인해야 한다. 앱의 GeoJSON `[lon, lat]`와 SDK의 `{latitude, longitude}` 사이 변환을 한 곳에 둔다.
- **후속 작업**:
  - 콘솔에서 Mobile Dynamic Map 현재 단가·무료 이용량을 재확인한다. Maps Application `runway-mobile`은 2026-11-02 Android 패키지명·iOS Bundle ID `com.runway.health`로 등록했다.
  - `frontend/README.md`에 키 주입 절차와 변수 이름, 예시 파일을 추가한다(Secret 규칙 4·5절).
  - 스타일 에디터로 K1 낮·밤 스타일을 만들고 Style ID를 공유한다.
  - 선택한 SDK로 Android 실기기에서 지도·현재 위치·코스 경로 선 표시를 확인한다.
  - 6.9 장소 검색·주소 변환의 백엔드 대리 호출 API를 그룹런 API 명세에 추가할지 백엔드 담당과 정한다.

참고: [네이버 지도 Android SDK 커스텀 스타일](https://navermaps.github.io/android-map-sdk/guide-ko/2-4.html), [네이버 클라우드 Maps 개요](https://guide.ncloud-docs.com/docs/maps-overview), [Maps Application](https://guide.ncloud-docs.com/docs/maps-app), [AI NAVER API 지도 무료 이용량 종료 공지](https://www.gov-ncloud.com/support/notice/all/528), [react-native-naver-map](https://github.com/mym0404/react-native-naver-map), [Maps SDK for Android 사용량·결제](https://developers.google.com/maps/documentation/android-sdk/usage-and-billing), [카카오 쿼터](https://developers.kakao.com/docs/latest/ko/getting-started/quota), [구글 지도 반출 보류 보도(YTN)](https://www.ytn.co.kr/_ln/0102_202511112216040006).
