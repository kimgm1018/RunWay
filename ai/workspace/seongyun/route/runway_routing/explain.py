"""Plain-language reasons for a recommended route, from its features (no scoring here).

요약: TOP3 각 경로의 feature를 사용자용 문장(이유, 주의 문구)으로 바꾼다.
위치: pipeline 밖, route_demo/app_runway.py가 응답을 만들 때 호출한다.
주의: 점수나 순위에는 영향이 없다. 체크하지 않은 조건은 '반대로 피함'이 아니라 '고려 안 함'이다.

Each reason has three forms so they can be listed or joined into one sentence:
    bullet      "강변을 많이 지나요"
    connective  "강변을 많이 지나고"
    adnominal   "강변을 많이 지나는"      -> "강변을 많이 지나고 큰길 구간이 적은 코스예요."
Checked filters come first; a checked filter the route does not satisfy becomes a caveat instead of
being hidden (OFF means "don't care", so unchecked items only appear when they are notably good).
Thresholds are shares of the route distance (features from features.py).

Traffic text uses the Running Suitability V1 measures (features.route_components), so the words
and the score describe the same thing: rs_on_major_ratio (on a major road), rs_beside_major_ratio (beside
one: separately mapped sidewalks, parallel side roads) and rs_away_ratio. Without them (older outputs) it
falls back to major_road_ratio.

Course shapes: explain_shape(f, filters, shape, info=None)
  LOOP (shape None / "loop" / "auto" / "LOOP"): returns explain(f, filters) itself (byte-identical).
  out_and_back: the repeat / out-and-back caveats are always true by design, so they are dropped (explain runs on a
    copy with those two ratios at 0); "순환" summary -> OAB_SUMMARY; note OAB_NOTE.
  point_to_point: "순환" summary -> P2P_SUMMARY; backtracking caveats are kept (they are real on a one-way route);
    note: one-way + straight-line distance back to the start (info["return_straight_m"]).
  New shapes outside the env layer (env_layer_covered_ratio < 1): river / beach / park (env-layer features) are not
    judged -- explain runs on a copy with those ratios at 0 and those filters off, so neither "거의 없어요" caveats
    nor env reasons appear; notes say the checked ones were not judged + ENV_PARTIAL_NOTE (COURSE_SHAPE_DESIGN_v2 11).
Returned dict = explain output + "shape" + "notes" (new shapes only).
"""
from .candidates import LOOP_SHAPES

# (feature, threshold, bullet, connective, adnominal), strongest first per topic
ENV_LEVELS = {
    "river": ("river_ratio", [(0.30, "강변을 많이 지나요", "강변을 많이 지나고", "강변을 많이 지나는"),
                              (0.12, "강변 구간이 조금 있어요", "강변 구간이 조금 있고", "강변 구간이 조금 있는")]),
    "beach": ("coastal_ratio", [(0.30, "바다를 따라 달려요", "바다를 따라 달리고", "바다를 따라 달리는"),
                                (0.12, "해변 구간이 조금 있어요", "해변 구간이 조금 있고", "해변 구간이 조금 있는")]),
    "park": ("green_ratio", [(0.35, "공원·녹지를 많이 지나요", "공원·녹지를 많이 지나고", "공원·녹지를 많이 지나는"),
                             (0.15, "공원·녹지 구간이 있어요", "공원·녹지 구간이 있고", "공원·녹지 구간이 있는")]),
    "trail": ("trail_ratio", [(0.50, "산책로·트레일 위주예요", "산책로·트레일 위주이고", "산책로·트레일 위주인"),
                              (0.25, "산책로 구간이 꽤 있어요", "산책로 구간이 꽤 있고", "산책로 구간이 꽤 있는")]),
    "pedestrian": ("walk_dedicated_ratio", [(0.50, "보행로 위주예요", "보행로 위주이고", "보행로 위주인"),
                                            (0.30, "보행로가 꽤 있어요", "보행로가 꽤 있고", "보행로가 꽤 있는")]),
}
FILTER_LABEL = {"river": "강변", "beach": "해변·바다", "park": "공원·녹지", "trail": "산책로·트레일",
                "pedestrian": "보행로", "avoid_major_road": "큰길 피하기", "avoid_steps": "계단 피하기",
                "avoid_tunnel": "터널 피하기", "flat": "평지 위주"}
MISSING_BELOW = 0.05          # a checked environment below this share is "almost none"
FLAT_GRADE_PCT, GENTLE_GRADE_PCT = 1.5, 3.0
# Traffic text (shares of the route): the 0.05 / 0.15 levels the earlier "큰 도로" text used, plus two notes
# shown to everyone because they are general running quality, not a preference.
AWAY_ON_MAX, AWAY_BESIDE_MAX = 0.05, 0.10   # "큰길에서 떨어진 길 위주"
FEW_ON_MAX = 0.15                           # "큰길 구간이 적어요"
MANY_ON_MIN = 0.50                          # note: more than half on major roads
MANY_BESIDE_MIN = 0.25                      # note: a quarter beside major roads
# Steps warning, from Running Suitability's own steps measure (rs_obstacle_score = max(0, 1 - step runs per km /
# 0.5)): warn when steps cost at least half of their share of the score, i.e. 0.25+ runs per km and suitability
# down by 0.1 or more (about the within-request spread of the traffic part). Normal cases show nothing.
STEPS_WARN_OBSTACLE_MAX = 0.5


