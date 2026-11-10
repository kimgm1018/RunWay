"""Usability Gate adapter: build the frozen rule engine's inputs from a request, then apply its verdicts.

요약: 동결 규칙 엔진(usability_gate.py)의 입력을 만들고 판정(PASS/REVIEW/FAIL)을 결과에 적용한다.
위치: scorer 다음, 응답 직전. 모든 shape가 지난다.
주의: FAIL은 dedupe 전에 빼고 다시 순위를 매긴다. REVIEW는 순위를 바꾸지 않고 로그에만 남는다.

The rules themselves are usability_gate.py (frozen, pre-registered ug-v1 + ug-v2 in config/; never edit). This module:
  Gate(mode, extract_path, osm_data_timestamp)   loads the configs and the gate version (config / classify / PBF sha)
  gate_context(cg, source)                       GateContext over the request graph's ALL-status edges (cached on cg)
  build_context(source, edge_triples)            the same constructor for any edge set (P2P end snap uses G's edges)
  route_input(r, cg, request_type, ...)          one pool record -> usability_gate.RouteInput
  Gate.apply(out, ...)                           evaluate every valid record -> apply_gate below

Verdicts: PASS = serve normally. REVIEW = serve, never changes ranking, only logged (review_queue -> server JSONL,
never sent to the browser). FAIL = in "enforce" removed from the pool BEFORE dedupe and re-ranking (a removed route
must not suppress a near-duplicate that is safe), in "shadow" only recorded ("would_remove").

판정 의미: PASS = 그대로 추천. REVIEW = 추천은 하되 순위에 영향이 없고 서버 로그에만 남긴다(사람이 나중에 검토,
브라우저로 보내지 않음). FAIL = 추천하면 안 되는 경로(금지 도로, 구조 규칙 위반 등). enforce에서만 최종 후보에서 빠진다.
RUNWAY_USABILITY_GATE=shadow(앱 환경변수)는 판정만 기록하고 아무것도 빼지 않는 비상용 rollback이다.

apply_gate(out, evaluate, stage_b, rank, mode, top_k=3)  (pure; unchanged from the pre-refactor gate core)
  out       RoutePipeline result: pool (records with invalid_reason), baseline, preference (None when
            the request has no preference), issues, counts. Scores in the records are the RS-augmented ones.
  evaluate  record -> GateResult {verdict PASS|REVIEW|FAIL, fail_codes, review_codes, review_segments}
  stage_b   record -> list of F1-F4 failure codes for the TOP-k payload re-check ([] = pass)
  rank      (valid records, score key) -> ranked list; the pipeline passes scorer.rank (dedupe 0.6)
  mode      "shadow": nothing changes, results are only recorded
            "enforce": FAIL records get invalid_reason "usability_gate:<codes>" and are removed BEFORE the dedupe,
                       both lists are re-ranked (preference stays None if it was None); Stage B re-checks the active
                       list's TOP-k and only on a failure removes that record and re-ranks (refill). If nothing is
                       left, a blocking issue ALL_FAILED_CODE is added (distinct from the demo's NO_ROUTE).
REVIEW never changes ranking; it only produces review_queue records.
review_queue (lead decision; same columns as usability-audit's offline P3 queue): one row per REVIEW segment
(gate_level REVIEW, action "logged") AND per tag-based FAIL segment (gate_level FAIL, action "candidate_removed" in
enforce, "would_remove" in shadow; lead vocabulary {logged, candidate_removed, would_remove}). Structural FAIL codes (caller-supplied `structural`, from usability_gate.fail_code_classes;
default STRUCTURAL_CODES = F1-F7, PE1 / PE2 / PE4 / PE5 -- invariants that should never fire) go to a separate incidents
log with the gate's incident_segments. When nothing is removed the ranked lists are
returned untouched, so a FAIL-free enforce run is identical to V1 apart from the added "usability" key.
"""
import hashlib
from pathlib import Path

import numpy as np

from . import usability_gate as UG
from .data import CONFIG_DIR, ROOT, classify
from .env_flags import flag as env_flag

# RUNWAY_GATE_FAST_CONTEXT=0: 요청 graph의 Gate context를 usability_gate.build_context(Python 반복)로 만든다(결과 같음).
FAST_CONTEXT = env_flag("RUNWAY_GATE_FAST_CONTEXT")

