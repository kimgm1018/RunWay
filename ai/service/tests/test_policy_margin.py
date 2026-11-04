import csv, json, pytest
from app.policy.residual_margin import load_margin_table
from tools.margin_table_from_csv import build_table
from demo_fakes import flat_table, write_margin_table
HEAD = "model,personalization,set,horizon_s,direction,grade,n,low_n,P50,P90,P95".split(",")


def fixture_csv(tmp_path, overrides=None):
    rows = []
    for h in (30, 60, 120):
        for d in ("가속", "유지", "감속", "전체"):
            for g in ("오르막", "평지", "내리막", "전체"):
                rows.append({"model": "GRU", "personalization": "OFF", "set": "W1", "horizon_s": h, "direction": d, "grade": g,
                             "n": 500, "low_n": "False", "P50": 0.0, "P90": 4.0, "P95": 6.0})
    for r in rows:
        r.update((overrides or {}).get((r["horizon_s"], r["direction"], r["grade"]), {}))
    p = tmp_path / "rq.csv"
    with open(p, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, HEAD); w.writeheader(); w.writerows(rows)
    return p


def test_build_table_fallback_and_clamp(tmp_path):
    p = fixture_csv(tmp_path, {(120, "감속", "내리막"): {"P90": 7.6}, (120, "가속", "오르막"): {"n": 10, "low_n": "True", "P90": ""},
                               (120, "가속", "전체"): {"P90": 5.0}, (30, "유지", "평지"): {"P90": -0.5}})
    t = build_table(p, model="GRU")
    assert t["marginsBpm"]["120"]["DECEL"]["DOWN"] == 7.6
    assert t["marginsBpm"]["120"]["ACCEL"]["UP"] == 5.0 and "120/ACCEL/UP" in t["fallbackCells"]
    assert t["marginsBpm"]["30"]["HOLD"]["FLAT"] == 0.0 and t["personalization"] == "OFF"
    assert t["version"].startswith("cve1-GRU-OFF-W1-P90-")


def test_build_table_rejects_bad_header_and_missing_model(tmp_path):
    bad = tmp_path / "bad.csv"; bad.write_text("a,b\n1,2\n", encoding="utf-8")
    with pytest.raises(ValueError): build_table(bad, model="GRU")
    with pytest.raises(ValueError): build_table(fixture_csv(tmp_path), model="TF-D")


def test_classification_boundaries():
    t = flat_table()
    assert [t.direction_of(v) for v in (0.15, 0.149, -0.15, -0.149, None)] == ["ACCEL", "HOLD", "DECEL", "HOLD", None]
    assert [t.grade_of(v) for v in (2.01, 2.0, -2.0, -2.01, None)] == ["UP", "FLAT", "FLAT", "DOWN", None]


def test_t11_decel_downhill_margin_and_unknown_axes():
    t = flat_table(4.0, cells={(120, "DECEL", "DOWN"): 8.0})
    assert t.margin(120, -0.2, -3.0) == 8.0 and t.margin(120, -0.1, -3.0) == 4.0
    assert t.margin(120, None, -3.0) == 8.0 and t.margin(120, -0.2, None) == 8.0


def test_load_roundtrip_and_errors(tmp_path):
    t = load_margin_table(write_margin_table(tmp_path, model="GRU", m=4.0))
    assert t.model == "GRU" and t.margin(60, 0.0, 0.0) == 4.0
    with pytest.raises(FileNotFoundError): load_margin_table(tmp_path / "none.json")
    p = write_margin_table(tmp_path, model="GRU"); d = json.loads(p.read_text(encoding="utf-8"))
    d["direction"]["accelAtLeastMps"] = 0.2; p.write_text(json.dumps(d), encoding="utf-8")
    with pytest.raises(ValueError): load_margin_table(p)
