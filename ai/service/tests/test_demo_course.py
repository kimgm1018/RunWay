import pytest
from app.demo.course import CourseProfile, load_course
from app.demo.candidates import build_candidates, choose_anchor, future_grades, goal_pace


def slope(length=1000, pct=5.0, n=11):
    d = [length * i / (n - 1) for i in range(n)]
    return CourseProfile(tuple(d), tuple(x * pct / 100 for x in d), tuple(0.0 for _ in d), tuple(0.0 for _ in d))


def test_load_course_haversine(tmp_path):
    p = tmp_path / "c.json"; p.write_text('{"points":[{"lon":127.0,"lat":37.0,"elevationM":1},{"lon":127.0,"lat":37.001,"elevationM":2}]}', encoding="utf-8")
    assert load_course(p).length_m == pytest.approx(111.19, abs=0.5)


def test_grade_uniform_and_clamped():
    c = slope()
    assert c.grade_at(500) == pytest.approx(5.0) and c.grade_at(1500) == pytest.approx(c.grade_at(1000))
    assert c.elevation_at(-10) == 0.0


def test_candidates():
    cs = build_candidates(340, 0.0, slope())
    assert [c["paceSecPerKm"] for c in cs] == [310, 320, 330, 340, 350, 360, 370, 385, 400]
    assert cs[0]["futureSpeedMps"] == pytest.approx([1000 / 310] * 24) and cs[0]["futureGradePct"] == pytest.approx([5.0] * 24)
    assert build_candidates(340, 0.0, None)[2]["futureGradePct"] is None


def test_anchor_and_goal_pace():
    assert goal_pace({"targetDistanceM": 5000, "targetDurationSec": 1800, "targetPaceSecPerKm": None}) == 360
    assert choose_anchor(360, None, 330) == 360 and choose_anchor(360, 350, 330) == 350 and choose_anchor(None, 350, 330) == 330


def test_anchor_is_actual_pace_when_guide_not_delivered():
    # 워치에 안내가 가지 않으면 러너는 자기 pace로 달린다. 가상 안내 pace를 기준으로 삼으면 감속 추천이 쌓인다.
    assert choose_anchor(360, 350, 330, follows_guide=False) == 330
    assert choose_anchor(360, 350, None, follows_guide=False) == 350 and choose_anchor(360, None, None, follows_guide=False) == 360


def test_summary_downsamples():
    s = slope(n=2001).summary(max_points=500)
    assert len(s["points"]) <= 500 and s["points"][0][3] == 0 and s["points"][-1][3] == 1000
