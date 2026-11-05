"""Rule-based route scoring and ranking (not a learned model). Weights: config/scoring_config.json (frozen).

요약: 유효 후보에 규칙 기반 점수와 러닝 적합도 항을 더해 순위를 매기고, 60 % 겹치는 후보를 지운다.
위치: features 다음, Gate 전. Gate가 FAIL을 빼면 rank를 다시 부른다.
주의: 동점은 candidate_id로 깬다. 정렬 순서가 dedupe 결과를 바꾼다.

route_score = distance_fit
            + sum_pref   weight * (pref / 5)  * feature        (Preference Mode only)
            - sum_avoid  weight * (avoid / 5) * feature        (Preference Mode only)
            + difficulty term (Preference Mode, only when DEM elevation exists)
            - repeated_edge_ratio * w  - out_and_back_ratio * w (LOOP requests)

Baseline Mode uses only distance_fit and the shape penalties, so it ranks by "did the generator
hit the target with a clean loop". Every weight is read from scoring_config.json; each returned
term carries its feature value and contribution so the UI can explain the score.

Running Suitability V1 adds weight x running_suitability (config/running_suitability_config.json ranking.weight) to
both scores; the term is appended to the score terms so the breakdown shows it.

Ranking (rank): score order (ties: candidate_id), then greedy dedupe -- a route sharing >= DEDUPE_OVERLAP (60 %) of
the shorter route's length with a better one is dropped.
"""
from dataclasses import asdict, dataclass

from .data import load_scoring_config
from .features import LABEL, LOOP, TERM, TOLERANCE

PREF_KEYS = ["river", "beach", "park", "trail", "pedestrian"]
AVOID_KEYS = ["major_road", "steps", "tunnel"]
DIFFICULTIES = ["any", "flat", "moderate", "hilly"]
DEDUPE_OVERLAP = 0.60


@dataclass
class Preferences:
    """사용자 선호(0–5)와 난이도. 0은 "고려 안 함"이다(반대로 피하는 뜻이 아니다). 모두 0이고 difficulty "any"면 neutral이며,
    neutral 요청은 생성 bias가 없고 out["preference"]가 None이다(TOP3는 baseline 순위)."""
    river: float = 0
    beach: float = 0
    park: float = 0
    trail: float = 0
    pedestrian: float = 0
    avoid_major_road: float = 0
    avoid_steps: float = 0
    avoid_tunnel: float = 0
    difficulty: str = "any"

    @classmethod
    def from_dict(cls, d: dict | None) -> "Preferences":
        d = d or {}
        p = cls(**{k: d[k] for k in asdict(cls()) if k in d})
        for k in PREF_KEYS + [f"avoid_{a}" for a in AVOID_KEYS]:
            setattr(p, k, float(min(5, max(0, float(getattr(p, k))))))
        if p.difficulty not in DIFFICULTIES:
            p.difficulty = "any"
        return p

    def is_neutral(self) -> bool:
        return (all(getattr(self, k) == 0 for k in PREF_KEYS + [f"avoid_{a}" for a in AVOID_KEYS])
                and self.difficulty == "any")

def score_route(features: dict, prefs: Preferences, mode: str, route_type: str, tolerance: float,
                cfg: dict | None = None) -> dict:
    """후보 하나의 점수 {score, terms}. mode "baseline"은 거리 적합도와 모양 penalty만, "preference"는 선호·회피·난이도
    항을 더한다(식은 모듈 docstring). terms에 항목별 값과 기여도가 남아 화면 설명과 debug에 쓰인다."""
    cfg = cfg or load_scoring_config()
    terms = []

    def add(name, label, value, weight, contrib, group):
        terms.append({"term": name, "label": label, "feature_value": value, "weight": weight,
                      "contribution": round(contrib, 4), "group": group})

    err = abs(features["distance_error_pct"]) / 100
    fit = max(0.0, 1 - err / tolerance)
    w = cfg["distance_fit"]["weight"]
    add("distance_fit", "목표 거리 적합도", round(fit, 3), w, w * fit, "base")

    if mode == "preference":
        for k, t in _terms(cfg["preference_terms"]):
            p = getattr(prefs, k) / 5
            if p > 0:
                v = features[t["feature"]]
                add(k, t["label"], v, t["weight"], t["weight"] * p * v, "preference")
        for k, t in _terms(cfg["avoid_terms"]):
            a = getattr(prefs, f"avoid_{k}") / 5
            if a > 0:
                v = features[t["feature"]]
                add(f"avoid_{k}", f"{t['label']} 회피", v, t["weight"], -t["weight"] * a * v, "avoid")
        if prefs.difficulty != "any" and features.get("elevation_available"):
            t = cfg["difficulty_terms"][prefs.difficulty]
            v = features[t["feature"]]
            x = {"minimize": -v, "maximize": v, "target": -abs(v - t.get("target", 0))}[t["direction"]]
            add(f"difficulty_{prefs.difficulty}", t["label"], v, t["weight"], t["weight"] * x, "difficulty")

    sp = cfg["shape_penalties"]
    add("repeated_edge_penalty", "반복 구간", features["repeated_edge_ratio"], sp["repeated_edge_ratio"],
        -sp["repeated_edge_ratio"] * features["repeated_edge_ratio"], "shape")
    if route_type == "LOOP":
        add("out_and_back_penalty", "왕복 구간", features["out_and_back_ratio"], sp["out_and_back_ratio"],
            -sp["out_and_back_ratio"] * features["out_and_back_ratio"], "shape")

    total = sum(t["contribution"] for t in terms)
    terms.sort(key=lambda t: -abs(t["contribution"]))
    return {"score": round(total, 4), "terms": terms}