def _r(bullet, connective, adnominal, filt=None):
    return {"bullet": bullet, "connective": connective, "adnominal": adnominal, "filter": filt}


def explain(f: dict, filters: dict) -> dict:
    """{'summary': sentence, 'reasons': [bullets], 'caveats': [bullets]} for one route."""
    on = {k for k, v in filters.items() if v}
    picked, notable, caveats = [], [], []

    for key, (feat, levels) in ENV_LEVELS.items():
        v = f.get(feat) or 0.0
        hit = next((lv for lv in levels if v >= lv[0]), None)
        if key in on:
            if hit:
                picked.append(_r(*hit[1:], filt=key))
            elif v < MISSING_BELOW:
                caveats.append(f"{FILTER_LABEL[key]} 구간은 거의 없어요")
            else:
                picked.append(_r(f"{FILTER_LABEL[key]} 구간이 조금 있어요", f"{FILTER_LABEL[key]} 구간이 조금 있고",
                                 f"{FILTER_LABEL[key]} 구간이 조금 있는", filt=key))
        elif hit and hit is levels[0]:
            notable.append(_r(*hit[1:]))

    on_major = f.get("rs_on_major_ratio", f.get("major_road_ratio")) or 0.0
    beside = f.get("rs_beside_major_ratio") or 0.0
    road = (_r("큰길에서 떨어진 길 위주예요", "큰길에서 떨어진 길 위주이고", "큰길에서 떨어진 길 위주인")
            if on_major <= AWAY_ON_MAX and beside <= AWAY_BESIDE_MAX else
            _r("큰길 구간이 적어요", "큰길 구간이 적고", "큰길 구간이 적은") if on_major <= FEW_ON_MAX else None)
    if "avoid_major_road" in on:
        if road:
            picked.append({**road, "filter": "avoid_major_road"})
        else:
            caveats.append(f"큰길을 따라 달리는 구간이 {round(on_major * 100)}% 있어요")
    elif road:
        notable.append(road)
    elif on_major >= MANY_ON_MIN:
        caveats.append(f"큰길을 따라 달리는 구간이 많아요 ({round(on_major * 100)}%)")
    if beside >= MANY_BESIDE_MIN:
        caveats.append(f"큰길 옆 보도·이면도로를 지나는 구간이 {round(beside * 100)}% 있어요")

    steps = f.get("steps_count") or 0
    obstacle = f.get("rs_obstacle_score")
    if "avoid_steps" in on:  # checked: always say whether the condition holds
        if steps == 0:
            picked.append(_r("계단이 없어요", "계단이 없고", "계단이 없는", "avoid_steps"))
        else:
            caveats.append(f"계단이 {steps}곳 있어요")
    elif obstacle is not None and obstacle <= STEPS_WARN_OBSTACLE_MAX:
        caveats.append(f"계단이 자주 나와요 ({steps}곳)")

    tunnel = f.get("tunnel_length_m") or 0.0
    if "avoid_tunnel" in on:
        if tunnel == 0:
            picked.append(_r("터널이 없어요", "터널이 없고", "터널이 없는", "avoid_tunnel"))
        else:
            caveats.append(f"터널 구간이 {round(tunnel)} m 있어요")

    if f.get("elevation_available"):
        g, gain = f.get("avg_grade_pct") or 0.0, f.get("elevation_gain_m") or 0.0
        flat = (_r("평지 위주예요", "평지 위주이고", "평지 위주인", "flat") if g <= FLAT_GRADE_PCT else
                _r("완만한 오르막이 조금 있어요", "완만한 오르막이 조금 있고", "완만한 오르막이 조금 있는", "flat")
                if g <= GENTLE_GRADE_PCT else None)
        if "flat" in on:
            if flat and g <= FLAT_GRADE_PCT:
                picked.append(flat)
            else:
                caveats.append(f"오르막이 있어요 (누적 상승 {round(gain)} m)")
        elif flat and g <= FLAT_GRADE_PCT:
            notable.append(flat)
    elif "flat" in on:
        caveats.append("이 구간은 고도 정보가 없어 경사를 판단하지 못했어요")

    if (f.get("repeated_edge_ratio") or 0) > 0.05:
        caveats.append("같은 길을 일부 다시 지나요")
    if (f.get("out_and_back_ratio") or 0) > 0.15:
        caveats.append("일부 구간은 갔던 길로 돌아와요")

    reasons = picked + notable
    if not reasons:
        summary = "목표 거리에 맞춘 순환 코스예요."
    elif len(reasons) == 1:
        summary = f"{reasons[0]['adnominal']} 코스예요."
    else:
        summary = f"{reasons[0]['connective']} {reasons[1]['adnominal']} 코스예요."
    return {"summary": summary, "reasons": [r["bullet"] for r in reasons[:4]], "caveats": caveats}


