"""RunWay course recommendation demo (one screen, app style).

Start + target distance + checked conditions -> runway_routing.pipeline.RoutePipeline (canonical generator with the
optional weak preference bias, rule-based scorer, Usability Gate) -> TOP3 with plain-language reasons. Nothing is read from stored courses:
every request generates; "다른 코스 추천" moves to the next seed block.

Checkbox ON = that condition counts (preference 5 / avoidance 5 / difficulty "flat").
Checkbox OFF = not considered (never the opposite preference).

Course shape (IMPL-1): "loop" (default, the unchanged LOOP pipeline), "out_and_back" (반환점 왕복) or "point_to_point"
(편도 A: the user picks the destination; target distance +-10 %, too far -> "최소 N km" guidance, no route).
Every shape passes the Usability Gate (runway_routing.usability_gate, frozen ug-v1 / ug-v2): FAIL candidates are removed
before ranking; REVIEW findings are never sent to the browser (not even in debug) -- they go to the server-side JSONL
log under RUNWAY_USABILITY_LOG_DIR (default reports/_usability_gate_log/) for manual review.

Run from the RunWay root (venv with osmium 4.3.2 + route_demo/requirements.txt):
    python -m uvicorn route_demo.app_runway:app --host 127.0.0.1 --port 8002
Open http://localhost:8002
"""
import json
import math
import os
import sys
import threading
import time
import traceback
from contextlib import asynccontextmanager
from datetime import datetime
from pathlib import Path
from typing import Literal, Optional

import numpy as np
import shapely
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, Field
from shapely.geometry import mapping
from shapely.ops import linemerge

from runway_routing.data import EXCLUDED, REGIONS, ROOT, RUNNABLE, UNCERTAIN
from runway_routing.explain import ENV_KEYS as SHAPE_ENV_KEYS, FILTER_LABEL, details, explain, explain_shape
from runway_routing.scorer import Preferences
from runway_routing.snap import to_utm

HERE = Path(__file__).resolve().parent
DEFAULT_START = ("gwangalli", REGIONS["gwangalli"].center)
QUICK_STARTS = [("gwangalli", "광안리"), ("haeundae", "해운대"), ("centum", "수영강·센텀"),
                ("citizenpark", "시민공원"), ("hwangnyeongsan", "황령산")]
ATTEMPTS = 24            # one seed block; "다른 코스 추천" -> seed + ATTEMPTS (no attempt seed reused)
TOP_K = 3
MIN_KM, MAX_KM = 1.0, 15.0
MAX_SNAP_M = 250         # = canonical's start_far_from_network warning (runway_busan_graph.WORK_BUFFER_M)
NO_ROAD_MESSAGE = "고른 위치 주변에 달릴 수 있는 길이 없어요 (바다나 산속일 수 있어요). 길 가까이를 눌러 주세요."
ENV_FILTERS = ["river", "beach", "park", "trail"]
FEATURE_OF = {"river": "river_ratio", "beach": "coastal_ratio", "park": "green_ratio", "trail": "trail_ratio"}
STATE: dict = {"pipeline": None, "error": None, "loading": True}
GATE_MODE = os.environ.get("RUNWAY_USABILITY_GATE", "enforce")   # "shadow" = record only (emergency fallback)
USABILITY_LOG_DIR = Path(os.environ.get("RUNWAY_USABILITY_LOG_DIR") or ROOT / "reports" / "_usability_gate_log")
END_SNAP_MESSAGE = "도착 위치 근처에서 안전하게 달릴 수 있는 길을 찾지 못했어요. 도착 위치를 길 가까이로 옮겨 주세요."
SHAPE_FAIL = {  # blocking issue code of the new shapes -> user message (codes are kept as they are)
    "OUT_OF_APP_RANGE": "현재 앱 범위를 벗어난 목적지입니다. 15 km 안쪽의 도착 위치를 골라 주세요.",
    "END_SNAP_PE1": END_SNAP_MESSAGE, "END_SNAP_PE2": END_SNAP_MESSAGE, "END_SNAP_PE4": END_SNAP_MESSAGE,
    "END_SNAP_PE5": END_SNAP_MESSAGE,
    "SNAP_NODE_NOT_IN_GENERATION_GRAPH": "코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.",
}