def _terms(section: dict):
    return ((k, t) for k, t in section.items() if not k.startswith("_"))


def with_suitability(score: dict, s: float, weight: float) -> dict:
    """score_route output plus the suitability term (score stays the sum of the rounded contributions)."""
    c = round(weight * s, 4)
    terms = score["terms"] + [{"term": TERM, "label": LABEL, "feature_value": round(s, 4), "weight": weight,
                               "contribution": c, "group": "suitability"}]
    terms.sort(key=lambda t: -abs(t["contribution"]))
    return {"score": round(score["score"] + c, 4), "terms": terms}


def overlap_ratio(a_eids, b_eids, length) -> float:
    a, b = set(a_eids), set(b_eids)
    la, lb = length[list(a)].sum(), length[list(b)].sum()
    shared = length[list(a & b)].sum() if a & b else 0.0
    return float(shared / min(la, lb)) if min(la, lb) > 0 else 1.0


def rank(valid: list, key: str, length) -> list:
    """Score order, then the PoC greedy dedupe (shared length / shorter route >= 0.6 is a duplicate)."""
    # 결정성: 동점은 candidate_id로 깬다(sorted는 stable). 같은 요청이면 언제나 같은 TOP3가 나와야 golden이 성립한다.
    # dedupe는 앞(점수 높은 쪽)부터 탐욕적으로 하므로 순서가 결과를 바꾼다. 정렬 key를 바꾸면 추천이 달라진다.
    kept = []
    for r in sorted(valid, key=lambda r: (-r[key]["score"], r["candidate_id"])):
        ov = max((overlap_ratio(r["eids"], k["eids"], length) for k in kept), default=0.0)
        if ov < DEDUPE_OVERLAP:
            kept.append({**r, "max_overlap_with_better": round(ov, 3)})
    return kept


def score_loop(valid: list, prefs: Preferences, scfg: dict) -> None:
    """LOOP: baseline (and preference) scores WITHOUT the suitability term; add_suitability follows after the pre-RS
    rank, whose lengths are counts.final_baseline / final_preference (kept for API compatibility)."""
    neutral = prefs.is_neutral()
    for r in valid:
        r["baseline_score"] = score_route(r["features"], Preferences(), "baseline", LOOP, TOLERANCE, scfg)
        if not neutral:
            r["preference_score"] = score_route(r["features"], prefs, "preference", LOOP, TOLERANCE, scfg)


def add_suitability(valid: list, weight: float) -> None:
    """LOOP: score += weight x running_suitability; the score without it is kept as <key>_without_rs."""
    for r in valid:
        s = r["features"][TERM]
        for key in ("baseline_score", "preference_score"):
            if key in r:
                r[f"{key}_without_rs"] = r[key]
                r[key] = with_suitability(r[key], s, weight)


def score_shape(valid: list, prefs: Preferences, route_type: str, scfg: dict, weight: float) -> None:
    """OUT_AND_BACK / POINT_TO_POINT: both scores with the suitability term in one pass (the LOOP-only out-and-back
    penalty is off because route_type is not LOOP)."""
    neutral = prefs.is_neutral()
    for r in valid:
        rs = r["features"][TERM]
        base = score_route(r["features"], Preferences(), "baseline", route_type, TOLERANCE, scfg)
        r["baseline_score_without_rs"], r["baseline_score"] = base, with_suitability(base, rs, weight)
        if not neutral:
            pref = score_route(r["features"], prefs, "preference", route_type, TOLERANCE, scfg)
            r["preference_score_without_rs"], r["preference_score"] = pref, with_suitability(pref, rs, weight)
