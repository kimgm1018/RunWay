"""Golden capture: run the real app on a scenario file and record everything the comparison needs.

    python -B tools/route_regression/capture.py --mode main|fastoff|shadow|noenvcache --out <dir> [--port 8013]
                                                [--scenarios tools/route_regression/scenarios.json]
                                                [--app service | --app demo --demo-dir <folder holding route_demo/>]

--app service (default): runs the Route service (app.main:app, POST /internal/v1/routes/recommendations) after
    GET /internal/v1/ready.
--app demo: runs the retired demo route_demo.app_runway:app (POST /api/recommend) from --demo-dir, e.g. extracted with
    git archive from the !180 commit. The stored baseline was captured with the demo, so the engine-identity check
    (compare.py against the baseline) uses --app demo; tools/route_regression/service_identity.py then compares a
    service capture with a demo capture.
The app runs with uvicorn in a thread of THIS process, is called over HTTP (stdlib only), and per scenario writes: <id>.resp.json (raw HTTP body), <id>.out.json (the pipeline `out` dicts, RoutePipeline.run wrapped on the
instance), <id>.gate.jsonl (the Usability Gate log lines that request produced), plus status_start/end.json (demo: /api/status;
service: /internal/v1/ready + RoutePipeline.status()) and meta.json (HTTP codes). The demo-only /api/debug/network calls
are skipped for the service. Production code is only imported, never modified.

Modes (each is how the production app is started, nothing else changes):
  main        default app (RUNWAY_FAST_GRAPH=1, RUNWAY_USABILITY_GATE=enforce, env edge cache valid)
  fastoff     RUNWAY_FAST_GRAPH=0  (canonical graph builder)
  shadow      RUNWAY_USABILITY_GATE=shadow
  noenvcache  the env edge cache loader reports "no cache" (distances computed per request)
Other rollback switches (RUNWAY_P2P_SUBSTRATE, RUNWAY_SP_KERNEL) are taken from the environment as the app takes them.
Paths are relative to this file: the repository root is two levels up. The output directory must not exist yet.
"""
import argparse
import ctypes
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path

sys.dont_write_bytecode = True
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def no_power_throttling() -> None:
    """Windows only: opt this process out of EcoQoS (background throttling slowed python 3-4x; timing only)."""
    if sys.platform != "win32":
        return
    class S(ctypes.Structure):
        _fields_ = [("Version", ctypes.c_ulong), ("ControlMask", ctypes.c_ulong), ("StateMask", ctypes.c_ulong)]
    s = S(1, 1, 0)
    k = ctypes.windll.kernel32
    k.SetProcessInformation(k.GetCurrentProcess(), 4, ctypes.byref(s), ctypes.sizeof(s))


def _default(o):
    if hasattr(o, "item"):
        return o.item()
    if hasattr(o, "tolist"):
        return o.tolist()
    if isinstance(o, (set, frozenset)):
        return sorted(o, key=str)
    return str(o)