HERE = Path(__file__).resolve().parent
UG_V1 = CONFIG_DIR / "ug-v1.json"
UG_V2 = CONFIG_DIR / "ug-v2.json"
WALK_FILTER = ROOT / "analysis" / "runway_walk_filter.py"
VERDICTS = ("PASS", "REVIEW", "FAIL")
MODES = ("shadow", "enforce")
ALL_FAILED_CODE = "USABILITY_GATE_ALL_FAILED"
STRUCTURAL_CODES = frozenset({"F1", "F2", "F3", "F4", "F5", "F6", "F7", "PE1", "PE2", "PE4", "PE5"})
LISTS = ("baseline", "preference")


def _sha(p: Path) -> str:
    return hashlib.sha256(Path(p).read_bytes()).hexdigest()


class _MemoGet:
    """table.get with a per-context memo: the compact store's views (ways / lonlat) look the id up and build the value on
    every call; the Gate asks for the same way / node many times per request, and the context lives as long as the request
    graph (warm requests reuse it). Values are the view's (equal to BusanSource.ways / lonlat); callers only read them."""

    def __init__(self, table):
        self._table, self._memo = table, {}

    def get(self, k, default=None):
        x = self._memo.get(k, self)
        if x is self:
            x = self._memo[k] = self._table.get(k)
        return default if x is None else x


def build_context(source, edge_triples):
    """usability_gate.GateContext from the extract tables (BusanSource.ways / lonlat) and (osm_u, osm_v, osmid) triples."""
    ways = source.ways if isinstance(source.ways, dict) else _MemoGet(source.ways)
    lonlat = source.lonlat if isinstance(source.lonlat, dict) else _MemoGet(source.lonlat)
    return UG.build_context(ways, lonlat, edge_triples, classify)


class _Incident:
    """usability_gate.build_context의 incident(node)와 같은 값을 배열로 만든다(S15P31E105-626).
    원래 코드는 (a, b, w)마다 adj[a].append((b, w)), adj[b].append((a, w))를 한다(a == b는 건너뜀). 그래서 node 하나의
    목록 순서는 반쪽 간선 (2i: a 쪽, 2i + 1: b 쪽)의 등장 순서다. 반쪽 간선을 node로 안정 정렬하면 같은 순서가 되고,
    목록은 Gate가 물어본 node만 만든다(같은 list 객체를 다시 돌려준다). 값은 Python int tuple이다."""

    def __init__(self, u, v, w):
        u, v, w = (np.asarray(x).astype(np.int64, copy=False) for x in (u, v, w))
        keep = np.repeat(u != v, 2)
        src = np.empty(2 * len(u), np.int64)
        dst = np.empty(2 * len(u), np.int64)
        src[0::2], src[1::2] = u, v
        dst[0::2], dst[1::2] = v, u
        src, dst, ww = src[keep], dst[keep], np.repeat(w, 2)[keep]
        o = np.argsort(src, kind="stable")
        self._key, self._dst, self._w = src[o], dst[o], ww[o]
        self._memo = {}

    def __call__(self, n):
        x = self._memo.get(n)
        if x is None:
            try:
                k = int(n)
            except (TypeError, ValueError):
                return []                                  # adj.get(n, []): not a node id
            if k != n:
                return []
            lo, hi = np.searchsorted(self._key, k, "left"), np.searchsorted(self._key, k, "right")
            x = self._memo[n] = list(zip(self._dst[lo:hi].tolist(), self._w[lo:hi].tolist()))
        return x


def gate_context(cg, source):
    """build_context over the request graph's all-status edges (cached on the graph object).
    incident는 _Incident(배열)로 만든다. usability_gate.build_context의 adj와 같은 목록·순서다(S15P31E105-626)."""
    ctx = getattr(cg, "_ug_ctx", None)
    if ctx is None:
        e = cg.edges_all
        if not FAST_CONTEXT:
            ctx = build_context(source, zip(e["osm_u"], e["osm_v"], e["osmid"]))
        else:
            ways = source.ways if isinstance(source.ways, dict) else _MemoGet(source.ways)
            lonlat = source.lonlat if isinstance(source.lonlat, dict) else _MemoGet(source.lonlat)
            inc = _Incident(e["osm_u"].to_numpy(), e["osm_v"].to_numpy(), e["osmid"].to_numpy())
            ctx = UG.GateContext(way=ways.get, lonlat=lonlat.get, incident=inc, classify=classify)
        cg._ug_ctx = ctx
    return ctx


