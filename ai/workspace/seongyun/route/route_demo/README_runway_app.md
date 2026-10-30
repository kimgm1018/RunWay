# RunWay 코스 추천 데모 (앱 형태)

출발 위치, 목표 거리, 원하는 조건을 한 화면에서 고르고 **코스 추천받기**를 누르면 새 러닝 코스를 생성해 TOP 3를 추천합니다. 저장된 코스를 찾는 것이 아니라, 누를 때마다 새로 만듭니다.

## 실행 (로컬 전용)

RunWay 루트에서, `requirements-route.txt`로 만든 venv로 실행합니다(설치 절차: `ROUTE_BACKEND_README.md`).

```bash
python -m uvicorn route_demo.app_runway:app --host 127.0.0.1 --port 8002
```

http://localhost:8002 를 엽니다. 부산 OSM 추출본을 읽고 빠른 graph builder를 자체 점검하는 동안(약 10~15초) 버튼이 비활성입니다.

요청별 도로 graph는 `runway_routing/graph.py`의 fast builder가 만듭니다. canonical과 같은 graph를 3~4배 빠르게 만들고, 시작할 때 한 번 canonical과 비교합니다. 다르면 자동으로 canonical builder를 씁니다. `RUNWAY_FAST_GRAPH=0`으로 실행하면 처음부터 canonical builder를 씁니다. 현재 어느 쪽인지는 `/api/status`의 `graph_builder`에서 볼 수 있습니다. 한 위치의 첫 추천은 그 주변 도로망을 준비해서 몇 초 더 걸리고, 같은 위치의 다음 추천은 빠릅니다. `.claude/launch.json`의 `runway-app-route-venv` 항목도 같은 명령입니다.

## 흐름

1. **출발 위치**: 기본 위치(광안리해수욕장), 내 위치(브라우저 위치 권한), 지도 클릭, 예시 출발지 버튼 중 하나로 정합니다.
2. **목표 거리**: 3 / 5 / 10 km 또는 직접 입력(1~15 km).
3. **조건 체크**: 체크한 것만 반영합니다. 체크하지 않은 조건은 신경 쓰지 않습니다(반대로 피하지 않음).
   - 환경: 강변·하천, 해변·바다, 공원·녹지, 트레일·산책로
   - 도로: 보행로 위주, 큰길·계단·터널 피하기
   - 난이도: 평지 위주
4. **코스 추천받기**:
   - canonical generator(`analysis/runway_route_api.py`)가 후보를 만듭니다. 조건을 체크하면 약한 edge 비용 bias로 생성에도 반영합니다(`runway_routing/candidates.py`, `edge_b04`).
   - 기존 feature와 scorer가 순위를 매기고 TOP 3를 보여 줍니다.
5. **러닝 적합도** (Running Suitability V1, `runway_routing/features.py`·`scorer.py`):
   - 어떤 조건을 체크했든, 모든 추천의 순위에 "일반적으로 달리기 좋은 길인가"를 함께 반영합니다.
   - 점수: 큰길 위 0 · 큰길 옆(보도·이면도로) 0.5 · 큰길에서 떨어진 길 1의 길이 평균(80%)과 계단(20%)으로 0~100점
   - 반영 가중치는 0.25입니다(`runway_routing/config/running_suitability_config.json`). 코스 생성 자체는 바꾸지 않습니다.
   - 근거: `reports/runway_running_suitability_v1_audit.md`
6. **결과 카드**: 거리, 한 문장 요약, 이유 목록을 보여 줍니다. 체크했는데 맞지 않는 조건과 큰길을 많이 지나는 구간은 주의 문구로 따로 표시합니다. **상세 정보**는 코스 · 러닝 적합도(점수, 큰길 위·옆·떨어진 길 비율, 계단) · 환경 순으로 보여 주고, 고도 그래프가 있습니다. 카드나 지도 위 탭(추천 1/2/3)을 누르면 그 경로를 강조합니다.
7. **다른 코스 추천**: 같은 위치·거리·조건으로 다음 seed 블록에서 새로 생성합니다. 카드마다 이전 추천과 겹치는 비율을 보여 줍니다.
8. **디버그 보기**(기본 접힘): 작업 원 도로망의 RUNNABLE / EXCLUDED / UNCERTAIN, 환경 데이터 범위, 요청 원자료(seed, 후보 수, 점수 항목)를 볼 수 있습니다.

## 실패 안내

| 상황 | 화면 문구 |
|---|---|
| 부산 추출본 밖 | 현재 위치는 아직 추천 지역(부산) 밖이에요… |
| 주변에 길이 없음 (바다 등) | 고른 위치 주변에 달릴 수 있는 길이 없어요… |
| 가장 가까운 길이 250 m 넘게 떨어짐 | 고른 위치에서 달릴 수 있는 길까지 N m나 떨어져 있어요… |
| 거리 범위 밖 | 거리는 1~15 km 사이로 정해 주세요. |
| 후보 없음 | 이 위치와 거리로는 코스를 만들지 못했어요… |
| 체크한 환경이 주변에 거의 없음 | 이 주변에는 해변·바다 구간이 거의 없어요. 나머지 조건으로 추천했어요. |
| 엔진 준비 중 / 서버 오류 | 추천 엔진을 준비하는 중이에요… / 코스를 만드는 중 문제가 생겼어요… |

## 파일

| 파일 | 역할 |
|---|---|
| `route_demo/app_runway.py` | FastAPI: `/api/status`, `/api/recommend`, `/api/debug/network` |
| `route_demo/templates/runway.html` | 화면 |
| `route_demo/static/runway.js` | 화면 동작 |
| `route_demo/static/runway.css` | 화면 스타일 |
| `runway_routing/explain.py` | feature → 자연어 이유. generator와 무관해서 실제 앱 백엔드에서도 재사용할 수 있습니다. |

옛 PoC 데모(`app.py`, 8000)와 비교 화면(`app_canonical.py`, 8001)은 2026-10-29 handoff 정리에서 저장소에서 뺐습니다(백업: `RunWay_data/route_handoff_2026-10-29/removed_from_repo/`).
