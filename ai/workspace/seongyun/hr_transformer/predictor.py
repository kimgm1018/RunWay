"""RunWay HR Predictor — Personalized Action-Conditioned Transformer (ptv2 + Session Context v1).

테스트 인계용 wrapper. 모델·적응·Session Context 계산은 학습 때 쓴 ptv2/ 파일(체크포인트의 code_sha256과 같은
파일)을 그대로 import하고, 이 파일은 원시 세션 배열을 학습·Val과 같은 규칙으로 모델 입력으로 바꾸기만 한다.

    p = Predictor("<HF에서 받은 경로>/ptv2_sessionctx_v1_seed1729_step130000.pt")  # 모델 로드 (CPU 기본, README 13장)
    p.personalize(support_sessions)              # Support 세션 → Personal4 적응 + History 원천 저장 (공유 weight 불변)
    hr = p.predict(batch)                        # np.ndarray [N, 3] = [HR@30, HR@60, HR@120] (bpm, 절대값)
    hr_off = p.predict(batch, personalized=False)  # Personalization OFF (= population)
    p.reset()                                    # 다음 사용자 전에 반드시 호출

입력 형식: README.md 「3. 입력 feature와 shape / unit」, 「6. Support personalization 방식」.
"""
from __future__ import annotations

import argparse
import functools
import hashlib
import json
import pickle
import sys
from pathlib import Path

import numpy as np
import pandas as pd
import torch

HERE = Path(__file__).resolve().parent
if str(HERE) not in sys.path:
    sys.path.insert(0, str(HERE))

from ptv2 import config as C  # noqa: E402
from ptv2.adapt import adapt_personal4, local_personal4_model, personal4_init, state_digest  # noqa: E402
from ptv2.batch import check_batch, collate_windows, move_batch  # noqa: E402
from ptv2.model import PersonalizedActionTransformer  # noqa: E402
from ptv2.session_context import FEATURES as SESSION_FEATURES, check_time_order, window_summaries  # noqa: E402
from ptv2.train_data import parse_hr0_policy  # noqa: E402
from ptv2.train_scan import H_ROWS, ROW_HR_VALID, _all_ok  # noqa: E402
from ptv2.v2_data import ROW_QUALITY, vertical_speed_proxy  # noqa: E402

EXPORT_FORMAT = "runway_hr_predictor_v1"  # 인계용 final checkpoint (weights-only export)
CHECKPOINT_FORMAT = "ptv2_stage3_ckpt_v1"  # 학습 checkpoint 원본
STATE_FORMAT = "ptv2_user_state_v1"
HORIZONS = (30, 60, 120)
OUTPUT_INDEX = [C.HORIZON_INDEX[h] for h in HORIZONS]  # 24칸 미래 출력 중 +30/+60/+120초
ANCHOR_ROWS = 30 // C.GRID_S  # Support 창 = 30초 anchor (학습 stride 30 · Val support와 같음)
NO_HISTORY = np.full((1, C.HISTORY_FEATURE_DIM), -1.0, np.float32)  # V2 loader의 NO_HISTORY_SENTINEL
VENDORED = ("__init__.py", "config.py", "batch.py", "model.py", "adapt.py", "losses.py", "session_context.py",
            "train_cache.py", "train_data.py", "train_scan.py", "v2_data.py")


def file_sha256(path) -> str:
    digest = hashlib.sha256()
    with open(path, "rb") as fh:
        for block in iter(lambda: fh.read(1 << 20), b""):
            digest.update(block)
    return digest.hexdigest()


# ------------------------------------------------------------------------------------------- 세션 행 (5초 canonical)
def _valid_quality(values, n: int, name: str) -> np.ndarray:
    """None → 전부 유효. bool 배열 → 그대로. 문자열 → GOOD/LOW만 유효 (학습 ROW_QUALITY)."""
    if values is None:
        return np.ones(n, bool)
    v = np.asarray(values)
    if v.shape != (n,):
        raise ValueError(f"{name} has shape {v.shape}, expected ({n},)")
    return v.copy() if v.dtype == np.bool_ else np.isin(v.astype(str), ROW_QUALITY)


def _filled_flag(values, n: int) -> np.ndarray:
    """hr_is_filled. None → 전부 False(측정값). NaN/None/NA → True (학습 canonical의 fillna(True)와 같음)."""
    if values is None:
        return np.zeros(n, bool)
    v = np.asarray(values)
    if v.shape != (n,):
        raise ValueError(f"hr_is_filled has shape {v.shape}, expected ({n},)")
    if v.dtype == np.bool_:
        return v.copy()
    missing = np.asarray(pd.isna(v), bool)
    out = np.ones(n, bool)
    out[~missing] = v[~missing].astype(bool)
    return out