def route_input(r: dict, cg, request_type: str, target_m: float, start: dict, p2p: dict | None = None):
    nodes = tuple(int(cg.node_ids[i]) for i in r["nodes"])
    ways = tuple(int(cg.ea["osmid"][e]) for e in r["eids"])
    canon = list(ways)
    for m in r.get("osmid_mismatches", []):
        for i in range(len(ways)):
            if canon[i] == m["adapter_way"] and {nodes[i], nodes[i + 1]} == {m["u"], m["v"]}:
                canon[i] = int(m["canonical_way"])
    extra = {}
    if p2p is not None:
        extra = {k: p2p[k] for k in ("end_node", "dest_snap_m", "dest_in_extract", "dest_lonlat", "same_component",
                                     "pe5_edge_lines", "pe5_env_polys", "pe5_env_lines") if k in p2p}
    return UG.RouteInput(
        request_type=request_type, nodes=nodes, ways=ways,
        lengths_m=tuple(float(cg.ea["length"][e]) for e in r["eids"]), target_m=float(target_m),
        start_node=int(start["node"]), start_snap_m=float(start["snap_m"]), start_in_extract=True,
        canonical_ways=tuple(canon), payload_latlon=tuple(tuple(x) for x in r.get("coords") or ()) or None,
        min_dist_to_area_edge_m=r["features"].get("min_dist_to_coverage_edge_m"), **extra)


class Gate:
    """One pipeline's gate: mode ("shadow" | "enforce"), frozen configs, version stamp."""

    def __init__(self, mode: str, extract_path, osm_data_timestamp, *, extract_sha256=None):
        if mode not in MODES:
            raise ValueError(f"mode must be one of {MODES}")
        self.mode = mode
        self.cfg = UG.load_config(UG_V1, UG_V2)
        self.structural = tuple(UG.fail_code_classes(self.cfg)["structural"])
        self.files = {"ug-v1.json": _sha(UG_V1), "ug-v2.json": _sha(UG_V2),
                      "usability_gate.py": _sha(HERE / "usability_gate.py")}
        self.version = UG.make_gate_version(
            self.cfg, _sha(UG_V1) + ":" + _sha(UG_V2), _sha(WALK_FILTER),
            _sha(Path(extract_path)) if extract_sha256 is None else extract_sha256, osm_data_timestamp)

    def skipped(self, why: str) -> dict:
        return {"mode": self.mode, "skipped": why, "gate_version": self.version}

    def apply(self, out: dict, request_type: str, get_graph, target_m: float, start: dict | None, source, rank,
              p2p: dict | None = None) -> dict:
        """Gate one pipeline result. get_graph() is called only when there is something to gate (a request with no valid
        candidate never builds or touches a graph here). rank(valid, key, length) is the pipeline's ranking."""
        if start is None or not any(r["invalid_reason"] is None for r in out["pool"]):
            out["usability"] = self.skipped("no valid candidate")
            return out
        cg = get_graph()
        ctx, cfg = gate_context(cg, source), self.cfg

        def ri(r):
            return route_input(r, cg, request_type, target_m, start, p2p)

        def evaluate(r):
            return UG.evaluate(ri(r), ctx, cfg, self.version).to_dict()

        def stage_b(r):
            return UG.stage_b(ri(r), ctx, cfg)

        out = apply_gate(out, evaluate, stage_b, lambda valid, key: rank(valid, key, cg.ea["length"]), self.mode,
                         structural=self.structural)
        out["usability"]["gate_version"] = self.version
        out["usability"]["gate_files_sha256"] = self.files
        out["usability"]["request_type"] = request_type
        return out


# ------------------------------------------------------------------ apply_gate (pure)
def _positions(out: dict) -> dict:
    return {lst: {r["candidate_id"]: i + 1 for i, r in enumerate(out[lst] or [])} for lst in LISTS}

