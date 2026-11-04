"""가짜 힘 신호·stride 파일로 변환기가 케이던스를 정확히 계산하는지 확인한다."""
import sys

import numpy as np
import pandas as pd
import pytest

import convert_fukuchi
import convert_zenodo_out
import convert_zenodo_tm


def write_forces(path, gap_frames, n_frames=9000, contact_frames=60):
    """gap_frames마다 착지하는 수직 힘 신호(300Hz)."""
    fy = np.zeros(n_frames)
    for start in range(10, n_frames - contact_frames, gap_frames):
        fy[start:start + contact_frames] = 1500.0
    pd.DataFrame({"Time": np.arange(1, n_frames + 1), "Fy": fy}).to_csv(path, sep="\t", index=False)


def test_fukuchi_cadence_from_contacts(tmp_path):
    path = tmp_path / "RBDS001runT25forces.txt"
    write_forces(path, gap_frames=100)            # 100프레임 = 1/3초마다 착지
    out = convert_fukuchi.convert_file(path, speed=2.5)
    assert out["cadence_spm"] == pytest.approx(180.0)
    assert out["stride_m"] == pytest.approx(60 * 2.5 / 180)
    assert out["n_dropped"] == 0


def test_fukuchi_ignores_double_counted_contact(tmp_path):
    path = tmp_path / "RBDS001runT25forces.txt"
    write_forces(path, gap_frames=100)
    forces = pd.read_csv(path, sep="\t")
    forces.loc[2040:2045, "Fy"] = 0.0             # 접지 중간에 힘이 잠깐 빠져 착지가 두 번 잡히게 만든다
    forces.to_csv(path, sep="\t", index=False)
    out = convert_fukuchi.convert_file(path, speed=2.5)
    assert out["cadence_spm"] == pytest.approx(180.0)
    assert out["n_dropped"] >= 1


def test_fukuchi_main_drops_duplicate_files(tmp_path, monkeypatch):
    write_forces(tmp_path / "RBDS001runT25forces.txt", gap_frames=110)
    write_forces(tmp_path / "RBDS001runT35forces.txt", gap_frames=100)
    write_forces(tmp_path / "RBDS002runT25forces.txt", gap_frames=105)   # 002는 두 속도 파일이 똑같다
    write_forces(tmp_path / "RBDS002runT35forces.txt", gap_frames=105)
    pd.DataFrame({"Subject": [1, 2], "Height": [180.0, 170.0]}).to_csv(
        tmp_path / "39452932_RBDSinfo.txt", sep="\t", index=False)
    out = tmp_path / "out.csv"
    monkeypatch.setattr(sys, "argv", ["convert_fukuchi.py", str(tmp_path), str(out)])
    convert_fukuchi.main()
    table = pd.read_csv(out)
    assert list(table["subject_id"]) == ["F_RBDS001", "F_RBDS001"]
    assert list(table["speed_mps"]) == [2.5, 3.5]
    assert list(table["height_cm"]) == [180.0, 180.0]


def test_zenodo_cadence_from_stride_duration(tmp_path):
    folder = tmp_path / "TM_FP" / "participant_11" / "speed_3" / "cadence_SS1"
    folder.mkdir(parents=True)
    for i in range(20):
        n = 100                                     # 100줄 × 0.0075초 = 0.75초 stride
        pd.DataFrame({"delta_time": [0.0075] * n, "speed": [3.0] * n}).to_csv(
            folder / f"stride_{i + 1}.csv", index=False)
    out = convert_zenodo_tm.convert_folder(folder)
    assert out["cadence_spm"] == pytest.approx(160.0)
    assert out["speed_mps"] == pytest.approx(3.0)
    assert out["n_steps"] == 40



def fake_outdoor(stride_sec, seconds=25, fs=120, seed=0):
    """발 자이로처럼 stride마다 한 번 크게 흔들리는 가짜 실외 구간."""
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * fs)) / fs
    swing = 300 * np.sin(2 * np.pi * t / stride_sec) + 80 * np.sin(4 * np.pi * t / stride_sec)
    return pd.DataFrame({
        "delta_time": 1 / fs, "speed": 3.0,
        "fot_gyr_x": rng.normal(0, 5, len(t)), "fot_gyr_y": swing + rng.normal(0, 20, len(t)),
        "fot_gyr_z": rng.normal(0, 5, len(t)),
    })


@pytest.mark.parametrize("stride_sec", [0.6, 0.7, 0.8])
def test_outdoor_cadence_from_foot_gyro(stride_sec):
    cadence, quality = convert_zenodo_out.imu_cadence(fake_outdoor(stride_sec))
    assert cadence == pytest.approx(120 / stride_sec, abs=0.5)     # 0.7초 → 171.4 spm
    assert quality > 0.8


def test_outdoor_convert_table(tmp_path):
    folder = tmp_path / "OUT" / "participant_11"
    folder.mkdir(parents=True)
    fake_outdoor(0.75).to_csv(folder / "set_1_straightaway_1.csv", index=False)
    table = convert_zenodo_out.convert(tmp_path)
    row = table.iloc[0]
    assert row["subject_id"] == "Z_P11"
    assert row["session_id"] == "Z_P11_OUT_set1_s1"
    assert row["setting"] == "outdoor"
    assert row["cadence_spm"] == pytest.approx(160.0, abs=0.5)
    assert row["stride_m"] == pytest.approx(60 * 3.0 / row["cadence_spm"])