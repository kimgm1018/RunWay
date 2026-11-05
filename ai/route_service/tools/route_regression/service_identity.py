"""Service identity: a Route service capture (capture.py --app service) against a demo capture or the stored baseline.

    python -B tools/route_regression/service_identity.py <A: demo capture / baseline/<mode>> <B: service capture>
                                                         [--with-debug] [--warm] [--known known_differences.json]
                                                         -> exit 0 iff every scenario matches

For every scenario of B the service response must equal the demo response mapped to the service contract (BE Route
internal contract, MR !183), written out here on purpose, independent of app/main.py:
  success, default      {"routes": [{rank, coords, distance_m, summary, reasons, caveats, score, score_terms}],
                         "notices", "next_seed"} taken from the demo response, HTTP 200
  success, --with-debug (B ran with ROUTE_DEBUG=1) the whole demo response minus the elevation fields:
                         routes[*].elevation_profile_m; routes[*].features elevation_available, elevation_note,
                         elevation_gain_m, elevation_loss_m, elevation_min_m, elevation_max_m, avg_grade_pct,
                         max_grade_pct, steep_segment_ratio, gain_per_km, profile_m; routes[*].details rows
                         labelled 누적 상승 / 평균 경사
  error                 demo {"ok": false, "error": {code, message}, [min_target_km, alternatives_from_km], [debug]}
                         -> {"code", "message", "details"} with HTTP STATUS[code]; DESTINATION_TOO_FAR carries
                         min_target_km / alternatives_from_km in details, otherwise details is null; debug kept
                         only with --with-debug
Timing keys (compare.TIMING) are removed; key order is compared too (byte compare after the projection).
Request-format errors: the demo answered FastAPI's 422 {"detail": ...}; the service answers 400 VALIDATION_ERROR.
Such a pair is reported under validation_mapped, not failed.
The pipeline `out` dicts and Usability Gate log lines must be identical as compare.py checks them. With --warm (B ran
with the start-up warm-up request) the graph-cache flag `from_cache` is masked in `out` (the warm-up fills the LRU;
content is identical). --known applies compare.py's approved known differences to `out` (e.g. GS-26 shadow
against the stored baseline). Demo-only debug calls (/api/debug/network) and status files are not compared.
"""
import json
import sys
from pathlib import Path

from compare import dump, first_diff, is_known, known_for, strip

DROP_FEATURES = {"elevation_available", "elevation_note", "elevation_gain_m", "elevation_loss_m", "elevation_min_m",
                 "elevation_max_m", "avg_grade_pct", "max_grade_pct", "steep_segment_ratio", "gain_per_km", "profile_m"}
DROP_DETAILS = {"누적 상승", "평균 경사"}
SLIM_ROUTE = ("rank", "coords", "distance_m", "summary", "reasons", "caveats", "score", "score_terms")
STATUS = {"DISTANCE_RANGE": 422, "DESTINATION_REQUIRED": 422, "OUT_OF_APP_RANGE": 422, "OUT_OF_AREA": 422,
          "NO_ROAD_NEARBY": 422, "DESTINATION_TOO_FAR": 422, "END_SNAP_PE1": 422, "END_SNAP_PE2": 422,
          "END_SNAP_PE4": 422, "END_SNAP_PE5": 422, "USABILITY_GATE_ALL_FAILED": 422, "NO_ROUTE": 422,
          "NOT_READY": 503, "UNAVAILABLE": 503, "INTERNAL": 500, "SAFETY_CHECK": 500,
          "SNAP_NODE_NOT_IN_GENERATION_GRAPH": 500}


def project(resp: dict, keep_debug: bool) -> dict:
    """The demo response as the service would send it."""
    r = {k: v for k, v in resp.items() if keep_debug or k != "debug"}
    if isinstance(r.get("routes"), list):
        routes = []
        for x in r["routes"]:
            x = {k: v for k, v in x.items() if k != "elevation_profile_m"}
            x["features"] = {k: v for k, v in x["features"].items() if k not in DROP_FEATURES}
            x["details"] = [d for d in x["details"] if d["label"] not in DROP_DETAILS]
            routes.append(x)
        r["routes"] = routes
    return r