def _load():
    try:
        # The whole recommendation flow is runway_routing/pipeline.py. Env distances come from the precomputed edge
        # cache and the per-request graph from the fast builder (same graph as canonical); each falls back to the
        # canonical computation by itself (no valid cache / failed self-test). RUNWAY_FAST_GRAPH=0 forces canonical's
        # graph builder.
        from runway_routing.pipeline import RoutePipeline
        t0 = time.perf_counter()
        STATE["pipeline"] = RoutePipeline("wide", mode=GATE_MODE, fast=os.environ.get("RUNWAY_FAST_GRAPH", "1") != "0")
        STATE["load_s"] = round(time.perf_counter() - t0, 1)
    except Exception as exc:  # shown as "준비 실패" with the cause in debug
        STATE["error"] = f"{type(exc).__name__}: {exc}"
        traceback.print_exc()
    finally:
        STATE["loading"] = False


@asynccontextmanager
async def lifespan(_app):
    threading.Thread(target=_load, daemon=True).start()  # the page loads while the extract is read
    yield


app = FastAPI(title="RunWay 코스 추천", lifespan=lifespan)
app.add_middleware(GZipMiddleware, minimum_size=1000)
app.mount("/static", StaticFiles(directory=HERE / "static"), name="static")
templates = Jinja2Templates(directory=HERE / "templates")


@app.get("/", response_class=HTMLResponse)
def index(request: Request):
    return templates.TemplateResponse(request, "runway.html", {})


@app.get("/api/status")
def status():
    p = STATE["pipeline"]
    st = p.status() if p else {}
    return {"ready": p is not None, "loading": STATE["loading"], "error": STATE["error"],
            "default_start": {"key": DEFAULT_START[0], "label": REGIONS[DEFAULT_START[0]].label,
                              "lat": DEFAULT_START[1][0], "lon": DEFAULT_START[1][1]},
            "quick_starts": [{"key": k, "label": lab, "lat": REGIONS[k].center[0], "lon": REGIONS[k].center[1]}
                             for k, lab in QUICK_STARTS],
            "env_extent_wsen": st.get("env_extent_wsen"), "extract": st.get("extract"), "dem": st.get("dem"),
            "env_cache": st.get("env_cache"), "graph_builder": st.get("graph_builder"),
            "running_suitability": ({"version": p.rs_cfg["version"], "weight": p.rs_weight} if p else None),
            "load_s": STATE.get("load_s")}


class Filters(BaseModel):
    river: bool = False
    beach: bool = False
    park: bool = False
    trail: bool = False
    pedestrian: bool = False
    avoid_major_road: bool = False
    avoid_steps: bool = False
    avoid_tunnel: bool = False
    flat: bool = False


class RecommendRequest(BaseModel):
    lat: float
    lon: float
    distance_km: float = Field(5.0)
    filters: Filters = Filters()
    seed: int = Field(1, ge=1, le=10_000_000)
    shape: Literal["loop", "out_and_back", "point_to_point"] = "loop"
    end_lat: Optional[float] = None     # point_to_point destination
    end_lon: Optional[float] = None


def _prefs(f: Filters) -> Preferences:
    d = {k: 5 for k in ("river", "beach", "park", "trail", "pedestrian", "avoid_major_road", "avoid_steps", "avoid_tunnel")
         if getattr(f, k)}
    return Preferences.from_dict({**d, "difficulty": "flat" if f.flat else "any"})


def _fail(code: str, message: str, status: int = 200, **extra):
    return JSONResponse({"ok": False, "error": {"code": code, "message": message}, **extra}, status_code=status)


