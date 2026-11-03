import json
from tools.course_from_csv import build_course


def test_course_from_csv_skips_missing_coordinates(tmp_path):
    p = tmp_path / "rows.csv"
    p.write_text("session_id,subject_group_id,elapsed_s,hr_bpm,speed_mps,grade_pct,latitude,longitude,altitude_m\n"
                 "s1,g1,0,150,3,0,37.0,127.0,10\n"
                 "s1,g1,5,151,3,0,,,\n"
                 "s1,g1,10,152,3,0,37.001,127.0,11\n", encoding="utf-8")
    out = build_course(p)
    assert out == {"points": [{"lon": 127.0, "lat": 37.0, "elevationM": 10.0},
                               {"lon": 127.0, "lat": 37.001, "elevationM": 11.0}]}