def _rerank(out: dict, valid: list, rank) -> None:
    out["baseline"] = rank(valid, "baseline_score")
    if out["preference"] is not None:
        out["preference"] = rank(valid, "preference_score")

def apply_gate(out: dict, evaluate, stage_b, rank, mode: str, top_k: int = 3, structural=STRUCTURAL_CODES) -> dict:
    """Gate 판정을 out에 적용한다(순수 함수, 인자 설명은 모듈 docstring). out["usability"]에 판정, 제거 목록,
    review_queue, incidents를 넣는다. enforce: FAIL 제거 → 재정렬 → Stage B로 TOP-k 재검사(실패 시 빼고 다시 채움)."""
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    pos = _positions(out)
    valid = [r for r in out["pool"] if r["invalid_reason"] is None]
    results, queue, incidents = {}, [], []
    fail_action = "candidate_removed" if mode == "enforce" else "would_remove"
    structural = set(structural)
    for r in valid:
        g = evaluate(r)
        cid = r["candidate_id"]
        results[cid] = {"verdict": g["verdict"], "fail_codes": list(g["fail_codes"]),
                        "review_codes": list(g["review_codes"])}
        ranks = {"rank_baseline": pos["baseline"].get(cid), "rank_preference": pos["preference"].get(cid),
                 "candidate_verdict": g["verdict"]}
        for seg in g.get("review_segments", []):
            queue.append({"candidate_id": cid, **seg, "gate_level": "REVIEW", "action": "logged", **ranks})
        if g["verdict"] == "FAIL":
            for seg in g.get("fail_segments", []):
                queue.append({"candidate_id": cid, **seg, "gate_level": "FAIL", "action": fail_action, **ranks})
            codes = [c for c in g["fail_codes"] if c in structural]
            if codes:
                incidents.append({"candidate_id": cid, "codes": codes, "action": fail_action,
                                  "segments": list(g.get("incident_segments", []))})
    counts = {v: sum(x["verdict"] == v for x in results.values()) for v in VERDICTS}
    fail_ids = [cid for cid, x in results.items() if x["verdict"] == "FAIL"]
    active = "preference" if out["preference"] is not None else "baseline"
    info = {"mode": mode, "counts": counts, "would_remove": fail_ids, "removed": [], "stage_b_removed": [],
            "stage_b_would_remove": [], "review_queue": queue, "incidents": incidents, "results": results}
    if mode == "shadow":
        info["stage_b_would_remove"] = [r["candidate_id"] for r in (out[active] or [])[:top_k] if stage_b(r)]
        out["usability"] = info
        return out

    by_id = {r["candidate_id"]: r for r in out["pool"]}
    # FAIL은 이미 dedupe된 순위표가 아니라 유효 후보 전체에서 빼고 rank(dedupe)를 처음부터 다시 한다. 순위표에서 지우기만
    # 하면, FAIL 경로와 60 % 넘게 겹쳐 중복으로 지워졌던 안전한 경로가 돌아오지 못해 TOP3가 줄어든다.
    if fail_ids:
        for cid in fail_ids:
            by_id[cid]["invalid_reason"] = "usability_gate:" + ";".join(results[cid]["fail_codes"])
        valid = [r for r in valid if r["candidate_id"] not in set(fail_ids)]
        info["removed"] = fail_ids
        _rerank(out, valid, rank)
    while True:  # Stage B: re-check the TOP-k payload; refill only on failure
        bad = [(r["candidate_id"], codes) for r in (out[active] or [])[:top_k] if (codes := stage_b(r))]
        if not bad:
            break
        for cid, codes in bad:
            by_id[cid]["invalid_reason"] = "usability_stage_b:" + ";".join(codes)
            info["stage_b_removed"].append(cid)
            info["incidents"].append({"candidate_id": cid, "codes": list(codes), "action": "candidate_removed",
                                      "stage": "B", "segments": []})
        drop = {cid for cid, _ in bad}
        valid = [r for r in valid if r["candidate_id"] not in drop]
        _rerank(out, valid, rank)
    if not valid and (fail_ids or info["stage_b_removed"]):
        out["issues"].append({"code": ALL_FAILED_CODE, "blocking": True,
                              "message": "모든 후보가 사용성 검사(Usability Gate)를 통과하지 못했습니다."})
    out["usability"] = info
    return out
