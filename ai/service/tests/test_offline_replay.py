import json
import pytest
from datetime import datetime, timezone
from tools.offline_replay import build_recording, main
from demo_fakes import FakeModel5, flat_table, write_margin_table


def test_offline_replay_writes_all_traces(tmp_path):
    csv_path = tmp_path / "fitrec.csv"
    csv_path.write_text("session_id,subject_group_id,elapsed_s,hr_bpm,speed_mps,grade_pct,cumulative_distance_m\n" +
                        "\n".join(f"s1,g1,{s},{150 + s / 100},3.0,0,{s * 3}" for s in range(0, 61, 5)) + "\n", encoding="utf-8")
    split_path = tmp_path / "split.json"
    split_path.write_text('{"train":[],"val":["g1"]}', encoding="utf-8")
    margins = write_margin_table(tmp_path, model="GRU", m=4.0)
    out_dir = tmp_path / "recordings"
    result = build_recording(file=csv_path, split_file=split_path, split="val", recording_id="gru_val_test",
                             label="합성 검증", model_label="가짜 예측기", margin_table=margins,
                             goal_distance_m=5000, hr_reference={"hrMaxBpm": None, "rhrBpm": 60, "ageYears": 30},
                             out_dir=out_dir, model=FakeModel5())
    assert len(result["traces"]) == 13
    assert {"traceId", "inputAsOf", "candidates", "decision", "latency"} <= set(result["traces"][0])
    js = (out_dir / "gru_val_test.js").read_text(encoding="utf-8")
    assert js.startswith("window.RunwayDemoRecordings.push(")
    assert (out_dir / "gru_val_test.json").is_file()


def test_offline_replay_main_requires_inputs(tmp_path):
    assert main(["--file", str(tmp_path / "missing.csv"), "--split-file", str(tmp_path / "split.json"),
                 "--split", "val", "--id", "x", "--label", "x", "--model-label", "x",
                 "--margin-table", str(tmp_path / "m.json"), "--goal-distance-m", "5000", "--out-dir", str(tmp_path)]) != 0


def test_offline_replay_anchor_tracks_actual_pace(tmp_path):
    # 재생 러너는 안내를 받지 않는다. 심박이 높아도 앵커가 추천을 따라 계속 느려지면 안 된다.
    csv_path = tmp_path / "fitrec.csv"
    csv_path.write_text("session_id,subject_group_id,elapsed_s,hr_bpm,speed_mps,grade_pct,cumulative_distance_m\n" +
                        "\n".join(f"s1,g1,{s},178,3.0,0,{s * 3}" for s in range(0, 601, 5)) + "\n", encoding="utf-8")
    split_path = tmp_path / "split.json"
    split_path.write_text('{"train":[],"val":["g1"]}', encoding="utf-8")
    result = build_recording(file=csv_path, split_file=split_path, split="val", recording_id="drift_test",
                             label="합성 검증", model_label="가짜 예측기",
                             margin_table=write_margin_table(tmp_path, model="GRU", m=4.0),
                             goal_distance_m=5000, goal_duration_sec=1500,
                             hr_reference={"hrMaxBpm": None, "rhrBpm": 60, "ageYears": 30},
                             out_dir=tmp_path / "recordings", model=FakeModel5())
    anchors = [t["anchorPaceSecPerKm"] for t in result["traces"]]
    assert anchors and all(a == pytest.approx(1000 / 3.0, abs=0.01) for a in anchors)
