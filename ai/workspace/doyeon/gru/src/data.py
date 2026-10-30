import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import torch
from torch.utils.data import Dataset

USER_COL = "subject_id"                         # 사람 구분
GROUP_COLS = ["session_id", "segment_id"]       # 끊김 없는 한 구간
FEATURES = ["speed_mps", "grade_observed_pct"]  # 입력: 속도, 경사
TARGET = "hr_bpm"                               # 정답: 심박

HIST = 24              # 과거 2분 (5초 × 24)
FUT = 24               # 미래 2분
HORIZONS = [6, 12, 24] # +30초, +60초, +120초
STRIDE = 12            # 1분마다 샘플 하나
START = 6              # "지금"은 구간 시작 30초 뒤부터 (과거가 부족하면 빈칸)
EVAL_STRIDE = 6        # 평가: 30초마다 (모든 실험에서 고정)
EXTRA_COLS = ["elapsed_s", "hr_is_filled", "hr_quality"]   # 평가용 정보 (입력에는 안 씀)
ELAPSED_CLIP = 1800    # 경과 시간 자르는 기본값: 30분 (--elapsed-clip으로 변경)
ELAPSED_SCALE = 600    # 10분 = 1.0 이 되도록 줄임
ELAPSED_BINS = {"elapsed_0_30": (0, 1800), "elapsed_30_60": (1800, 3600),
                "elapsed_60_plus": (3600, float("inf"))}   # 평가용 경과 시간 구간 (초)


def load_fitrec(data_dir, n_files=1):
    data_dir = Path(data_dir)

    # ① 품질 괜찮은 러닝 목록 만들기
    sessions = pd.read_parquet(data_dir / "sessions.parquet",
                               columns=["session_id", "workout_quality_v1"])
    good = sessions[sessions["workout_quality_v1"] != "LOW_QUALITY"]["session_id"]

    # ② 시계열 파일 n_files개에서 필요한 컬럼만 읽기
    files = sorted((data_dir / "timeseries").glob("*.parquet"))[:n_files]
    cols = [USER_COL, *GROUP_COLS, *FEATURES, TARGET, *EXTRA_COLS]
    df = pd.concat([pd.read_parquet(f, columns=cols) for f in files], ignore_index=True)

    # ③ 목록에 있는 러닝만 남기고, 빈 값 있는 줄 빼기
    df = df[df["session_id"].isin(good)]
    df = df.dropna(subset=FEATURES + [TARGET])
    return df.reset_index(drop=True)

def load_split(split_path):
    """json 명단을 읽어 {사람 ID: "train"/"val"/"test"}와 평가할 러닝 목록을 만든다."""
    with open(split_path, encoding="utf-8") as f:
        spec = json.load(f)

    members = spec["group_members"]   # 중복 계정: 그룹 ID → 실제 계정 2개
    subject_split = {}
    for name in ["train", "val", "test"]:
        for group_id in spec[name]:
            for subject in members.get(group_id, [group_id]):   # 보통은 자기 자신 1명
                subject_split[subject] = name

    eval_sessions = {name: set(spec["eval_windows"][name]["eval_session_ids"])
                     for name in ["val", "test"]}
    return subject_split, eval_sessions


def session_roles_v2(spec, data_dir):
    """v2 명단: 사람(그룹)마다 러닝을 시간순으로 줄 세워 역할을 정한다. {러닝 ID: 역할}
    train 그룹: 앞 80%(floor) → "train", 나머지 → "train_holdout" (1회뿐이면 "train")
    personalized 그룹: 최신 max(1, ceil(20%)) → "val"/"test" (평가), 나머지 → "support" (개인 과거 기록)
    cold_start 그룹: 1회뿐인 러닝 → "val"/"test" """
    members = spec["group_members"]
    group_of, cohort_of = {}, {}
    for cohort, group_ids in spec["cohorts"].items():
        for group_id in group_ids:
            cohort_of[group_id] = cohort
            for subject in members.get(group_id, [group_id]):
                group_of[subject] = group_id

    sessions = pd.read_parquet(Path(data_dir) / "sessions.parquet",
                               columns=["subject_id", "session_id", "start_time_utc", "workout_quality_v1"])
    sessions = sessions[sessions["workout_quality_v1"] != "LOW_QUALITY"]   # 계약의 usable 러닝 수 N과 같음
    sessions = sessions.assign(group=sessions["subject_id"].map(group_of),
                               start=pd.to_datetime(sessions["start_time_utc"]))
    roles = {}
    for group_id, s in sessions.groupby("group"):
        ids = s.sort_values(["start", "session_id"])["session_id"].tolist()   # 오래된 순
        n = len(ids)
        cohort = cohort_of[group_id]
        if cohort == "train":
            n_fit = n if n == 1 else math.floor(0.8 * n)
            roles.update({sid: "train" if i < n_fit else "train_holdout" for i, sid in enumerate(ids)})
        else:
            name = cohort.split("_")[-1]                       # "val" 또는 "test"
            n_query = max(1, math.ceil(0.2 * n))
            roles.update({sid: name if i >= n - n_query else "support" for i, sid in enumerate(ids)})
    return roles


