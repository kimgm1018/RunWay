# 제안: `courses.elevation_profile` JSONB 형식 합의 (팀 합의 전)

팀 스키마는 `courses.elevation_profile JSONB NULL`만 정하고 내용 형식은 정하지 않았다(`docs/design/api/courses.md`: "JSON (구조 확인 필요)"). AI 개인 계획(`/v1/pace/personal-plan`)은 이 컬럼으로 코스 경사를 만든다. 현재 쓰이는 모양이 둘이라 AI는 당분간 **두 형식을 모두 받는다**.

## 지금 받는 형식

| 형식 | 예 | 해석 |
|---|---|---|
| A. 숫자 배열 | `[20, 24, 30, 46, 58, 40, 28, 24, 22, 20]` | 고도(m). 코스 0 m부터 끝(`courses.distance`)까지 **고르게** 놓인 점으로 본다 |
| B. 점 배열 | `[{"distanceM": 0, "elevationM": 20.5}, {"distanceM": 120, "elevationM": 21.0}, …]` | 출발점부터의 누적 거리(m)와 고도(m). 거리 엄격 증가, 0 ~ 코스 거리(+1 m) 안 |

- 프론트 목업(`frontend/src/data/mock/fixtures.ts`)은 A(10개 점)다.
- 라우팅 모듈 `profile_m`(`runway_routing/features.py`)도 A 모양(약 120개, 이미 스무딩됨)이지만, 20 m 표본을 `len//120` 간격으로 건너뛰어 마지막 점이 정확히 코스 끝이 아닐 수 있다. 그래서 A의 "고르게 놓임" 해석은 근사다. **정확한 거리가 필요하면 B를 권한다.**

## 거부(→ 경사 정보 없음) 조건

null, 빈 배열, 점 1개, 숫자가 아닌 값·NaN·boolean, 두 형식 섞임, B에서 거리가 증가하지 않거나 코스 밖, 고도가 −500~9000 m 밖. 이때 계획은 `FREE_RUN_GRADE_POLICY`(기본 `flat0`, 0% 평지)를 따른다: `reject`면 422 `COURSE_GRADE_UNAVAILABLE`, 아니면 0% 평지로 계산하고 경고 `COURSE_GRADE_PROFILE_MISSING`, `FREE_RUN_GRADE_POLICY_<값>_PROVISIONAL`, `ODE_GRADE_FILLED_0`을 붙인다(ODE에는 "경사 모름" 모드가 없다).

## 경사 계산 (라우팅 모듈과 같은 스무딩)

1. 20 m 간격 재표본(선형 보간), 코스 끝점 포함
2. 중앙값 5칸(100 m) → 평균 3칸(60 m) 이동 필터(가장자리는 끝값 반복)
3. 0 m부터 100 m 구간마다 (끝 고도 − 시작 고도) / 구간 길이 × 100 %, 마지막은 남은 거리
4. 구간이 450개(AI05 경사 구간 상한)를 넘으면 100 m의 배수로 넓혀 합친다(예: 42.195 km → 100 m)

구현: `app/course_grade.py`, 테스트: `tests/test_course_grade.py`.

## 합의가 필요한 것

1. 최종 형식: B(점 배열) 하나로 고정할지, A를 계속 허용할지. A를 쓰면 "0 m~코스 끝 등간격"을 계약으로 적어야 한다.
2. 고도 기준(DEM 출처, 해발 m)과 이미 스무딩된 값인지 여부(AI가 다시 스무딩하면 조금 더 평평해진다).
3. 경로가 바뀌면 `elevation_profile`과 `updated_at`을 같이 갱신(AI 응답의 `courseVersion = courses:<id>:<updated_at>`).
4. 값이 없을 때 GPS 경로+DEM으로 AI가 직접 만들지: AI 컨테이너에는 DEM이 없어 구현하지 않았고 자리만 있다(`app/db_lookup.py`의 `RouteElevationSource`).
