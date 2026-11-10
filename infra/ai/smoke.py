"""인수인계 순서대로 합성 요청만 보내고 상태만 출력한다. 응답 본문·건강 값은 기록하지 않는다."""
import argparse
from datetime import datetime, timezone
import json
from urllib.request import Request, urlopen


def request(base, endpoint, body=None):
    payload = None if body is None else json.dumps(body).encode()
    req = Request(base.rstrip("/") + endpoint, data=payload,
                  headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=90) as response:
        if response.status != 200:
            raise RuntimeError("HTTP 상태 확인 실패")
        return json.load(response)


def run(base, course_id):
    health = request(base, "/health")
    assert health.get("modelLoaded") is True and all(
        health.get("models", {}).get(name, {}).get("status") == "UP" for name in ("gru", "ode"))
    print("Health: GRU·ODE UP", flush=True)
    plan = request(base, "/v1/pace/plan", {
        "courseId": course_id, "gradeProfile": [{"startDistanceM": 0, "endDistanceM": 1000,
                                                "gradePercent": 0, "basePaceRatio": 1.0}],
        "targetDistanceM": 1000, "targetPaceSecPerKm": 300,
    })
    assert plan.get("planStatus") == "PLANNED" and len(plan.get("segments", [])) == 1
    print("AI05: PLANNED", flush=True)
    personal = request(base, "/v1/pace/personal-plan", {
        "userId": 1, "courseId": course_id, "selectedGoal": {"targetPaceSecPerKm": 300},
    })
    assert personal.get("planStatus") == "AVERAGE_BASED" and personal.get("personalized") is False
    print("AI09: AVERAGE_BASED", flush=True)
    decide = request(base, "/v1/pace/decide", {
        "elapsedSec": 0, "userId": 1,
        "history": {"hrBpm": [150], "speedMps": [3.2], "gradePct": [0]},
        "candidates": [{"paceSecPerKm": pace, "futureSpeedMps": [1000 / pace] * 24}
                       for pace in (270, 280, 290, 300, 310, 320, 330, 345, 360)],   # 기준 300 + AI04 후보 9개(S15P31E105-624)
        "context": {"sessionId": 1, "stateVersion": 1, "runState": "RUNNING", "mode": "COURSE",
                    "goal": {"targetDistanceM": 1000, "targetDurationSec": None, "targetPaceSecPerKm": 300},
                    "goalPreference": 0.5, "plan": [{"startM": 0, "endM": 1000, "ratio": 1.0}],
                    "anchorPaceSecPerKm": 300, "currentGuidePaceSecPerKm": 300, "activeSec": 0,
                    "distanceM": 0, "routeProgressM": 0,
                    "inputAsOf": datetime.now(timezone.utc).isoformat()},
        "includeForecast": False,
    })
    assert decide.get("pacing", {}).get("handoverPhase") == "PLAN_HOLD"
    print("AI04: PLAN_HOLD", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-url", default="http://127.0.0.1:8000")
    parser.add_argument("--course-id", type=int, required=True, help="격리 DB의 1km 합성 ACTIVE 코스 ID")
    args = parser.parse_args()
    try:
        run(args.base_url, args.course_id)
    except Exception as exc:
        print("기동 검증 실패: " + type(exc).__name__)
        raise SystemExit(1)