def split_by_contract(df, split_path, data_dir=None):
    """팀 공통 명단대로 나눈다.
    v1: val·test는 정해진 평가 러닝(사람당 최대 20회)만 남긴다.
    v2: 사람별 시간순 규칙(session_roles_v2)으로 train과 평가 러닝을 고른다."""
    with open(split_path, encoding="utf-8") as f:
        spec = json.load(f)
    if "cohorts" in spec:                                      # v2 명단
        role = df["session_id"].map(session_roles_v2(spec, data_dir))
        return df[role == "train"], df[role == "val"], df[role == "test"]

    subject_split, eval_sessions = load_split(split_path)
    split = df[USER_COL].map(subject_split)   # 각 줄이 train/val/test 중 어디인지

    train_df = df[split == "train"]
    val_df = df[(split == "val") & df["session_id"].isin(eval_sessions["val"])]
    test_df = df[(split == "test") & df["session_id"].isin(eval_sessions["test"])]
    return train_df, val_df, test_df



class Normalizer:
    def __init__(self, train_df):
        cols = FEATURES + [TARGET]
        self.mean = train_df[cols].mean()
        self.std = train_df[cols].std()

    def __call__(self, df):
        cols = FEATURES + [TARGET]
        df = df.copy()
        df[cols] = (df[cols] - self.mean) / self.std
        return df

    def hr_to_bpm(self, y):  # 정규화된 HR → bpm으로 되돌리기
        return y * self.std[TARGET] + self.mean[TARGET]
    
class HorizonDataset(Dataset):
    def __init__(self, df, stride=STRIDE, use_elapsed = False, hist=HIST, elapsed_clip=ELAPSED_CLIP):
        self.use_elapsed = use_elapsed
        self.hist = hist      # 과거 입력 칸 수 (5초 단위, 기본 24 = 2분)
        self.elapsed_clip = elapsed_clip   # 경과 시간 자르는 기준 (초)
        self.segments = []   # 구간별 (속도·경사, 심박, 정답 유효 여부, 경과 시간)
        self.index = []      # 샘플 목록: (몇 번째 구간, "지금" 위치)
        for _, seg in df.groupby(GROUP_COLS):
            x = seg[FEATURES].to_numpy(np.float32, copy=True)
            hr = seg[TARGET].to_numpy(np.float32, copy=True)
            # 정답으로 쓸 수 있는 칸: 실제로 잰 값(복사 아님) + 품질 GOOD
            real = (~seg["hr_is_filled"].to_numpy(bool)) & (seg["hr_quality"].to_numpy() == "GOOD")
            elapsed = seg["elapsed_s"].to_numpy(np.float32, copy=True)
            k = len(self.segments)
            self.segments.append((x, hr, real, elapsed))
            # 구간 시작 30초 뒤부터, 미래 24칸이 있는 위치까지
            for now in range(START, len(seg) - FUT, stride):
                self.index.append((k, now))

    def __len__(self):
        return len(self.index)

    def __getitem__(self, i):
        k, now = self.index[i]
        x, hr, real, elapsed = self.segments[k]
        lo = max(0, now - self.hist + 1)            # 과거 시작 (구간 시작보다 앞이면 0)
        n_pad = self.hist - (now + 1 - lo)          # 모자란 과거 칸 수

        # 과거: 모자란 칸은 빈칸(전부 0, 과거표시 0) + 실제 과거(속도, 경사, 심박, 과거표시 1)
        pad = np.zeros((n_pad, 4), np.float32)
        hist_part = np.column_stack([x[lo:now + 1], hr[lo:now + 1], np.ones(now + 1 - lo, np.float32)])
        # 미래: 속도, 경사, 심박 모름(0), 과거표시(0)
        future = slice(now + 1, now + FUT + 1)
        fut_part = np.column_stack([x[future], np.zeros((FUT, 2), np.float32)])
        seq = np.vstack([pad, hist_part, fut_part])  # (hist + 24, 4), 지금은 항상 끝에서 25번째 줄
        if self.use_elapsed:
            # 각 칸의 경과 시간: 지금 기준 과거 -(hist-1)×5초 ... 0초 ... 미래 +120초
            times = elapsed[now] + 5.0 * np.arange(-(self.hist - 1), FUT + 1, dtype=np.float32)
            t_col = np.clip(times, 0, self.elapsed_clip) / ELAPSED_SCALE
            t_col[:n_pad] = 0                                  # 빈칸(과거 부족분)은 0
            seq = np.column_stack([seq, t_col.astype(np.float32)])   # (hist + 24, 5)

        t = [now + h for h in HORIZONS]
        target = hr[t]                               # +30, +60, +120초 실제 심박
        valid = real[t]                              # 그 정답을 채점에 써도 되는지
        return (torch.from_numpy(seq), torch.from_numpy(target), torch.tensor(hr[now]),
                torch.from_numpy(valid), torch.tensor(elapsed[now]))   # 지금 경과 시간(초, 자르지 않은 값)

if __name__ == "__main__":
    DATA_DIR = "C:/Users/SSAFY/Desktop/fitrec/canonical/fitrec_v1"
    SPLIT_PATH = "C:/Users/SSAFY/Desktop/fitrec/fitrec_hr_v1.json"

    df = load_fitrec(DATA_DIR, n_files=3)
    print(df.shape, df[USER_COL].nunique(), df["session_id"].nunique())

    train_df, val_df, test_df = split_by_contract(df, SPLIT_PATH)
    for name, part in [("train", train_df), ("val", val_df), ("test", test_df)]:
        print(name, part[USER_COL].nunique(), "명", part["session_id"].nunique(), "회", len(part), "줄")

    norm = Normalizer(train_df)
    ds = HorizonDataset(norm(train_df))
    seq, target, current, valid, elapsed = ds[0]
    print(len(ds), seq.shape, target.shape, current.shape, valid, elapsed)