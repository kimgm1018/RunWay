# ADR-0019: 경사 계산은 백엔드에서 하고, 코스 생성은 AI 최적화를 먼저 시도한다

| 항목 | 값 |
|---|---|
| 상태 | 채택 |
| 결정일 | 2026-11-03 |
| 결정자 | 코스 도메인 담당(BE-C)·Route 담당(AI) 합의 (작업 요청자 확인) — [S15P31E105-368](https://ssafy.atlassian.net/browse/S15P31E105-368) |
| 관련 | [S15P31E105-368](https://ssafy.atlassian.net/browse/S15P31E105-368), Epic [S15P31E105-318](https://ssafy.atlassian.net/browse/S15P31E105-318), [S15P31E105-319](https://ssafy.atlassian.net/browse/S15P31E105-319)·[369](https://ssafy.atlassian.net/browse/S15P31E105-369)·[370](https://ssafy.atlassian.net/browse/S15P31E105-370)·[371](https://ssafy.atlassian.net/browse/S15P31E105-371), 범위 조정 [S15P31E105-320](https://ssafy.atlassian.net/browse/S15P31E105-320), [코스 API](../design/api/courses.md), [ADR-0003](0003-java-spring-backend.md), [ADR-0004](0004-python-fastapi-ai-service.md), [ADR-0011](0011-local-postgresql-postgis.md), [ADR-0016](0016-image-volume-storage.md) |

## 맥락

코스 생성과 경사 계산이 지금은 AI 쪽 Python 코드에 있다.

- **Route V1** (`ai/workspace/seongyun/route`, 약 7,500줄): 부산 OSM extract로 달릴 수 있는 길(RUNNABLE) 그래프를 만들고, LOOP·왕복·편도 후보를 생성해 규칙 기반 점수와 Usability Gate로 TOP3를 고른다. networkx·osmnx·osmium·shapely·pyproj·rasterio 등을 쓴다. 워크스페이스 데모 서버(FastAPI)만 있고 배포 구성은 없다.
- **경사 계산** (`ai/service/app/course_grade.py`): 고도를 20m 재표본 → 중앙값 5칸 → 평균 3칸으로 다듬고 100m 경사(`PlanGradeSegment`)를 만든다. 고도는 Route가 Copernicus GLO-30 DEM에서 읽는다.

결정을 강제하는 조건은 다음과 같다.

- **코스 저장 주체는 백엔드다.** 생성 코스는 `courses`에 저장되고 경사는 `courses.elevation_profile`에 100m 목록으로 저장된다. 저장 형식과 검증은 백엔드가 확정했다([S15P31E105-319](https://ssafy.atlassian.net/browse/S15P31E105-319), [코스 API](../design/api/courses.md#elevationprofile-100m-경사-구조)). 경사는 null을 허용하지 않으므로 고도 미확인 구간 보간도 저장 전에 끝나야 한다.
- **AI 개인 페이스 계획은 경사 목록이 입력이다.** AI가 경사를 직접 만들지 않아도 저장된 경사만 받으면 된다([S15P31E105-371](https://ssafy.atlassian.net/browse/S15P31E105-371)).
- **Route는 지금 그대로 배포하기 어렵다.** 기술 가이드 기준으로 프로세스당 메모리 약 2.2–2.7GB, 요청을 lock으로 직렬 처리하며 thread-safe가 아니다. LOOP 15km cold는 약 9.4초로 가이드 기준 TOO SLOW다. 운영 AI 컨테이너(`infra/ai`)는 CPU 1개·메모리 1GiB 상한으로 HR 모델만 제공한다.
- **이식 비용이 크다.** Route를 Java로 옮기면 networkx 동점 처리까지 재현해야 golden 회귀(`tools/route_regression`, 시나리오 43개 + 무작위 편도 30개)와 같은 결과가 나온다. 경사 계산은 약 100줄 규모로 이식 부담이 작다.
- **실행 데이터가 크고 Git 밖에 있다.** 부산 OSM extract(PBF), 환경 레이어(GeoJSON), 환경 거리 사전 계산 캐시(npz), DEM clip(GeoTIFF)을 시작 시 읽는다.

## 결정

두 기능을 나눠 정한다.

1. **경사 계산은 백엔드에서 한다(확정).** 백엔드가 코스 경로(GeoJSON LineString)를 받아 DEM 고도를 조회하고 100m 경사를 계산해 `courses.elevation_profile`에 저장한다. 코스를 누가 생성하든 같다. AI 개인 페이스 계획에는 저장한 경사 목록을 전달한다.
2. **코스 생성은 AI(Route V1)에서 최적화를 먼저 시도한다.** AI 담당이 Route의 지연·메모리를 운영 가능한 수준으로 줄인다. AI 유지 시 Route는 HR 추론용 `ai/service`와 분리된 **별도 Python 서비스 컨테이너**로 배포하고 백엔드가 HTTP로 호출한다. 판정 기준을 만족하지 못하면 **Spring 백엔드에 Java로 이식**하는 것으로 전환한다.

- **서비스 경계 (AI 생성 유지 시)**
  - AI(Route, 별도 Python 서비스 컨테이너): 코스 후보 생성·점수·Gate, 경로 좌표 반환. 경사는 만들지 않는다. 외부 포트 없이 백엔드만 내부 네트워크로 호출한다.
  - 백엔드: Route 호출, DEM 고도 조회와 100m 경사 계산, `courses` 저장, AI 페이스 계획 요청에 경사 전달.
  - `course_grade.py`는 백엔드 경사 계산의 비교 기준과 기존 저장 형식 변환용으로 남기고, 백엔드 구현이 끝나면 정리 여부를 AI 담당과 정한다.
- **전환 판정**
  - 기준과 기한은 AI 담당과 정해 이 ADR에 추가한다. 후보 지표는 기술 가이드 17.1의 cold·warm 지연(GOOD·ACCEPTABLE 정의), 운영 컨테이너 메모리 상한 안 실행, 동시 요청 처리, golden 회귀 통과다.
  - 전환하면 이 ADR을 대체하는 새 ADR에 판정 결과를 기록하고, 아래 "백엔드 이식 시 후보 기술"을 바탕으로 이식 설계·단계 분할 업무를 새로 만든다.
- **경사 동등성 기준**: 같은 고도 입력에서 `course_grade.py` 결과와 허용 오차 이내(369에서 값 확정).

### 경사 계산 도입 기술

후보이며 실제 버전은 369에서 Maven Central과 공식 문서로 확인해 고정한다. Context7에는 아래 라이브러리 문서가 없어(2026-11-03 조회) 각 프로젝트 저장소 문서로 확인한다.

| 용도 | Python 현재 | Java 후보 | 비고 |
|---|---|---|---|
| DEM 읽기 | rasterio | **NGA TIFF** (`mil.nga:tiff`) + GeoTIFF 좌표 태그 직접 해석 | 순수 Java, 압축·타일 TIFF와 실수 표본 지원. EPSG:4326 단일 clip이라 GeoTools 전체는 과하다 |
| 거리·보간 | numpy | 표준 Java 배열(필요 시 JTS) | 재표본·이동 중앙값·평균, 쌍선형 보간은 직접 구현 |

### 백엔드 이식 시 후보 기술 (전환할 때만)

| 용도 | Python 현재 | Java 후보 | 비고 |
|---|---|---|---|
| 지오메트리·공간 색인 | shapely(GEOS), STRtree | **JTS Topology Suite** (`org.locationtech.jts:jts-core`) | GEOS가 JTS의 C++ 이식이라 연산 의미가 같다. STRtree 제공 |
| 좌표 변환 (WGS84 ↔ UTM 52N) | pyproj | **Proj4J** (`org.locationtech.proj4j`) | 변환 결과 차이는 golden 비교로 확인 |
| OSM PBF 읽기 | pyosmium | **Osmosis PBF 리더** (`osmosis-pbf`) 또는 동급 PBF 파서 | way·node 순서가 그래프 순서를 정하므로 읽기 순서 재현을 전환 시 이식 설계에서 확인 |
| 그래프·최단 경로 | networkx + D-exact(Python 이식) | **자체 CSR + 양방향 Dijkstra 이식** | networkx 3.7의 동점 처리·이웃 순서를 정확히 재현해야 결과가 같다. JGraphT·GraphHopper는 동점·비용 처리가 달라 추천이 바뀐다 |

### 데이터 배포 방식

- 실행 데이터는 **Git에 넣지 않는다.** EC2 호스트 폴더에 두고 사용하는 컨테이너에 읽기 전용으로 연결한다. 이미지 볼륨([ADR-0016](0016-image-volume-storage.md))과 같은 방식이다.
  - DEM clip: 백엔드 컨테이너(경사 계산). 예: `~/runway/data/dem`.
  - OSM extract·환경 레이어·환경 거리 캐시: 코스 생성을 맡은 쪽 컨테이너. AI 유지 시 Route 컨테이너, 전환 시 백엔드. Route도 고도 feature("평지" 점수)에 DEM을 쓰므로 같은 파일을 공유한다.
- 파일 목록·출처·생성일·sha256을 담은 manifest를 저장소에 두고(AI 모델의 `infra/ai/models.json`과 같은 방식), 배포 전 준비 스크립트가 파일을 받아 sha256을 검증한다. 백엔드는 시작 시 manifest와 DEM 파일을 대조해 맞지 않으면 경사 계산을 준비되지 않음으로 보고한다.
- 데이터 생성(Geofabrik extract 자르기, DEM clip 받기, 환경 레이어 받기)은 오프라인 작업이라 기존 Python 도구(`ai/workspace/seongyun/route/tools/data`, `ai/workspace/seongyun/route/analysis/runway_busan_graph.py extract`)를 그대로 쓴다. 백엔드로 전환하면 환경 거리 캐시는 Python 코드 해시에 묶여 있으므로 Java 계산으로 다시 만들거나 시작 시 직접 계산한다.
- 라이선스 표기: OSM은 ODbL, Copernicus GLO-30은 Copernicus DEM 라이선스를 따르며 출처 표기 위치를 정한다.
- 로컬·CI 테스트는 실제 데이터 없이 작은 합성 DEM(전환 시 합성 그래프 포함)으로 실행하고, 실제 데이터 검증은 별도 명령으로 분리한다.

## 고려한 대안

경사 계산:

| 대안 | 장점 | 단점 |
|---|---|---|
| **백엔드에서 계산 (선택)** | 저장 계약(319)의 검증·null 보간과 계산이 한 곳에 있다. 코스 생성 주체와 무관하게 같은 경사를 만든다. 이식 규모가 작다 | 백엔드에 DEM 읽기 의존성과 데이터 배포가 추가된다. AI 구현과 결과 일치를 비교 테스트로 유지해야 한다 |
| AI(Route·`ai/service`)에서 계산해 전달 | 기존 코드를 그대로 쓴다 | 생성 주체와 저장 검증 책임이 갈라진다. 백엔드가 직접 만든 코스(전환 시)에는 다시 백엔드 구현이 필요하다 |

코스 생성:

| 대안 | 장점 | 단점 |
|---|---|---|
| **AI 최적화를 먼저 시도하고, 안 되면 백엔드 이식 (선택)** | 이식 비용을 쓰기 전에 기존 코드와 golden 동등성을 유지한 채 운영 가능성을 확인한다. Route 작성자가 계속 유지보수한다 | 최적화가 실패하면 그만큼 일정이 늦어진다. AI 유지 시 BE↔Route HTTP 계약(오류·타임아웃·재시도)과 Route 배포가 필요하다 |
| 바로 백엔드 Java 이식 | 생성·경사·저장이 한 서비스에 있어 HTTP 계약·장애 지점이 없다. 운영 체계(ADR-0003·0010)를 그대로 쓴다 | 약 7,500줄 이식과 networkx 동작 재현·동등성 검증 부담. Route 작성자와 유지보수 주체가 갈라진다. 백엔드 메모리·시작 시간이 늘어난다 |
| 지금 Route를 그대로 배포 | 추가 작업이 가장 적다 | 프로세스당 2.2–2.7GB, 직렬 처리, 15km cold 약 9.4초로 운영 기준에 맞지 않는다 |

AI 유지 시 배포 형태:

| 대안 | 장점 | 단점 |
|---|---|---|
| **별도 Python 서비스 컨테이너 (선택)** | Route 의존성(networkx·osmnx·osmium 등)·데이터·메모리를 HR 추론과 분리해 서로의 배포·장애·자원 상한에 영향을 주지 않는다. Route만 따로 확장·재시작할 수 있다 | 컨테이너·배포 파이프라인·상태 검사를 새로 만들어야 한다 |
| `ai/service`에 통합 | 컨테이너와 파이프라인을 하나로 유지한다 | CPU 1개·메모리 1GiB 상한의 HR 추론 컨테이너에 Route 데이터·메모리를 함께 올려야 한다. 의존성 충돌과 한쪽 장애가 다른 쪽에 번진다 |

세부 기술에서 비교한 대안:

| 항목 | 선택 | 비교 대안과 판단 |
|---|---|---|
| DEM 조회 | JVM에서 GeoTIFF 직접 읽기 | **PostGIS raster**(`ST_Value`, ADR-0011의 PostGIS 사용): 별도 라이브러리가 없지만 `postgis_raster` 확장·대용량 raster 적재·Flyway 관리가 필요하고 경로 점마다 DB 왕복이 생긴다. **GeoTools**: 기능이 넓지만 의존성이 크다 |
| 최단 경로 (전환 시) | 자체 이식 | **JGraphT·GraphHopper**: 검증된 라이브러리지만 networkx와 동점 처리가 달라 golden과 결과가 바뀐다. GraphHopper는 자체 OSM 가져오기·프로필 체계라 RUNNABLE 분류·요청별 비용과 맞지 않는다 |

## 결과

- **얻는 것**: 경사는 코스 생성 주체와 관계없이 백엔드가 만들고 검증해 저장한다. 코스 생성은 큰 이식 비용을 쓰기 전에 기존 구현으로 운영 가능성을 먼저 확인한다.
- **감수하는 것**: 코스 생성 주체가 판정 전까지 확정되지 않아 생성 API 계약과 데이터 배포 위치가 두 경우를 함께 고려해야 한다. AI 유지 시 Route가 경로만 반환하도록 응답을 맞추고, BE↔Route 연동을 따로 만들어야 한다. 백엔드에 DEM 데이터와 의존성이 추가된다.
- **후속 작업**:
  - [S15P31E105-369](https://ssafy.atlassian.net/browse/S15P31E105-369): DEM 고도 조회와 100m 경사 계산 백엔드 구현, `course_grade.py` 비교 테스트와 허용 오차 확정, DEM 읽기 의존성 버전 고정.
  - AI 담당: Route 최적화, 전환 판정 기준·기한 합의(별도 AI 업무).
  - AI 유지 시: BE↔Route HTTP 연동 구현(계약은 370)과 Route 별도 컨테이너 배포(`infra/` 구성·Jenkins 파이프라인·상태 검사, 인프라 변경은 별도 업무로 제안).
  - [S15P31E105-370](https://ssafy.atlassian.net/browse/S15P31E105-370): 코스 생성 외부 API 계약과 BE↔Route 연동 설계. 생성기를 내부 인터페이스로 분리해 생성 주체가 바뀌어도 외부 계약을 유지한다.
  - 전환 판정 시: 백엔드 Java 이식 설계·단계 분할 업무를 새로 만든다.
  - [S15P31E105-371](https://ssafy.atlassian.net/browse/S15P31E105-371): 생성 코스·경사 저장과 AI 페이스 계획 전달 연동.
  - DEM manifest·준비 스크립트와 EC2 볼륨 연결(인프라 변경은 별도 업무로 제안), 백엔드 컨테이너 메모리 측정.
  - [S15P31E105-320](https://ssafy.atlassian.net/browse/S15P31E105-320)(AI 1km 경사)은 경사 백엔드 이관으로 범위 조정 종료됐다.

참고: Route 구조·데이터·성능 수치는 [ROUTE_TECHNICAL_GUIDE.md](../../ai/workspace/seongyun/route/ROUTE_TECHNICAL_GUIDE.md) 15·17·20·24절(2026-10-29 측정)을 따랐다.