def session_rows(hr, speed, grade, elapsed_s, segment_id=None, *, hr_quality=None, speed_quality=None,
                 grade_quality=None, hr_is_filled=None, name="session") -> dict:
    """한 세션의 5초 행 → (segment_id, elapsed_s) 순 정렬 + 학습(train_scan.scan_part)과 같은 유효성 배열."""
    elapsed = np.asarray(elapsed_s, np.float64)
    n = len(elapsed)
    if elapsed.ndim != 1 or n == 0:
        raise ValueError(f"{name}: elapsed_s must be a non-empty 1-D array")
    seg = np.zeros(n, np.int64) if segment_id is None else np.asarray(segment_id)
    if seg.shape != (n,):
        raise ValueError(f"{name}: segment_id has shape {seg.shape}, expected ({n},)")
    cols = {}
    for key, values in (("hr", hr), ("speed", speed), ("grade", grade)):
        a = np.asarray(values, np.float32)
        if a.shape != (n,):
            raise ValueError(f"{name}: {key} has shape {a.shape}, expected ({n},)")
        cols[key] = a
    hq = _valid_quality(hr_quality, n, f"{name}: hr_quality")
    sq = _valid_quality(speed_quality, n, f"{name}: speed_quality")
    gq = _valid_quality(grade_quality, n, f"{name}: grade_quality")
    filled = _filled_flag(hr_is_filled, n)
    order = np.lexsort((elapsed, seg))
    elapsed, seg, filled, hq, sq, gq = elapsed[order], seg[order], filled[order], hq[order], sq[order], gq[order]
    hr, speed, grade = (cols[k][order] for k in ("hr", "speed", "grade"))
    if not np.isfinite(elapsed).all():
        raise ValueError(f"{name}: elapsed_s has non-finite values")
    new = np.ones(n, bool)
    new[1:] = seg[1:] != seg[:-1]
    if not np.all(np.diff(elapsed)[~new[1:]] == C.GRID_S):
        raise ValueError(f"{name}: elapsed_s is not a contiguous 5 s grid inside every segment")
    if check_time_order(elapsed, np.zeros(1, np.int64), np.array([n])):
        raise ValueError(f"{name}: segments are not in time order (row order must be time order)")
    return dict(elapsed=elapsed, segment=seg, seg_new=new, hr=hr, speed=speed, grade=grade,
                hr_quality=hq, speed_quality=sq, grade_quality=gq, filled=filled,
                hr_valid=np.isfinite(hr) & hq, speed_valid=np.isfinite(speed) & sq,
                grade_valid=np.isfinite(grade) & gq, vertical=vertical_speed_proxy(speed, grade, sq, gq))


def _segment_index(r: dict):
    n = len(r["elapsed"])
    starts = np.flatnonzero(r["seg_new"])
    lens = np.diff(np.r_[starts, n])
    seg_of_row = np.repeat(np.arange(len(starts)), lens)
    seg_start = starts[seg_of_row]
    return seg_start, np.arange(n) - seg_start, lens[seg_of_row]


def _session_summary(r: dict, t0_rows, fill: np.ndarray) -> np.ndarray:
    """Session Context [len(t0_rows), 10] = 세션 첫 행 ~ t0 행 (ptv2.session_context.window_summaries 그대로).
    유효 행이 없는 feature는 Val과 같이 frozen Train mean으로 채운다."""
    rows = dict(hr=r["hr"], speed=r["speed"], vertical=r["vertical"], elapsed=r["elapsed"],
                flags=np.where(r["hr_valid"], ROW_HR_VALID, 0).astype(np.uint8))
    t0_rows = np.asarray(t0_rows, np.int64)
    out = window_summaries(rows, np.zeros(1, np.int64), t0_rows, np.zeros(len(t0_rows), np.int64))
    return np.where(np.isnan(out), fill[None, :], out).astype(np.float32)


def _support_t0_rows(r: dict, max_age) -> np.ndarray:
    """Support 창의 t0 행: train_scan.scan_part 창 규칙 + 30초 anchor + HR0 정책(학습 hr0_policy)."""
    n, P, F = len(r["hr"]), C.PAST_STEPS, C.FUTURE_STEPS
    seg_start, local, seg_len = _segment_index(r)
    k = np.flatnonzero((local >= P - 1) & (local <= seg_len - F - 1))
    hr_bad, sp_bad, gr_bad = ~r["hr_valid"], ~r["speed_valid"], ~r["grade_valid"]
    ok = _all_ok(hr_bad | sp_bad | gr_bad, k - P + 1, P) & _all_ok(sp_bad | gr_bad, k + 1, F)
    ok &= ~hr_bad[k[:, None] + H_ROWS[None, :]].any(axis=1)
    k = k[ok]
    k = k[((local[k] - (P - 1)) % ANCHOR_ROWS) == 0]
    if max_age is not None:
        measured = r["hr_valid"] & ~r["filled"]
        last = np.maximum.accumulate(np.where(measured, np.arange(n), -1))
        lk = last[k]
        age = np.where(lk >= seg_start[k], r["elapsed"][k] - r["elapsed"][np.maximum(lk, 0)], np.nan).astype(np.float32)
        k = k[measured[k] | (age <= max_age)]
    return k


