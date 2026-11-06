"""505 변경 전 dev(5b1ff6e) 응답 캡처. dev_responses.json을 만든 스크립트(참고용). 사용: python capture_dev.py <worktree> <out.json>"""
import json, sys
from datetime import timedelta
from pathlib import Path
wt = Path(sys.argv[1]); sys.path[:0] = [str(wt / "ai/service"), str(wt / "ai/service/tests")]
from app.decide.schemas import DecideRequest
from app.decide.service import run_decide
from app.policy.config import load_policy_config
from app.policy.mpc_policy import MpcPolicy
from demo_fakes import T0, FakeModel5, decide_body, flat_table

def case(name, body, after=3.0, **kw):
    pol = MpcPolicy(load_policy_config(), flat_table(4.0))
    m = FakeModel5()
    at = T0 + timedelta(seconds=after)
    try:
        o = run_decide(DecideRequest.model_validate(body), m, pol, received_at=at, now=lambda: at, **kw)
        resp = json.loads(o.response.model_dump_json(by_alias=True))
        err = None if o.error is None else [o.error.status, o.error.code]
        return name, {"status": o.status, "error": err, "response": resp, "predict_calls": len(m.batches)}
    except Exception as e:
        return name, {"exception": type(e).__name__, "predict_calls": len(m.batches)}

walk = {"speedMps": [1.2] * 80}
plan = [{"startM": 0, "endM": 5000, "ratio": 1.0}]
cases = [
    case("walk_1_2", decide_body(history=walk)),
    case("walk_user_personalization", dict(decide_body(history=walk), userId=7)),
    case("walk_user_no_personalization", dict(decide_body(history=walk), userId=7), gru_personalization_enabled=False,
         hr_threshold_lookup_configured=False),
    case("speed_none_recent", decide_body(history={"speedMps": [3.0] * 68 + [None] * 12})),
    case("speed_exactly_1_5", decide_body(history={"speedMps": [1.5] * 80})),
    case("speed_just_below_1_5", decide_body(history={"speedMps": [1.49] * 80})),
    case("running", decide_body()),
    case("running_user", dict(decide_body(), userId=7)),
    case("running_safety", decide_body(history={"hrBpm": [150.0] * 77 + [186.0] * 3})),
    case("paused_walking", decide_body(runState="PAUSED", history=walk)),
    case("stale_walking", decide_body(history=walk), after=20.0),
    case("single_cell_plan_walking", decide_body(plan=plan, activeSec=30,
         history={"hrBpm": [150.0], "speedMps": [1.2], "gradePct": [0.0]})),
    case("t0_hr_missing_walking", decide_body(history={"speedMps": [1.2] * 80, "hrBpm": [150.0] * 79 + [None]})),
]
Path(sys.argv[2]).write_text(json.dumps(dict(cases), ensure_ascii=False, indent=1, sort_keys=True), encoding="utf-8")
for n, v in cases: print(n, v.get("status"), v.get("error"), "predict", v["predict_calls"], v.get("exception", ""))