def _notices(out: dict, filters: dict, routes: list, target_m: float) -> list:
    """User-facing notes from pipeline issues and the result (no developer terms)."""
    notes = []
    shape = out.get("shape") or {}   # only the new shapes carry it; LOOP reads canonical's start as before
    start = (out.get("canonical") or {}).get("start") or shape.get("start") or {}
    if start.get("snap_node_dist_m", 0) > 60:
        notes.append(f"고른 위치에서 가장 가까운 달릴 수 있는 길까지 {round(start['snap_node_dist_m'])} m 떨어져 있어서, 그 길에서 출발해요.")
    if start.get("shift_to_main_m"):
        notes.append(f"고른 위치 바로 옆 길은 주변 길과 이어지지 않아서, {round(start['shift_to_main_m'])} m 떨어진 연결된 길에서 출발해요.")
    end = shape.get("end") or {}
    if (end.get("snap_m") or 0) > 60:
        notes.append(f"도착 위치에서 가장 가까운 달릴 수 있는 길까지 {round(end['snap_m'])} m 떨어져 있어서, 그 길에서 끝나요.")
    codes = {i["code"] for i in out["issues"]}
    if "ENV_LAYER_PARTIAL" in codes or "ENV_LAYER_FALLBACK" in codes:
        notes.append("이 주변은 강·바다·공원 정보가 일부만 있어서, 환경 조건 판단이 덜 정확할 수 있어요.")
    # new shapes outside the env layer: explain.explain_shape says "not judged" per route, so no "거의 없어요" here
    env_judged = not shape or all(_env_covered(r["features"]) >= 1.0 for r in routes)
    for k in ENV_FILTERS:
        if k in SHAPE_ENV_KEYS and not env_judged:
            continue
        if filters.get(k) and routes and all((r["features"].get(FEATURE_OF[k]) or 0) < 0.05 for r in routes):
            notes.append(f"이 주변에는 {FILTER_LABEL[k]} 구간이 거의 없어요. 나머지 조건으로 추천했어요.")
    if 0 < len(routes) < TOP_K:
        notes.append(f"조건에 맞는 서로 다른 코스를 {len(routes)}개만 찾았어요. 거리나 출발 위치를 바꾸면 더 나올 수 있어요.")
    return notes


