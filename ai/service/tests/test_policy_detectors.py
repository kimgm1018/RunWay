from app.policy.config import load_policy_config
from app.policy.detectors import detect
C = load_policy_config()


def run(cells, guide=360, allow=165, hr=150): return detect(cells, guide_pace_sec_per_km=guide, allow_bpm=allow, hr_now_bpm=hr, cfg=C)


def test_pace_drop_excludes_walking():
    assert run([(150, 1000 / 380)] * 12) == ("PACE_DROP",)
    assert run([(150, 1000 / 380)] * 5 + [(150, 1.0)] * 7) == ()
    assert run([(150, 1000 / 370)] * 12) == ()


def test_overpace_needs_hr_condition():
    fast = 1000 / 345
    assert run([(150, fast)] * 12, hr=166) == ("OVERPACE",)
    rising = [(140 + i * 1.1, fast) for i in range(12)]
    assert run(rising) == ("OVERPACE",)
    assert run([(150, fast)] * 12) == ()
    assert run([(150, fast)] * 12, guide=None) == ()