def _history_rows(r: dict) -> np.ndarray:
    """History 원천: 10초 칸(각 segment 첫 칸부터 한 칸 건너, decimate_to_10s) 중 HR·속도·경사가 유효한 행의
    [(hr-142)/22, elapsed/1200, speed, vertical speed proxy] (apple_pretrain_v2.data._history_from_prior와 같음)."""
    _, local, _ = _segment_index(r)
    idx = np.flatnonzero(local % 2 == 0)
    valid = (r["hr_valid"] & r["speed_valid"] & r["grade_valid"])[idx]
    block = np.column_stack(((r["hr"][idx] - 142.) / 22., r["elapsed"][idx].astype(np.float32) / 1200.,
                             r["speed"][idx], r["vertical"][idx]))
    return block[valid].astype(np.float32)


def _history_for(workouts: list, start_s: float) -> np.ndarray:
    """start_s에 시작하는 세션의 History [Lh, 5]: 그 전에 시작했고 start_s까지 끝난 Support 세션의 10초 행,
    시간 순으로 이어 붙여 마지막 512행 + log1p(경과 일수). 없으면 sentinel."""
    blocks = [np.column_stack((w["rows"], np.full(len(w["rows"]), np.log1p((start_s - w["start_s"]) / 86400.0),
                                                     np.float32)))
              for w in workouts if w["start_s"] < start_s and w["end_s"] <= start_s and len(w["rows"])]
    if not blocks:
        return NO_HISTORY.copy()
    return np.concatenate(blocks)[-C.HISTORY_MAX_LENGTH:].astype(np.float32)


def _window_item(r: dict, k: int, *, window_id: str, history: np.ndarray, future_action=None, future_time=None,
                 with_target: bool = False) -> dict:
    past = np.arange(k - C.PAST_STEPS + 1, k + 1)
    future = np.arange(k + 1, k + C.FUTURE_STEPS + 1)
    if future_action is None:
        future_action = np.column_stack((r["speed"][future], r["vertical"][future]))
        future_time = r["elapsed"][future] / C.TIME_SCALE_S
    item = dict(window_id=window_id, past_hr=r["hr"][past].astype(np.float32),
                past_hr_is_filled=r["filled"][past].copy(),
                past_action=np.column_stack((r["speed"][past], r["vertical"][past])).astype(np.float32),
                past_time=(r["elapsed"][past] / C.TIME_SCALE_S).astype(np.float32),
                future_action=np.asarray(future_action, np.float32), future_time=np.asarray(future_time, np.float32),
                hr0=np.float32(r["hr"][k]), history=history, subject_index=0)
    if with_target:
        item["target_mask"] = r["hr_valid"][future].copy()
        item["target_hr"] = np.where(item["target_mask"], r["hr"][future], 0.0).astype(np.float32)
    return item


# ------------------------------------------------------------------------------------------------ 입력 변환 helper
def session_from_frame(frame: pd.DataFrame, *, start_time_s: float, end_time_s: float | None = None,
                       session_id: str | None = None) -> dict:
    """FitRec V2 canonical 5초 행 DataFrame(한 세션) → Support/Query 세션 dict.

    필요한 열: segment_id, elapsed_s, hr_bpm, speed_mps, grade_observed_pct, hr_quality, speed_quality,
    grade_quality, hr_is_filled. start_time_s / end_time_s = 세션 메타의 start_time_utc / end_time_utc (UTC epoch 초).
    """
    f = frame.sort_values(["segment_id", "elapsed_s"], kind="stable")
    out = dict(session_id=str(session_id if session_id is not None else f.session_id.iloc[0]),
               start_time_s=float(start_time_s), elapsed_s=f.elapsed_s.to_numpy(np.float64),
               segment_id=f.segment_id.to_numpy(), hr=f.hr_bpm.to_numpy(np.float32),
               speed=f.speed_mps.to_numpy(np.float32), grade=f.grade_observed_pct.to_numpy(np.float32),
               hr_quality=f.hr_quality.astype(str).to_numpy(), speed_quality=f.speed_quality.astype(str).to_numpy(),
               grade_quality=f.grade_quality.astype(str).to_numpy(),
               hr_is_filled=f.hr_is_filled.astype(object).fillna(True).to_numpy(bool))
    if end_time_s is not None:
        out["end_time_s"] = float(end_time_s)
    return out


