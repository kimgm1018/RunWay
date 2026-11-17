"""In-range AI09 responses captured before S15P31E105-498 implementation."""
import json
import os
from pathlib import Path

from app.personal_plan import OdeBalancedPaceOptimizer
from test_personal_plan_course_regression import _post
from test_personal_plan_ode import RecordingOdeRuntime, _bundle

FIXTURE = Path(__file__).parent / "fixtures" / "ai09_goal_range_regression_pre498.json"


def _goal_responses(monkeypatch):
    monkeypatch.setenv("PERSONAL_PLAN_EXPERIMENTAL_ENABLED", "true")
    monkeypatch.setenv("FREE_RUN_GRADE_POLICY", "flat0")
    cases = {
        **{f"course_pace_{pace}": {"courseId": 297, "selectedGoal": {
            "targetPaceSecPerKm": pace}} for pace in (250, 345.5, 560)},
        "course_duration_840": {"courseId": 297, "selectedGoal": {"targetDurationSec": 840}},
        **{f"free_5000_pace_{pace}": {"selectedGoal": {
            "targetDistanceM": 5000, "targetPaceSecPerKm": pace}} for pace in (250, 400, 560)},
        "free_5000_duration_1800": {"selectedGoal": {
            "targetDistanceM": 5000, "targetDurationSec": 1800}},
        "free_10000_duration_3600": {"selectedGoal": {
            "targetDistanceM": 10000, "targetDurationSec": 3600}},
    }
    return {name: _post({"userId": 73, **body}, personal=_bundle(),
                        runtime=RecordingOdeRuntime(), optimizer=OdeBalancedPaceOptimizer())
            for name, body in cases.items()}


def test_in_range_goals_match_pre498_responses(monkeypatch):
    # S15P31E105-892: 이 고정 응답은 탐색 결과 그대로를 지킨다. km 평활화 결과는 test_km_smoothing.py에서 본다.
    monkeypatch.setenv("PLAN_KM_SMOOTHING_ENABLED", "false")
    actual = _goal_responses(monkeypatch)
    assert all(result["status"] == 200 for result in actual.values())
    if os.getenv("AI09_REGRESSION_REGENERATE") == "1":
        FIXTURE.parent.mkdir(parents=True, exist_ok=True)
        FIXTURE.write_text(json.dumps(actual, ensure_ascii=False, indent=1, sort_keys=True) + "\n",
                           encoding="utf-8")
    expected = json.loads(FIXTURE.read_text(encoding="utf-8"))
    assert set(actual) == set(expected)
    for name in expected:
        assert actual[name] == expected[name], name
