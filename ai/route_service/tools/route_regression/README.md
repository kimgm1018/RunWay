# Route regression (golden)

Use this to check that a code change did **not** change any recommendation. It starts an app in-process, sends fixed requests, and compares everything byte for byte with the stored baseline. Compared artifacts: HTTP responses, the pipeline `out` dicts, and Gate log lines. Timing keys are ignored.

Run every command from `ai/route_service` with the Route venv (`requirements.txt` + `constraints.txt`) and `RUNWAY_DATA_DIR` set to the data root.

Two apps (S15P31E105-381):
- `--app demo`: the retired demo `route_demo/app_runway.py` (`POST /api/recommend`), loaded from `--demo-dir`, a folder that holds `route_demo/` (e.g. `git archive 368963c ai/workspace/seongyun/route/route_demo | tar -x --strip-components=4`). The stored baseline was captured with it, so **engine identity** = `--app demo` + `compare.py`.
- `--app service` (capture.py default): this service (`POST /internal/v1/routes/recommendations`). **Service identity** = `service_identity.py`: the service response must equal the demo response mapped to the BE contract (slim success body / `{code, message, details}` errors; with `--with-debug` the full demo body minus elevation fields; see its docstring); `out` dicts and Gate log lines must be identical. Use `--env ROUTE_WARMUP=0` for a strict `out` comparison (the warm-up request fills the graph LRU and flips `from_cache`; with warm-up use `--warm`).

## Files
| file | role |
|---|---|
| `run_regression.py` | one command: capture each mode, then compare it with `baseline/<mode>` |
| `capture.py` | capture one mode into a new directory |
| `compare.py` | compare two capture directories (strict unless `--known`) |
| `service_identity.py` | compare a service capture with a demo capture / the baseline (fields the service does not send removed) |
| `scenarios.json` | 43 fixed requests (LOOP / OAB / P2P, preferences, edge cases) + debug calls; `subsets` = the requests of the fastoff / shadow / noenvcache modes |
| `scenarios_p2p_random.json` | 30 random P2P requests (seed 20261028) |
| `known_differences.json` | the one approved internal difference (below) |
| `baseline/{main,fastoff,shadow,noenvcache,random}` | stored golden outputs (~30 MB, **not in git**: coordinates, provenance review pending). Captured 2026-10-28 on Windows with the demo app. Pass its location with `--baseline`; do not overwrite it |
| `runs/` | your captures (git-ignored) |

## Modes
| mode | how the app runs | requests |
|---|---|---|
| `main` | default | 43 + debug |
| `fastoff` | `RUNWAY_FAST_GRAPH=0` | 5 |
| `shadow` | `RUNWAY_USABILITY_GATE=shadow` | 5 |
| `noenvcache` | env edge cache treated as missing | 5 |
| `random` | default, random P2P file | 30 |

## Commands
```bash
# all modes, with the approved known difference (normal check after any change, ~8 min)
python -B tools/route_regression/run_regression.py --tag mychange --app demo --demo-dir <demo copy> --baseline <baseline dir>

# the service on the same scenarios, compared with the baseline minus the fields it does not send
python -B tools/route_regression/run_regression.py --tag svc --app service --env ROUTE_WARMUP=0 --baseline <baseline dir>
python -B tools/route_regression/service_identity.py tools/route_regression/runs/mychange_main tools/route_regression/runs/svc_main

# strict: no known differences allowed (shadow will report GS-26 as a failure; that is expected)
python -B tools/route_regression/run_regression.py --tag mychange_strict --strict

# only some modes
python -B tools/route_regression/run_regression.py --tag quick --modes main random

# rollback: P2P substrate off (must be identical to the baseline even in strict mode)
python -B tools/route_regression/run_regression.py --tag sub0 --env RUNWAY_P2P_SUBSTRATE=0 --strict

# rollback: shortest path through networkx instead of D-exact
python -B tools/route_regression/run_regression.py --tag spnx --env RUNWAY_SP_KERNEL=nx

# low level: one capture, one comparison
python -B tools/route_regression/capture.py --mode shadow --out tools/route_regression/runs/x_shadow
python -B tools/route_regression/compare.py tools/route_regression/baseline/shadow tools/route_regression/runs/x_shadow --known tools/route_regression/known_differences.json
```
Use a new `--tag` each time; capture refuses an existing output directory. The modes run one after another, and each app process takes about 2.5 GB.

## Pass criterion
- `RESULT PASS`: every mode prints `"fails": 0`.
- With known differences (default), the shadow mode lists **exactly one** entry: `p2p-substrate-gs26-from-cache`. Every other mode lists none.
- With `RUNWAY_P2P_SUBSTRATE=0 --strict`, every mode is 0.

### The one known difference (GS-26)
In shadow mode, `GS-26 out.json $[0].canonical.graph.from_cache` is `false` in the baseline and `true` now. This is not a functional difference:
- Before the P2P substrate patch, the P2P request GS-14 built two 8.5 km networkx graphs. They pushed the centum graph that GS-09 had cached out of the generator's 4-entry LRU, so GS-26 rebuilt it.
- The substrate no longer builds those graphs, so GS-26 now reuses the cached graph. The content is identical.
- Response, route, TOP3 and Gate log are identical.
- `compare.py --known` accepts it only at that exact mode / scenario / path / value, and only when nothing else differs.
- `from_cache` is never ignored in general.

## When the baseline must change
Only for an intended change of results (a new Gate version, a new scoring rule, new data). Then:
1. Capture the new baseline with the approved code.
2. Review the diff against the old one.
3. Record the decision.

This is a product decision, not a test fix.