def query_batch_from_session(session: dict, t0_elapsed_s, *, future_speed=None, future_grade=None) -> dict:
    """세션 dict + t0 목록 → predict() batch. 창마다 세션 첫 행 ~ t0 행만 잘라 넣는다(t0 뒤 행은 batch에 없음).

    future_speed / future_grade [N, 24]를 안 주면 기록된 t0+5초 ~ t0+120초 속도·경사를 쓴다(Val·자가점검용;
    후보 pace 평가 때는 후보 계획을 넣는다).
    """
    r = session_rows(session["hr"], session["speed"], session["grade"], session["elapsed_s"],
                     session.get("segment_id"), hr_quality=session.get("hr_quality"),
                     speed_quality=session.get("speed_quality"), grade_quality=session.get("grade_quality"),
                     hr_is_filled=session.get("hr_is_filled"), name=str(session.get("session_id", "query")))
    t0s = np.atleast_1d(np.asarray(t0_elapsed_s, np.float64))
    keys = ("hr", "speed", "grade", "elapsed", "segment", "filled", "hr_quality", "speed_quality", "grade_quality")
    out = {k: [] for k in ("hr", "speed", "grade", "row_elapsed_s", "segment", "hr_is_filled", "hr_quality",
                           "speed_quality", "grade_quality")}
    fs, fg = [], []
    for t0 in t0s:
        hits = np.flatnonzero(r["elapsed"] == t0)
        if len(hits) != 1:
            raise ValueError(f"t0={t0}: found {len(hits)} rows with this elapsed_s")
        k = int(hits[0])
        for key, name in zip(keys, ("hr", "speed", "grade", "row_elapsed_s", "segment", "hr_is_filled",
                                    "hr_quality", "speed_quality", "grade_quality")):
            out[name].append(r[key][:k + 1].copy())
        future = np.arange(k + 1, k + C.FUTURE_STEPS + 1)
        if future_speed is None or future_grade is None:
            if future[-1] >= len(r["elapsed"]) or r["segment"][future[-1]] != r["segment"][k]:
                raise ValueError(f"t0={t0}: fewer than 24 recorded future rows in the segment; pass future_speed/grade")
        fs.append(r["speed"][future] if future_speed is None else None)
        fg.append(np.where(r["grade_valid"][future], r["grade"][future], np.nan) if future_grade is None else None)
    out["elapsed_s"] = t0s
    out["future_speed"] = np.asarray(fs, np.float32) if future_speed is None else np.asarray(future_speed, np.float32)
    out["future_grade"] = np.asarray(fg, np.float32) if future_grade is None else np.asarray(future_grade, np.float32)
    out["session_start_s"] = np.full(len(t0s), float(session["start_time_s"])) if "start_time_s" in session else None
    if out["session_start_s"] is None:
        del out["session_start_s"]
    return out


def _per_window(batch: dict, key: str, n: int, *, required: bool) -> list:
    x = batch.get(key)
    if x is None:
        if required:
            raise ValueError(f"batch['{key}'] is required")
        return [None] * n
    rows = list(x) if not (isinstance(x, np.ndarray) and x.ndim == 2) else [row for row in x]
    if len(rows) != n:
        raise ValueError(f"batch['{key}'] has {len(rows)} windows, expected {n} (= len(elapsed_s))")
    return rows