def call(base, path, body=None):
    req = urllib.request.Request(base + path, data=None if body is None else json.dumps(body).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="GET" if body is None else "POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=1800) as r:
            code, raw = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, raw = e.code, e.read()
    return code, raw, round(time.perf_counter() - t0, 2)


def disable_env_cache() -> str:
    """noenvcache mode: make the env edge cache loader report 'no cache'."""
    import runway_routing.data as D
    D.EnvFeatureCache.load = classmethod(lambda c, env: (None, "golden: env cache disabled"))
    return "runway_routing.data"


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", default="main", choices=["main", "fastoff", "shadow", "noenvcache"])
    ap.add_argument("--out", required=True, help="new output directory")
    ap.add_argument("--port", type=int, default=8013)
    ap.add_argument("--scenarios", default=str(HERE / "scenarios.json"))
    ap.add_argument("--app", default="service", choices=["service", "demo"])
    ap.add_argument("--demo-dir", help="folder that contains route_demo/ (only with --app demo)")
    a = ap.parse_args()
    out = Path(a.out).resolve()
    scen_path = Path(a.scenarios).resolve()
    (out / "gatelog").mkdir(parents=True, exist_ok=False)
    no_power_throttling()
    os.environ["RUNWAY_USABILITY_LOG_DIR"] = str(out / "gatelog")
    if a.mode == "fastoff":
        os.environ["RUNWAY_FAST_GRAPH"] = "0"
    if a.mode == "shadow":
        os.environ["RUNWAY_USABILITY_GATE"] = "shadow"
    os.chdir(ROOT)
    sys.path.insert(0, str(ROOT))
    patched = disable_env_cache() if a.mode == "noenvcache" else None

    import uvicorn
    if a.app == "demo":
        if not a.demo_dir:
            raise SystemExit("--app demo needs --demo-dir")
        sys.path.insert(0, str(Path(a.demo_dir).resolve()))
        import route_demo.app_runway as A
        asgi, rec_path, status_path = A.app, "/api/recommend", "/api/status"
    else:
        import app.main as A
        asgi, rec_path, status_path = A.app, "/internal/v1/routes/recommendations", "/internal/v1/ready"

    spec = json.loads(scen_path.read_text(encoding="utf-8"))
    scen = spec["scenarios"]
    if a.mode != "main":
        keep = set(spec["subsets"][a.mode])
        scen = [s for s in scen if s["scenario_id"] in keep]

    server = uvicorn.Server(uvicorn.Config(asgi, host="127.0.0.1", port=a.port, log_level="warning"))
    th = threading.Thread(target=server.run, daemon=True)
    th.start()
    base = f"http://127.0.0.1:{a.port}"
    t0 = time.time()
    while True:
        try:
            code, raw, _ = call(base, status_path)
            st = json.loads(raw)
            if a.app == "service":
                st = {"ready": st.get("phase") == "ready", "error": st.get("phase") == "failed" and st}
            if st.get("ready") or st.get("error"):
                break
        except OSError:
            pass
        if time.time() - t0 > 900:
            raise SystemExit("not ready")
        time.sleep(1)
    if st.get("error"):
        (out / "status_start.json").write_bytes(raw)
        print("PIPELINE ERROR", st["error"])
        return 2
    p = A.STATE["pipeline"] if a.app == "demo" else A.app.state.engine.pipeline

    def status_bytes(raw: bytes) -> bytes:
        if a.app == "demo":
            return raw
        return json.dumps({"ready": json.loads(raw), "engine": p.status()}, ensure_ascii=False,
                          default=_default).encode("utf-8")

    (out / "status_start.json").write_bytes(status_bytes(raw))
    captured = []
    orig = p.run

    def run(*args, **kw):
        o = orig(*args, **kw)
        captured.append(json.dumps(o, ensure_ascii=False, default=_default))
        return o

    p.run = run

    def gate_lines():
        lines = []
        for f in sorted((out / "gatelog").glob("usability_gate_*.jsonl")):
            lines += [x for x in f.read_text(encoding="utf-8").splitlines() if x.strip()]
        return lines

    meta = {"mode": a.mode, "app": a.app, "patched": patched, "scenarios": scen_path.name,
            "ready_after_s": round(time.time() - t0, 1), "items": []}
    for s in scen:
        sid = s["scenario_id"]
        before, n0 = len(gate_lines()), len(captured)
        code, raw, dt = call(base, rec_path, s["request"])
        (out / f"{sid}.resp.json").write_bytes(raw)
        outs = captured[n0:]
        (out / f"{sid}.out.json").write_text("[" + ",".join(outs) + "]", encoding="utf-8")
        new = gate_lines()[before:]
        (out / f"{sid}.gate.jsonl").write_text("".join(x + "\n" for x in new), encoding="utf-8")
        meta["items"].append({"id": sid, "http": code, "elapsed_s": dt, "runs": len(outs), "gate_lines": len(new)})
        print(sid, code, f"{dt}s", f"runs={len(outs)}", f"gate+{len(new)}", flush=True)
    if a.mode == "main" and "debug" in spec and a.app == "demo":
        for d in spec["debug"]:
            code, raw, dt = call(base, d["path"])
            (out / f"{d['scenario_id']}.resp.json").write_bytes(raw)
            meta["items"].append({"id": d["scenario_id"], "http": code, "elapsed_s": dt})
            print(d["scenario_id"], code, f"{dt}s", flush=True)
    code, raw, _ = call(base, status_path)
    (out / "status_end.json").write_bytes(status_bytes(raw))
    (out / "meta.json").write_text(json.dumps(meta, indent=1), encoding="utf-8")
    server.should_exit = True
    th.join(timeout=30)
    print("DONE", out)
    return 0


if __name__ == "__main__":
    sys.exit(main())