def details(f: dict, target_m: float) -> list:
    """Rows for the 상세 정보 panel: {group, label, value}. Groups: the course itself, Running Suitability
    (general running quality: what the suitability score is made of), environment (preference features)."""
    pct = lambda v: "–" if v is None else f"{round(v * 100)}%"  # noqa: E731
    elev = f.get("elevation_available")
    s = f.get("running_suitability")
    rows = [("코스", "거리", f"{f['distance_m'] / 1000:.2f} km (목표 {target_m / 1000:g} km, {f['distance_error_pct']:+.1f}%)"),
            ("코스", "누적 상승", f"{round(f['elevation_gain_m'])} m" if elev else "고도 정보 없음"),
            ("코스", "평균 경사", f"{f['avg_grade_pct']}%" if elev else "–"),
            ("코스", "반복 구간", pct(f.get("repeated_edge_ratio"))), ("코스", "왕복 구간", pct(f.get("out_and_back_ratio"))),
            ("러닝 적합도", "러닝 적합도", "–" if s is None else f"{round(s * 100)} / 100"),
            ("러닝 적합도", "큰길 위", pct(f.get("rs_on_major_ratio", f.get("major_road_ratio")))),
            ("러닝 적합도", "큰길 옆 (보도·이면도로)", pct(f.get("rs_beside_major_ratio"))),
            ("러닝 적합도", "큰길에서 떨어진 길", pct(f.get("rs_away_ratio"))),
            ("러닝 적합도", "계단", f"{f.get('steps_count', 0)}곳 ({round(f.get('steps_length_m') or 0)} m)"),
            ("환경", "강변", pct(f.get("river_ratio"))), ("환경", "해변·바다", pct(f.get("coastal_ratio"))),
            ("환경", "공원·녹지", pct(f.get("green_ratio"))), ("환경", "산책로·트레일", pct(f.get("trail_ratio"))),
            ("환경", "보행 전용길", pct(f.get("walk_dedicated_ratio")))]
    return [{"group": g, "label": k, "value": v} for g, k, v in rows]


# ------------------------------------------------------------------ course shapes
LOOP_SUMMARY = "목표 거리에 맞춘 순환 코스예요."
OAB_SUMMARY = "반환점에서 같은 길로 돌아오는 왕복 코스예요."
OAB_NOTE = "반환점까지 갔다가 같은 길로 돌아와요."
P2P_SUMMARY = "목표 거리에 맞춘 편도 코스예요."
ENV_PARTIAL_NOTE = "이 구간은 강·바다·공원 정보가 일부 없어서 환경 조건은 판단하지 않았어요."
ENV_KEYS = {"river": "river_ratio", "beach": "coastal_ratio", "park": "green_ratio"}


def explain_shape(f: dict, filters: dict, shape: str | None, info: dict | None = None) -> dict:
    """app이 TOP3 경로마다 부르는 진입점: LOOP는 explain() 그대로, OAB/P2P는 shape별 요약과 notes를 더한다(모듈 docstring)."""
    if shape in LOOP_SHAPES:
        return explain(f, filters)
    info = info or {}
    f2, filt2, notes = dict(f), dict(filters), []
    if (f.get("env_layer_covered_ratio") if f.get("env_layer_covered_ratio") is not None else 1.0) < 1.0:
        for key, feat in ENV_KEYS.items():
            f2[feat] = 0.0
            if filt2.get(key):
                notes.append(f"{FILTER_LABEL[key]} 조건은 환경 정보가 부족해 판단하지 못했어요.")
                filt2[key] = False
        notes.append(ENV_PARTIAL_NOTE)
    if shape == "out_and_back":
        f2["repeated_edge_ratio"], f2["out_and_back_ratio"] = 0.0, 0.0
        ex = explain(f2, filt2)
        if ex["summary"] == LOOP_SUMMARY:
            ex["summary"] = OAB_SUMMARY
        notes.insert(0, OAB_NOTE)
    elif shape == "point_to_point":
        ex = explain(f2, filt2)
        if ex["summary"] == LOOP_SUMMARY:
            ex["summary"] = P2P_SUMMARY
        back = info.get("return_straight_m")
        notes.insert(0, "출발점으로 돌아오지 않는 편도 코스예요" +
                     (f" (도착점에서 출발점까지 직선 {back / 1000:.1f} km)." if back is not None else "."))
    else:
        raise ValueError(f"unknown shape {shape!r}")
    return {**ex, "shape": shape, "notes": notes}
