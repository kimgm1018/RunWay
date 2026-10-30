"""Route regression in one command: capture every mode with the current code and compare it with the baseline.

    python -B tools/route_regression/run_regression.py --tag <name> [--modes main fastoff shadow noenvcache random]
                                                       [--env KEY=VALUE ...] [--strict] [--port 8041]

  --tag      run name; outputs go to tools/route_regression/runs/<tag>_<mode> (must not exist yet)
  --modes    default: all five. "random" = 30 random P2P requests (scenarios_p2p_random.json) in the main mode
  --env      extra environment for the captured app, e.g. RUNWAY_P2P_SUBSTRATE=0 or RUNWAY_SP_KERNEL=nx (rollbacks)
  --strict   compare without known_differences.json (default: with it)
  --baseline baseline directory (default: tools/route_regression/baseline, one sub-directory per mode)

Pass criterion: every mode "fails": 0. With known differences on, the shadow mode lists exactly one known difference
(GS-26 canonical.graph.from_cache, see known_differences.json); with RUNWAY_P2P_SUBSTRATE=0 it lists none.
Each mode runs in its own process, one after another (the app takes ~2.5 GB). Exit code 0 only when every mode passes.
"""
import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
MODES = ["main", "fastoff", "shadow", "noenvcache", "random"]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--tag", required=True)
    ap.add_argument("--modes", nargs="+", default=MODES, choices=MODES)
    ap.add_argument("--env", nargs="*", default=[], metavar="KEY=VALUE")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--port", type=int, default=8041)
    ap.add_argument("--baseline", default=str(HERE / "baseline"))
    ap.add_argument("--runs", default=str(HERE / "runs"))
    a = ap.parse_args()
    env = dict(os.environ)
    for kv in a.env:
        k, _, v = kv.partition("=")
        env[k] = v
    runs = Path(a.runs)
    runs.mkdir(parents=True, exist_ok=True)
    summary, ok = [], True
    for m in a.modes:
        out = runs / f"{a.tag}_{m}"
        cmd = [sys.executable, "-B", str(HERE / "capture.py"), "--mode", "main" if m == "random" else m,
               "--out", str(out), "--port", str(a.port)]
        if m == "random":
            cmd += ["--scenarios", str(HERE / "scenarios_p2p_random.json")]
        print(f"== capture {m} -> {out}", flush=True)
        with open(runs / f"{a.tag}_{m}.log", "w", encoding="utf-8") as log:
            rc = subprocess.run(cmd, env=env, stdout=log, stderr=subprocess.STDOUT).returncode
        if rc != 0:
            print(f"   CAPTURE FAILED (see {runs / f'{a.tag}_{m}.log'})")
            summary.append({"mode": m, "capture": "FAILED"})
            ok = False
            continue
        cmp = [sys.executable, "-B", str(HERE / "compare.py"), str(Path(a.baseline) / m), str(out)]
        if not a.strict:
            cmp += ["--known", str(HERE / "known_differences.json")]
        r = subprocess.run(cmp, capture_output=True, text=True, encoding="utf-8")
        print("   " + r.stdout.strip().replace("\n", "\n   "), flush=True)
        head = json.loads(r.stdout.splitlines()[0])
        summary.append({"mode": m, "fails": head["fails"], "known": len(head.get("known_differences", []))})
        ok &= r.returncode == 0
    print("SUMMARY", json.dumps({"tag": a.tag, "env": a.env, "strict": a.strict, "modes": summary}), flush=True)
    print("RESULT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