def expected(resp: dict, with_debug: bool) -> tuple[int, dict]:
    """(HTTP status, body) the service must answer for this demo response."""
    if resp.get("ok") is False:
        code = resp["error"]["code"]
        details = ({"min_target_km": resp["min_target_km"], "alternatives_from_km": resp["alternatives_from_km"]}
                   if code == "DESTINATION_TOO_FAR" else None)
        body = {"code": code, "message": resp["error"]["message"], "details": details}
        if with_debug and "debug" in resp:
            body["debug"] = resp["debug"]
        return STATUS[code], body
    if with_debug:
        return 200, project(resp, keep_debug=True)
    return 200, {"routes": [{k: x[k] for k in SLIM_ROUTE} for x in resp["routes"]], "notices": resp["notices"],
                 "next_seed": resp["next_seed"]}


def mask_from_cache(o):
    if isinstance(o, dict):
        return {k: (None if k == "from_cache" else mask_from_cache(v)) for k, v in o.items()}
    if isinstance(o, list):
        return [mask_from_cache(v) for v in o]
    return o


def main() -> int:
    args = sys.argv[1:]
    with_debug, warm = "--with-debug" in args, "--warm" in args
    kpath = args[args.index("--known") + 1] if "--known" in args else None
    A, B = (Path(x) for x in args if not x.startswith("--") and x != kpath)
    known = known_for(A, B, kpath)
    ia = {x["id"]: x for x in json.loads((A / "meta.json").read_text())["items"]}
    ib = {x["id"]: x for x in json.loads((B / "meta.json").read_text())["items"]}
    fails, info = [], {"compared": 0, "validation_mapped": [], "not_in_service": sorted(set(ia) - set(ib)),
                       "responses_identical": 0, "out_identical": 0, "gate_identical": 0, "known_differences": []}
    if set(ib) - set(ia):
        fails.append(("extra scenarios in B", sorted(set(ib) - set(ia))))
    for sid in ib:
        if sid not in ia:
            continue
        info["compared"] += 1
        ra = json.loads((A / f"{sid}.resp.json").read_text(encoding="utf-8"))
        rb = json.loads((B / f"{sid}.resp.json").read_text(encoding="utf-8"))
        ha, hb = ia[sid]["http"], ib[sid]["http"]
        if ha == 422 and hb == 400 and "detail" in ra and rb.get("code") == "VALIDATION_ERROR":
            info["validation_mapped"].append(sid)
            continue_resp = False
        else:
            want_http, want = expected(ra, with_debug)
            continue_resp = True
        if continue_resp and want_http != hb:
            fails.append((sid, "http", ha, want_http, hb))
        elif continue_resp:
            pa, pb = strip(want), strip(rb)
            if dump(pa) != dump(pb):
                fails.append((sid, "resp.json", first_diff(pa, pb)))
            else:
                info["responses_identical"] += 1
        for kind in ("out.json", "gate.jsonl"):
            fa, fb = A / f"{sid}.{kind}", B / f"{sid}.{kind}"
            if not fa.exists() and not fb.exists():
                continue
            if kind == "gate.jsonl":
                la = [dump(strip(json.loads(x))) for x in fa.read_text(encoding="utf-8").splitlines()]
                lb = [dump(strip(json.loads(x))) for x in fb.read_text(encoding="utf-8").splitlines()]
                if la != lb:
                    fails.append((sid, kind, len(la), len(lb)))
                else:
                    info["gate_identical"] += 1
                continue
            oa = strip(json.loads(fa.read_text(encoding="utf-8")))
            ob = strip(json.loads(fb.read_text(encoding="utf-8")))
            if warm:
                oa, ob = mask_from_cache(oa), mask_from_cache(ob)
            if dump(oa, True) != dump(ob, True):
                kid = is_known(sid, kind, oa, ob, known)
                if kid:
                    info["known_differences"].append((kid, sid, kind, first_diff(oa, ob)))
                else:
                    fails.append((sid, kind, first_diff(oa, ob)))
            else:
                info["out_identical"] += 1
    print(json.dumps({"A": A.name, "B": B.name, "fails": len(fails), "with_debug": with_debug, "warm": warm, **info},
                     ensure_ascii=False))
    for f in fails[:40]:
        print("FAIL", f)
    return 1 if fails else 0


if __name__ == "__main__":
    sys.exit(main())