# ------------------------------------------------------------------------------------------------------- Predictor
class Predictor:
    """load → personalize(support) → predict(batch) → reset(). 상태는 객체 메모리에만 있다."""

    def __init__(self, checkpoint, *, device: str = "cpu", num_threads: int | None = None,
                 package_dir: str | Path | None = HERE):
        path = Path(checkpoint)
        if not path.is_file():
            raise FileNotFoundError(f"checkpoint not found: {path} (model weights are not in Git; download them from "
                                    "Hugging Face, see README 13 / config/final_checkpoint.json)")
        if num_threads:
            torch.set_num_threads(int(num_threads))
        self.device = torch.device(device)
        self.checkpoint_path = path.resolve()
        self.checkpoint_sha256 = file_sha256(path)
        ck = self._load_checkpoint(path, package_dir)
        mc = dict(ck["model_config"], session_mean=tuple(ck["model_config"]["session_mean"]),
                  session_std=tuple(ck["model_config"]["session_std"]))
        if mc["session_context_dim"] != len(SESSION_FEATURES):
            raise ValueError("this wrapper needs a Session Context checkpoint (session_context_dim = 10)")
        self.model_config = C.ModelConfig(**mc)
        self.run_config = ck["run_config"]
        self._check_code(ck["code_sha256"])
        self._factory = functools.partial(PersonalizedActionTransformer, ck["n_subjects"], self.model_config)
        self.model = self._factory()
        self.model.load_state_dict(ck["model_state"])
        self.model.to(self.device).eval()
        for p in self.model.parameters():
            p.requires_grad_(False)
        trained_rows = ck["trained_rows"]
        self.population_personal4 = personal4_init(self.model, rows=trained_rows).cpu()
        if not torch.allclose(self.population_personal4, ck["personal4_init"], atol=1e-6):
            raise ValueError("checkpoint Personal4 prior != mean of trained Personal4 rows")
        self.hr0_max_age = parse_hr0_policy(self.run_config["hr0_policy"])
        self.adapt_config = C.AdaptConfig(personal4_l2=float(self.run_config["personal4_l2"]))
        if ck["adapt_config"] is not None and ck["adapt_config"] != self.adapt_config.to_dict():
            raise ValueError("checkpoint adapt_config differs from the training adaptation setting")
        self.session_fill = np.asarray(mc["session_mean"], np.float32)
        self._population = self._local_model(self.population_personal4, trainable=False)
        self.shared_digest = state_digest(self.model)
        self.info = dict(checkpoint=str(self.checkpoint_path), checkpoint_sha256=self.checkpoint_sha256,
                         format=ck["format"], **ck["source"], n_subjects=ck["n_subjects"],
                         trained_personal4_rows=int(len(trained_rows)),
                         parameters=int(sum(p.numel() for p in self.model.parameters())),
                         model_config=self.model_config.to_dict(), session_features=list(SESSION_FEATURES),
                         hr0_policy=self.run_config["hr0_policy"], adapt_config=self.adapt_config.to_dict())
        if package_dir is not None:
            self._check_package(Path(package_dir))
        self._state = None
        self._local = None
        del ck

    # ---- 로드 검증 ----
    @staticmethod
    def _load_checkpoint(path: Path, package_dir) -> dict:
        """두 checkpoint 형식을 같은 dict로 읽는다.

        runway_hr_predictor_v1 (인계용 inference export, weights_only=True): 학습 checkpoint의 model state·Personal4
            학습 행·prior·model/adapt config·Session Context 통계만 남긴 파일. HR0 정책·학습 코드 SHA는 파일에 없어서
            config/model_config.json(같은 학습 checkpoint들에서 export)에서 읽는다.
        ptv2_stage3_ckpt_v1 (학습 checkpoint 원본): optimizer·RNG·numpy 배열 포함 → weights_only=False로만 읽힌다.
            출처가 확실한 파일만 넣을 것.
        """
        try:
            ck = torch.load(path, map_location="cpu", weights_only=True)
        except pickle.UnpicklingError:
            ck = torch.load(path, map_location="cpu", weights_only=False)
        fmt = ck.get("format")
        if fmt == EXPORT_FORMAT:
            if package_dir is None:
                raise ValueError(f"{EXPORT_FORMAT} needs the package config (config/model_config.json)")
            cfg = json.loads((Path(package_dir) / "config" / "model_config.json").read_text(encoding="utf-8"))
            stats = ck["session_train_stats"]
            if (list(ck["session_features"]) != list(SESSION_FEATURES)
                    or list(stats["mean"]) != list(ck["model_config"]["session_mean"])
                    or list(stats["std"]) != list(ck["model_config"]["session_std"])):
                raise ValueError("checkpoint session features / Train statistics are inconsistent")
            src = dict(ck["source"])
            return dict(format=fmt, model_config=ck["model_config"], model_state=ck["model_state"],
                        n_subjects=int(ck["n_subjects"]), trained_rows=np.asarray(ck["trained_rows"], np.int64),
                        personal4_init=torch.as_tensor(ck["personal4_init"]).float().cpu(),
                        run_config=dict(hr0_policy=cfg["training"]["hr0_policy"],
                                        personal4_l2=cfg["training"]["personal4_l2"], seed=src.get("seed")),
                        adapt_config=dict(ck["adapt_config"]), code_sha256=cfg["code_sha256"],
                        source=dict(model_id=ck.get("model_id"), seed=src.get("seed"), step=src.get("step"),
                                    best_personalized_val_mean_mae=src.get("best_personalized_val_mean_mae"),
                                    wandb_run_id=src.get("wandb_id"), source_checkpoint_sha256=src.get("sha256")))
        if fmt == CHECKPOINT_FORMAT:
            p4, manifests = ck["personal4"], ck.get("manifests", {})
            return dict(format=fmt, model_config=ck["model_config"], model_state=ck["model"],
                        n_subjects=int(p4["n_subjects"]), trained_rows=np.asarray(p4["trained_rows"], np.int64),
                        personal4_init=torch.as_tensor(p4["population_prior"]).float().cpu(),
                        run_config=dict(ck["run_config"]), adapt_config=None, code_sha256=ck.get("code_sha256", {}),
                        source=dict(seed=ck["run_config"].get("seed"), step=ck.get("step"),
                                    best_personalized_val_mean_mae=(ck.get("best") or {}).get("metric"),
                                    wandb_run_id=ck.get("wandb_run_id"), split_sha256=manifests.get("split_sha256"),
                                    train_cache_content_hash=manifests.get("cache_content_hash")))
        raise ValueError(f"unexpected checkpoint format {fmt!r}, expected {EXPORT_FORMAT} or {CHECKPOINT_FORMAT}")

    def _check_code(self, code_sha: dict) -> None:
        """ptv2/ 파일이 체크포인트를 만든 코드와 같은지(code_sha256) 확인."""
        bad = [f for f in VENDORED if f in code_sha and file_sha256(HERE / "ptv2" / f) != code_sha[f]]
        missing = [f for f in VENDORED if f not in code_sha]
        if bad or missing:
            raise ValueError(f"ptv2 code differs from the checkpoint's training code: changed={bad} unknown={missing}")

    def _check_package(self, package_dir: Path) -> None:
        """config/model_config.json · artifacts/session_context_stats.json이 있으면 체크포인트와 같은지 확인."""
        cfg_path = package_dir / "config" / "model_config.json"
        if cfg_path.is_file():
            cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
            if cfg.get("model_config") != json.loads(json.dumps(self.model_config.to_dict())):
                raise ValueError(f"{cfg_path} model_config differs from the checkpoint")
        stats_path = package_dir / "artifacts" / "session_context_stats.json"
        if stats_path.is_file():
            stats = json.loads(stats_path.read_text(encoding="utf-8"))["train_statistics"]
            if (stats["features"] != list(SESSION_FEATURES)
                    or not np.array_equal(np.asarray(stats["mean"], np.float32), self.model.session_mean.cpu().numpy())
                    or not np.array_equal(np.asarray(stats["std"], np.float32), self.model.session_std.cpu().numpy())):
                raise ValueError(f"{stats_path} differs from the checkpoint's session_mean / session_std buffers")

    def _local_model(self, personal4: torch.Tensor, *, trainable: bool):
        local = local_personal4_model(self._factory, self.model, personal4, self.device)
        if not trainable:
            for p in local.parameters():
                p.requires_grad_(False)
        return local

    def verify_shared_unchanged(self) -> None:
        if state_digest(self.model) != self.shared_digest:
            raise AssertionError("shared model weights changed")

    # ---- 개인화 상태 ----
    @property
    def is_personalized(self) -> bool:
        return self._state is not None

    def personal4(self) -> np.ndarray:
        """지금 predict()가 쓰는 Personal4 [4] (개인화 전/후 = population prior / 적응값)."""
        if self._state is None:
            return self.population_personal4.numpy().copy()
        return self._local.personalization.subject_embedding.weight.detach().cpu().reshape(-1).numpy().copy()

    def state_summary(self) -> dict:
        if self._state is None:
            return dict(personalized=False, personal4=self.personal4().tolist())
        s = self._state
        return dict(personalized=True, user_id=s["user_id"], personal4=self.personal4().tolist(),
                    support_sessions=len(s["workouts"]), history_rows=int(sum(len(w["rows"]) for w in s["workouts"])),
                    **s["adaptation"])

    def personalize(self, support_sessions: list, *, user_id: str | None = None) -> dict:
        """사용자 1명의 Support 세션으로 개인화한다. 이전 상태는 먼저 버린다(reset).

        바뀌는 것: 이 객체 안의 Personal4 1행(적응) + History8 원천(Support 10초 행). 공유 weight는 안 바뀐다.
        """
        self.reset()
        sessions = []
        for i, s in enumerate(support_sessions):
            name = str(s.get("session_id", f"support_{i}"))
            if "start_time_s" not in s:
                raise ValueError(f"{name}: start_time_s (UTC epoch s) is required")
            r = session_rows(s["hr"], s["speed"], s["grade"], s["elapsed_s"], s.get("segment_id"),
                             hr_quality=s.get("hr_quality"), speed_quality=s.get("speed_quality"),
                             grade_quality=s.get("grade_quality"), hr_is_filled=s.get("hr_is_filled"), name=name)
            start = float(s["start_time_s"])
            if "end_time_s" in s:
                end = float(s["end_time_s"])
            elif "duration_s" in s:
                end = start + float(s["duration_s"])
            else:
                raise ValueError(f"{name}: end_time_s or duration_s is required (History uses only finished sessions)")
            sessions.append(dict(session_id=name, start_s=start, end_s=end, rows=r))
        sessions.sort(key=lambda x: (x["start_s"], x["session_id"]))
        workouts = [dict(session_id=s["session_id"], start_s=s["start_s"], end_s=s["end_s"],
                         rows=_history_rows(s["rows"])) for s in sessions]
        limit = self.adapt_config.steps * self.adapt_config.batch_size
        items = []
        for s in sessions:
            if len(items) >= limit:
                break
            ks = _support_t0_rows(s["rows"], self.hr0_max_age)
            if not len(ks):
                continue
            history = _history_for(workouts, s["start_s"])
            summary = _session_summary(s["rows"], ks, self.session_fill)
            for j, k in enumerate(ks):
                item = _window_item(s["rows"], int(k), window_id=f"{s['session_id']}@{int(s['rows']['elapsed'][k])}",
                                    history=history, with_target=True)
                item["session_summary"] = summary[j]
                items.append(item)
        items = items[:limit]
        local = self._local_model(self.population_personal4, trainable=True)
        batches = [self._collate(items[i:i + self.adapt_config.batch_size])
                   for i in range(0, len(items), self.adapt_config.batch_size)]
        log = adapt_personal4(local, batches, self.adapt_config)
        for p in local.parameters():
            p.requires_grad_(False)
        local.eval()
        self.verify_shared_unchanged()
        shift = float((local.personalization.subject_embedding.weight.detach().cpu().reshape(-1)
                       - self.population_personal4).norm())
        self._local = local
        self._state = dict(user_id=user_id, workouts=workouts, adaptation=dict(
            support_windows=len(items), updates=log["updates"],
            loss_first=log["losses"][0] if log["losses"] else None,
            loss_last=log["losses"][-1] if log["losses"] else None, personal4_shift=shift))
        return self.state_summary()

    def reset(self) -> None:
        """사용자 상태를 지운다 → population(Cold-start) 상태. 다음 사용자 전에 반드시 호출."""
        self._state = None
        self._local = None

    def save_state(self, path) -> Path:
        """(선택) 개인화 결과를 JSON으로 저장. 체크포인트 파일·checkpoints/ 폴더에는 쓰지 않는다."""
        if self._state is None:
            raise ValueError("nothing to save: call personalize() first")
        path = Path(path).resolve()
        if path == self.checkpoint_path or self.checkpoint_path.parent in path.parents or path.suffix == ".pt":
            raise ValueError("refusing to write user state next to / over the checkpoint")
        payload = dict(format=STATE_FORMAT, checkpoint_sha256=self.checkpoint_sha256, user_id=self._state["user_id"],
                       personal4=[float(x) for x in self.personal4()], adaptation=self._state["adaptation"],
                       workouts=[dict(session_id=w["session_id"], start_s=w["start_s"], end_s=w["end_s"],
                                      rows=w["rows"].tolist()) for w in self._state["workouts"]])
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(payload), encoding="utf-8")
        return path

    def load_state(self, path) -> dict:
        payload = json.loads(Path(path).read_text(encoding="utf-8"))
        if payload.get("format") != STATE_FORMAT or payload.get("checkpoint_sha256") != self.checkpoint_sha256:
            raise ValueError("state file was made with another format or checkpoint")
        self.reset()
        self._local = self._local_model(torch.tensor(payload["personal4"], dtype=torch.float32), trainable=False)
        self._local.eval()
        workouts = [dict(session_id=w["session_id"], start_s=float(w["start_s"]), end_s=float(w["end_s"]),
                         rows=np.asarray(w["rows"], np.float32).reshape(-1, C.HISTORY_FEATURE_DIM - 1))
                    for w in payload["workouts"]]
        self._state = dict(user_id=payload["user_id"], workouts=workouts, adaptation=payload["adaptation"])
        return self.state_summary()

    # ---- 예측 (read-only) ----
    def predict(self, batch: dict, personalized: bool = True) -> np.ndarray:
        """[N, 3] float64 = [HR@30, HR@60, HR@120] (bpm). 상태를 읽기만 한다(Query로 아무것도 갱신하지 않음).

        personalized=False 또는 personalize() 전 → population (Personal4 prior, History sentinel).
        """
        use_state = personalized and self._state is not None
        model_batch = self.build_model_batch(batch, personalized=use_state)
        net = self._local if use_state else self._population
        with torch.inference_mode():
            heart_rate = net(model_batch)["heart_rate"]
        return heart_rate[:, OUTPUT_INDEX].double().cpu().numpy()

    def build_model_batch(self, batch: dict, *, personalized: bool) -> dict:
        """predict() batch → ptv2 모델 batch (검증 포함)."""
        if "elapsed_s" not in batch:
            raise ValueError("batch['elapsed_s'] (t0 elapsed seconds, [N]) is required")
        t0s = np.atleast_1d(np.asarray(batch["elapsed_s"], np.float64))
        n = len(t0s)
        if n == 0:
            raise ValueError("empty batch")
        dense = {k: isinstance(batch.get(k), np.ndarray) and batch[k].ndim == 2 for k in ("hr", "speed", "grade")}
        hr, speed, grade = (_per_window(batch, k, n, required=True) for k in ("hr", "speed", "grade"))
        optional = {k: _per_window(batch, k, n, required=False) for k in
                    ("row_elapsed_s", "segment", "hr_is_filled", "hr_quality", "speed_quality", "grade_quality")}
        fs = np.asarray(batch.get("future_speed"), np.float32) if batch.get("future_speed") is not None else None
        fg = np.asarray(batch.get("future_grade"), np.float32) if batch.get("future_grade") is not None else None
        for key, value in (("future_speed", fs), ("future_grade", fg)):
            if value is None:
                raise ValueError(f"batch['{key}'] [N, 24] is required")
            if value.shape != (n, C.FUTURE_STEPS):
                raise ValueError(f"batch['{key}'] has shape {value.shape}, expected ({n}, {C.FUTURE_STEPS})")
        if not np.isfinite(fs).all():
            raise ValueError("future_speed has NaN/Inf")
        if not np.isfinite(fg).all():
            raise ValueError("future_grade has NaN/Inf: this model has no trained missing-grade policy; "
                             "T4 (future grade unknown) must pass 0.0 (flat) explicitly — see README 11")
        starts = None
        if personalized:
            if batch.get("session_start_s") is None:
                raise ValueError("personalized predict needs batch['session_start_s'] [N] (Query session start, "
                                 "UTC epoch s): History uses only Support sessions finished before it")
            starts = np.asarray(batch["session_start_s"], np.float64).reshape(-1)
            if starts.shape != (n,) or not np.isfinite(starts).all():
                raise ValueError(f"session_start_s must be {n} finite values")
        items, summaries = [], []
        history_cache = {}
        for i in range(n):
            arrays = [np.asarray(hr[i], np.float32), np.asarray(speed[i], np.float32), np.asarray(grade[i], np.float32)]
            extra = {k: (None if v[i] is None else np.asarray(v[i])) for k, v in optional.items()}
            if any(a.ndim != 1 or len(a) != len(arrays[0]) for a in arrays):
                raise ValueError(f"window {i}: hr / speed / grade must be 1-D with the same length")
            if any(dense.values()):  # [N, L] 입력의 앞쪽 NaN 채움 칸 제거
                lead = int(np.argmax(np.isfinite(np.vstack(arrays)).any(axis=0)))
                arrays = [a[lead:] for a in arrays]
                extra = {k: (None if v is None else v[lead:]) for k, v in extra.items()}
            L = len(arrays[0])
            if L < C.PAST_STEPS:
                raise ValueError(f"window {i}: needs >= {C.PAST_STEPS} rows (session start .. t0), got {L}")
            if extra["row_elapsed_s"] is None:
                row_elapsed = t0s[i] - C.GRID_S * np.arange(L - 1, -1, -1, dtype=np.float64)
            else:
                row_elapsed = np.asarray(extra["row_elapsed_s"], np.float64)
            r = session_rows(*arrays, row_elapsed, extra["segment"], hr_quality=extra["hr_quality"],
                             speed_quality=extra["speed_quality"], grade_quality=extra["grade_quality"],
                             hr_is_filled=extra["hr_is_filled"], name=f"window {i}")
            k = L - 1
            if r["elapsed"][k] != t0s[i]:
                raise ValueError(f"window {i}: the last row (t0) must have elapsed_s == {t0s[i]}")
            _, local, _ = _segment_index(r)
            if local[k] < C.PAST_STEPS - 1:
                raise ValueError(f"window {i}: t0 needs 24 contiguous rows in its own segment")
            past = np.arange(k - C.PAST_STEPS + 1, k + 1)
            if not (r["hr_valid"][past] & r["speed_valid"][past] & r["grade_valid"][past]).all():
                raise ValueError(f"window {i}: past 24 rows need valid HR, speed and grade (training window rule)")
            if personalized:
                key = float(starts[i])
                if key not in history_cache:
                    history_cache[key] = _history_for(self._state["workouts"], key)
                history = history_cache[key]
            else:
                history = NO_HISTORY.copy()
            future_vertical = vertical_speed_proxy(fs[i], fg[i], np.ones(C.FUTURE_STEPS, bool),
                                                   np.ones(C.FUTURE_STEPS, bool))
            future_time = (t0s[i] + C.GRID_S * np.arange(1, C.FUTURE_STEPS + 1)) / C.TIME_SCALE_S
            items.append(_window_item(r, k, window_id=f"query@{i}", history=history,
                                      future_action=np.column_stack((fs[i], future_vertical)), future_time=future_time))
            summaries.append(_session_summary(r, [k], self.session_fill)[0])
        for item, summary in zip(items, summaries):
            item["session_summary"] = summary
        return self._collate(items)

    def _collate(self, items: list) -> dict:
        batch = collate_windows(items)
        batch["session_summary"] = torch.from_numpy(np.stack([item["session_summary"] for item in items]))
        batch.pop("window_id")
        check_batch(batch)
        return move_batch(batch, self.device)


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description="Load the checkpoint, verify the package and print the model summary.")
    ap.add_argument("--checkpoint", required=True)
    ap.add_argument("--device", default="cpu")
    args = ap.parse_args(argv)
    p = Predictor(args.checkpoint, device=args.device)
    print(json.dumps(p.info, indent=1, default=str))
    print("package check OK (ptv2 code_sha256, config/model_config.json, artifacts/session_context_stats.json)")


if __name__ == "__main__":
    main()
