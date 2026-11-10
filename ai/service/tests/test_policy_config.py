import json, pytest
from app.policy.config import load_policy_config


def test_default_values():
    c = load_policy_config()
    assert (c.policy_version, c.validated) == ("mpc-v0.5.0", False)
    assert (c.hr_threshold_population_danger_bpm, c.hr_threshold_population_sustain_bpm) == (175.0, 163.0)
    assert c.hr_threshold_blend_weights == (0.0, 0.25, 0.5, 0.75, 0.9, 1.0)
    assert c.final_stretch_extra_bpm == 5.0 and c.provisional is False
    assert (c.p0, c.sprint_m, c.band_bpm, c.ease_off_sec_per_km, c.chase_limit_sec_per_km, c.hold_sec) == (0.5, 400.0, 3.0, 30.0, 30.0, 60.0)
    assert (c.walk_speed_mps, c.hr_stale_sec, c.input_insufficient_sec, c.publish_delta_sec_per_km) == (1.5, 20.0, 20.0, 5.0)
    # 기존 나이 공식·HRR 설정은 제거하고 학습 기준·혼합 비중 설정으로 바꿨다.
    assert (c.hr_threshold_population_danger_bpm, c.hr_threshold_population_sustain_bpm,
            c.hr_threshold_blend_weights) == (175.0, 163.0, (0.0, 0.25, 0.5, 0.75, 0.9, 1.0))
    assert (c.w_t_base, c.w_c, c.score_unit_sec_per_km, c.margin_quantile) == (0.5, 0.3, 10.0, "P90")


def test_rejects_missing_unknown_and_validated(tmp_path):
    base = json.loads(open("app/policy/policy_v03.json", encoding="utf-8").read())
    for bad in ({k: v for k, v in base.items() if k != "band_bpm"}, {**base, "extra": 1}, {**base, "validated": True}):
        p = tmp_path / "c.json"; p.write_text(json.dumps(bad), encoding="utf-8")
        with pytest.raises(ValueError): load_policy_config(p)