@app.post("/api/recommend")
def recommend(req: RecommendRequest):
    p = STATE["pipeline"]
    if p is None:
        if STATE["loading"]:
            return _fail("NOT_READY", "추천 엔진을 준비하는 중이에요. 잠시 후 다시 눌러 주세요.", 503)
        return _fail("UNAVAILABLE", "추천 엔진을 시작하지 못했어요. 개발자에게 알려 주세요.", 503, debug=STATE["error"])
    if not (MIN_KM <= req.distance_km <= MAX_KM):
        return _fail("DISTANCE_RANGE", f"거리는 {MIN_KM:g}~{MAX_KM:g} km 사이로 정해 주세요.")
    if req.shape == "point_to_point" and (req.end_lat is None or req.end_lon is None):
        return _fail("DESTINATION_REQUIRED", "편도 코스는 도착 위치를 정해 주세요.")
    if req.shape == "point_to_point" and _straight_m(req) > _p2p_out_of_range_m(p):
        return _fail("OUT_OF_APP_RANGE", SHAPE_FAIL["OUT_OF_APP_RANGE"])
    loop = req.shape == "loop"
    target_m = round(req.distance_km * 1000)
    filters = req.filters.model_dump()
    prefs = _prefs(req.filters)
    t0 = time.perf_counter()
    # LOOP passes no shape argument at all: RoutePipeline.run(shape=None) -> the LOOP path, unchanged since before IMPL-1
    shape_kw = {} if loop else {"shape": req.shape, "end_lat": req.end_lat, "end_lon": req.end_lon}
    try:
        with p.lock:
            out = p.run(req.lat, req.lon, target_m, seed=req.seed, attempts=ATTEMPTS, prefs=prefs, **shape_kw)
            if loop:
                cg = p.graph(req.lat, req.lon, target_m) if out["canonical"] is not None else None
            else:
                centre = out["shape"].get("graph_centre")   # OAB: the start; P2P: the snapped s-t midpoint
                cg = p.graph(centre["lat"], centre["lon"], target_m) if centre else None
            _log_usability(req, out)
    except Exception as exc:
        if type(exc).__name__ == "InsufficientResponseError":  # osmnx: no road at all in the working disk
            return _fail("NO_ROAD_NEARBY", NO_ROAD_MESSAGE, debug=f"{type(exc).__name__}: {exc}")
        traceback.print_exc()
        return _fail("INTERNAL", "코스를 만드는 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.", 500,
                     debug=f"{type(exc).__name__}: {exc}")
    codes = {i["code"] for i in out["issues"]}
    info = out.get("shape") or {}
    if loop:
        debug = {"seed": req.seed, "attempts": ATTEMPTS, "counts": out["counts"], "graph": out["graph"],
                 "issues": out["issues"], "generation_bias": out["request"].get("generation_bias"),
                 "canonical_timings_s": (out.get("canonical") or {}).get("timings_s"),
                 "running_suitability": out.get("running_suitability"), "preferences": prefs.__dict__}
    else:
        debug = _shape_debug(req, out, prefs)
    if "OUTSIDE_CANONICAL_EXTRACT" in codes:
        return _fail("OUT_OF_AREA", "현재 위치는 아직 추천 지역(부산) 밖이에요. 지도에서 부산 안의 출발 위치를 골라 주세요.",
                     debug=debug)
    snap_m = out["canonical"]["start"]["snap_node_dist_m"] if loop else (info.get("start") or {}).get("snap_node_dist_m", 0)
    if snap_m > MAX_SNAP_M:
        return _fail("NO_ROAD_NEARBY", f"고른 위치에서 달릴 수 있는 길까지 {round(snap_m)} m나 떨어져 있어요. "
                     "길 가까이를 눌러 출발 위치를 다시 골라 주세요.", debug=debug)
    if "DESTINATION_TOO_FAR" in codes:   # user decision 3: no route, show the minimum target instead
        i = next(i for i in out["issues"] if i["code"] == "DESTINATION_TOO_FAR")
        return _fail("DESTINATION_TOO_FAR", f"이 목적지까지는 최소 {i['min_target_km']:g} km가 필요합니다.",
                     min_target_km=i["min_target_km"], alternatives_from_km=i["alternatives_from_km"], debug=debug)
    for code, message in SHAPE_FAIL.items():
        if code in codes:
            return _fail(code, message, debug=debug)
    if "FORBIDDEN_EDGE_USED" in codes:  # safety net; never seen in tests
        return _fail("SAFETY_CHECK", "안전 확인을 통과하지 못한 길이 섞여 있어 추천을 멈췄어요.", debug=debug)
    ranked = (out["preference"] if out["preference"] is not None else out["baseline"])[:TOP_K]
    if not ranked:
        if "USABILITY_GATE_ALL_FAILED" in codes:
            return _fail("USABILITY_GATE_ALL_FAILED", "이 위치와 거리로는 안전 기준을 통과한 코스를 찾지 못했어요. "
                         "거리나 출발 위치를 바꿔 보세요.", debug=debug)
        return _fail("NO_ROUTE", "이 위치와 거리로는 코스를 만들지 못했어요. 거리를 바꾸거나 큰길·공원 근처로 출발 위치를 옮겨 보세요.",
                     debug=debug)
    mode = "preference" if out["preference"] is not None else "baseline"
    routes = []
    for rank, r in enumerate(ranked, 1):
        f = r["features"]
        ex = explain(f, filters) if loop else explain_shape(f, filters, req.shape, info)
        keys =[f"{min(a, b)}-{max(a, b)}" for a, b in zip(cg.redges["osm_u"].to_numpy()[r["eids"]],
                                                           cg.redges["osm_v"].to_numpy()[r["eids"]])]
        route = {"rank": rank, "distance_m": f["distance_m"], "distance_km": round(f["distance_m"] / 1000, 2),
                 "error_pct": f["distance_error_pct"], "summary": ex["summary"], "reasons": ex["reasons"],
                 "caveats": ex["caveats"], "details": details(f, target_m), "coords": r["coords"],
                 "edges": [[k, round(float(x), 1)] for k, x in zip(keys, cg.ea["length"][r["eids"]])],
                 "elevation_profile_m": f.get("profile_m"), "features": f,
                 "score": r[f"{mode}_score"]["score"], "score_terms": r[f"{mode}_score"]["terms"],
                 "candidate_id": r["candidate_id"]}
        if not loop:   # new shapes only: a LOOP route keeps exactly the fields it had
            route["shape_notes"] = ex["notes"]
        if req.shape == "out_and_back":   # a palindrome: the middle coordinate is the turnaround
            route["turnaround"] = r["coords"][(len(r["coords"]) - 1) // 2]
        routes.append(route)
    c = out["counts"]
    if loop:
        s = out["canonical"]["start"]
        start = {"lat": req.lat, "lon": req.lon, "node_lat": s["node_lat"], "node_lon": s["node_lon"],
                 "snap_m": s["snap_node_dist_m"]}
    else:   # every route starts at the one snapped start node
        start = {"lat": req.lat, "lon": req.lon, "node_lat": ranked[0]["coords"][0][0],
                 "node_lon": ranked[0]["coords"][0][1], "snap_m": info["start"]["snap_node_dist_m"]}
    res = {"ok": True, "seed": req.seed, "next_seed": req.seed + ATTEMPTS, "target_m": target_m,
           "filters": filters, "mode": mode, "start": start,
           "generation": {"attempts": c["attempts"] if loop else out["request"]["attempts"],
                          "generated": c["generated"], "distinct": c["distinct"] if loop else None,
                          "candidates": c["loop_valid"], "seconds": round(time.perf_counter() - t0, 1),
                          "preference_bias": out["request"].get("generation_bias") is not None},
           "routes": routes, "notices": _notices(out, filters, routes, target_m), "debug": debug}
    if not loop:   # a LOOP response keeps exactly the fields it had
        res["shape"] = req.shape
    if req.shape == "point_to_point":   # every route ends at the one snapped end node
        res["end"] = {"lat": req.end_lat, "lon": req.end_lon, "node_lat": ranked[0]["coords"][-1][0],
                      "node_lon": ranked[0]["coords"][-1][1], "snap_m": info["end"]["snap_m"]}
        res["return_trip"] = {"straight_m": round(info["return_straight_m"]),
                              "runnable_m": round(info["return_runnable_m"])}
    return res


def _straight_m(req: RecommendRequest) -> float:
    """Straight start-destination distance in UTM metres (the measure pipeline._shape records as straight_m)."""
    (sx, sy), (ex, ey) = to_utm(req.lon, req.lat), to_utm(req.end_lon, req.end_lat)
    return math.hypot(ex - sx, ey - sy)


def _p2p_out_of_range_m(p) -> float:
    """Above (1 + tol) x app max + 2 x snap max (= 17.0 km) every pair of snapped nodes is > (1 + tol) x app max apart,
    so the minimum target exceeds the app maximum: OUT_OF_APP_RANGE without snapping. The app-max snap disk (8.5 km
    around the midpoint) would otherwise miss the far end and answer END_SNAP / NO_ROAD_NEARBY instead (F-1).

    17 km 사전 거절 이유: 출발·도착이 각각 최대 250 m 옮겨져 snap되므로, 직선거리가 1.1 x 15 km + 2 x 250 m = 17.0 km를
    넘으면 어떤 snap 결과로도 15 km 코스를 만들 수 없다. 이때는 graph를 만들기 전에 "앱 범위 밖"으로 답한다.
    이 검사가 없으면 8.5 km app-max disk가 먼 쪽 끝을 담지 못해 엉뚱한 "근처에 길이 없음" 오류가 난다."""
    c = p.shape_cfg
    return (1 + c["tolerance"]["value"]) * c["app_km"]["max"] * 1000 + 2 * c["snap_max_m"]["value"]


def _env_covered(f: dict) -> float:
    v = f.get("env_layer_covered_ratio")
    return 1.0 if v is None else v   # same reading as explain.explain_shape


def _shape_debug(req: RecommendRequest, out: dict, prefs: Preferences) -> dict:
    """Debug block of the new shapes: whitelisted fields only (no pool, no geometry, no gate findings)."""
    info = out["shape"]
    return {"seed": req.seed, "attempts": ATTEMPTS, "shape": req.shape, "counts": out["counts"], "graph": out["graph"],
            "issues": [{k: i.get(k) for k in ("code", "message", "blocking")} for i in out["issues"]],
            "generation_bias": out["request"].get("generation_bias"), "preferences": prefs.__dict__,
            "shape_info": {k: info.get(k) for k in ("start_node", "end_node", "straight_m", "d_min_m", "d_min_disk",
                                                    "rule", "d_min_equal_on_generation_disk")}}


def _jsonable(o):
    return o.item() if hasattr(o, "item") else str(o)   # numpy scalars -> Python numbers


def _log_usability(req: RecommendRequest, out: dict) -> None:
    """Server-side review log, never sent to the browser: one JSON line per request with the gate's findings
    (REVIEW segments, FAIL removals, incidents). Runs under p.lock; a failed write never blocks the response."""
    u = out.get("usability")
    if u is None:
        return
    active = out["preference"] if out["preference"] is not None else out["baseline"]
    rec = {"ts": datetime.now().isoformat(timespec="seconds"), "request": req.model_dump(),
           "gate_version": u.get("gate_version"), "mode": u.get("mode"), "request_type": u.get("request_type"),
           "skipped": u.get("skipped"), "counts": u.get("counts"), "removed": u.get("removed", []),
           "stage_b_removed": u.get("stage_b_removed", []),
           "top3": [r["candidate_id"] for r in (active or [])[:TOP_K]],
           "review_queue": u.get("review_queue", []), "incidents": u.get("incidents", [])}
    try:
        USABILITY_LOG_DIR.mkdir(parents=True, exist_ok=True)
        with open(USABILITY_LOG_DIR / f"usability_gate_{rec['ts'][:10]}.jsonl", "a", encoding="utf-8") as fh:
            fh.write(json.dumps(rec, ensure_ascii=False, default=_jsonable) + "\n")
    except OSError as exc:
        print(f"usability log not written: {type(exc).__name__}: {exc}", file=sys.stderr)


def _nn(v):
    """JSON-safe tag value: NaN / None -> None."""
    return None if v is None or (isinstance(v, float) and np.isnan(v)) else v


@app.get("/api/debug/network")
def debug_network(lat: float, lon: float, distance_km: float = 5.0):
    """RUNNABLE / EXCLUDED / UNCERTAIN edges of the working disk a request at this start routes on."""
    p = STATE["pipeline"]
    if p is None:
        raise HTTPException(503, "not ready")
    with p.lock:
        try:
            cg = p.graph(lat, lon, round(distance_km * 1000))
        except Exception as exc:
            raise HTTPException(400, f"{type(exc).__name__}: {exc}")
    e = cg.edges_all
    feats = []
    for status in (RUNNABLE, EXCLUDED, UNCERTAIN):
        sub = e[e["runway_status"] == status]
        if status == RUNNABLE:  # one feature: the network itself
            lines = np.stack([np.c_[cg.lon[sub["u"]], cg.lat[sub["u"]]], np.c_[cg.lon[sub["v"]], cg.lat[sub["v"]]]], axis=1)
            geom = shapely.set_precision(shapely.multilinestrings(lines), 1e-6)
            feats.append({"type": "Feature", "geometry": mapping(geom), "properties": {"status": status}})
            continue
        for (osmid, reason), grp in sub.groupby(["osmid", "runway_reason"], dropna=False):
            lines = [[(cg.lon[u], cg.lat[u]), (cg.lon[v], cg.lat[v])] for u, v in zip(grp["u"], grp["v"])]
            geom = shapely.set_precision(linemerge(shapely.multilinestrings(lines)), 1e-6)
            r = grp.iloc[0]
            feats.append({"type": "Feature", "geometry": mapping(geom),
                          "properties": {"status": status, "osmid": int(osmid), "reason": _nn(reason),
                                         "highway": _nn(r["highway"]), "name": _nn(r["name"]),
                                         "length_m": round(float(grp["length"].sum()), 1)}})
    return {"type": "FeatureCollection", "features": feats}
