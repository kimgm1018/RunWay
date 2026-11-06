"""합성 러너로 AI04(run_decide)를 5초마다 돌려 안내가 어떻게 바뀌는지 본다(S15P31E105-506, 인계 I-23).

러너는 워치에 적용된 안내 페이스를 그대로 따라 뛴다. 심박은 합성 모델이다.
  - 정상 상태 심박 = 158 + GAIN·(속도 − 5:30 속도)(m/s) + 2.5·경사(%) + drift·분. 5:30/km 평지면 158 bpm이다.
    GAIN 기본 30 bpm/(m/s). --speed-gain 25면 5:30에서 60초/km 감속이 2분 뒤 −11 bpm(팀 실측과 같음)이다.
  - 실제 심박은 정상 상태를 시간 상수 TAU_SEC로 늦게 따라간다(페이스를 늦춰도 1~2분에 걸쳐 내려온다).
백엔드는 이렇게 흉내 낸다.
  - 안내와 5초/km 이상 다른 판단만, 마지막 발행 뒤 30초가 지났을 때 보낸다(첫 EASE_OFF는 바로).
  - 보낸 코칭은 바로 워치에 적용되고, 다음 요청의 lastCoaching.appliedAt가 된다. guidePaceSetAt는 보내지 않는다(지금 백엔드와 같음).
세 가지로 돌린다: no_last_coaching(lastCoaching 없음 → 쿨다운 꺼짐), last_coaching(지금 백엔드처럼 lastCoaching만),
guide_set_at(백엔드가 guidePaceSetAt = 안내 페이스가 마지막으로 바뀐 시각도 보냄. 단계만 바뀐 발행은 이 시각을 바꾸지 않는다).
수정 전 정책과 비교하려면 그 버전의 ai/service(예: git archive로 꺼낸 사본)에 이 파일을 복사해 돌린다.

예측기: gru(서비스와 같은 GRU, models/gru_final.pt 필요) 또는 synthetic(위 심박 모델을 아는 예측기, drift는 모름).
숫자는 방향을 보는 용도다. 개인 데이터는 쓰지 않는다.

사용법 (ai/service에서):
    python tools/simulate_hr_loop.py --scenario flat_drift --predictor synthetic
"""
import argparse
import math
import os
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

SERVICE_DIR = Path(__file__).resolve().parents[1]
if str(SERVICE_DIR) not in sys.path:
    sys.path.insert(0, str(SERVICE_DIR))

from app.decide.schemas import DecideRequest  # noqa: E402
from app.decide.service import run_decide  # noqa: E402
from app.models.base import ModelInfo  # noqa: E402

STEP_SEC = 5
TAU_SEC = 40.0
GOAL_PACE = 330.0
DELTAS = (-10, -5, 0, 5, 10)
START = datetime(2026, 11, 6, 0, 0, tzinfo=timezone.utc)
SCENARIOS = {
    # 인계 sim c와 같은 모양: 평지, 시간이 갈수록 심박이 오른다(심박 drift). 경사 정보 없음(자유 러닝).
    "flat_drift": {"minutes": 15, "drift_per_min": 0.6, "hill": None, "grade_known": False},
    # 인계 sim f와 같은 모양: 700~1300 m 오르막 6%, 그 뒤 평지. 코스라 미래 경사를 안다.
    "hill": {"minutes": 15, "drift_per_min": 0.0, "hill": (700.0, 1300.0, 6.0), "grade_known": True},
    # 안내를 따르지 않는 러너: 늘 5:30으로 달리고 심박이 오른다. 안내만 계속 느려지는지 본다.
    "ignore": {"minutes": 15, "drift_per_min": 1.5, "hill": None, "grade_known": False, "follows": False},
}


GAIN = 30.0


def steady_hr(speed, grade, minute, drift):
    return 158.0 + GAIN * (speed - 1000.0 / 330.0) + 2.5 * grade + drift * minute


def grade_at(sc, distance_m):
    hill = sc["hill"]
    return hill[2] if hill and hill[0] <= distance_m < hill[1] else 0.0


class SyntheticPredictor:
    """합성 심박 모델을 아는 예측기. 지금 심박에서 후보 속도의 정상 상태로 TAU_SEC로 다가간다. drift는 지금 값에 고정."""
    info = ModelInfo(model_type="synthetic", model_version="sim-1", window_sec=360, min_samples=1)

    def __init__(self):
        self.minute, self.drift = 0.0, 0.0

    def predict(self, batch):
        hr_now = batch["hr"][:, -1]
        speed = batch["future_speed"].mean(axis=1)
        future_grade = batch.get("future_grade")
        grade = (np.zeros_like(speed) if future_grade is None
                 else np.nan_to_num(np.asarray(future_grade, dtype=float)).mean(axis=1))
        out = []
        for h in (30, 60, 120):
            ss = 158.0 + GAIN * (speed - 1000.0 / 330.0) + 2.5 * grade + self.drift * self.minute
            out.append(ss + (hr_now - ss) * math.exp(-h / TAU_SEC))
        return np.stack(out, axis=1)


def simulate(sc, mode, model, policy):
    n_cells = model.info.window_sec // STEP_SEC + 12
    guide, last_applied, last_publish, eased = GOAL_PACE, None, None, False
    speed = 1000.0 / guide
    hr = steady_hr(speed, 0.0, 0.0, sc["drift_per_min"])
    cells = [(hr, speed, 0.0)] * n_cells                 # 출발 전 6분은 같은 페이스로 뛰었다고 둔다
    distance, published, timeline = 0.0, [], []
    allow, over_sec, max_hr, slowest, danger = None, 0, hr, guide, 0
    last_level, level_msgs, guide_changed = "OK", 0, None
    for t in range(1, sc["minutes"] * 60 + 1):
        speed = 1000.0 / (guide if sc.get("follows", True) else GOAL_PACE)
        grade = grade_at(sc, distance)
        distance += speed
        ss = steady_hr(speed, grade, t / 60.0, sc["drift_per_min"])
        hr += (ss - hr) * (1.0 - math.exp(-1.0 / TAU_SEC))
        max_hr = max(max_hr, hr)
        if allow is not None and hr >= allow:
            over_sec += 1
        if t % STEP_SEC:
            continue
        cells = cells[1:] + [(hr, speed, grade)]
        now = START + timedelta(seconds=t)
        if isinstance(model, SyntheticPredictor):
            model.minute, model.drift = t / 60.0, sc["drift_per_min"]
        candidates = []
        for d in DELTAS:
            pace = guide + d
            future = None
            if sc["grade_known"]:
                future = [grade_at(sc, distance + 1000.0 / pace * STEP_SEC * k) for k in range(1, 25)]
            candidates.append({"paceSecPerKm": pace, "futureSpeedMps": [1000.0 / pace] * 24, "futureGradePct": future})
        body = {
            "elapsedSec": float(t),
            "history": {"hrBpm": [c[0] for c in cells], "speedMps": [c[1] for c in cells],
                        "gradePct": [c[2] for c in cells]},
            "candidates": candidates,
            "context": {
                "sessionId": 1, "stateVersion": 1, "runState": "RUNNING",
                "mode": "COURSE" if sc["grade_known"] else "FREE",
                "goal": {"targetDistanceM": None, "targetDurationSec": None, "targetPaceSecPerKm": GOAL_PACE},
                "goalPreference": 0.5, "plan": None, "anchorPaceSecPerKm": guide,
                "currentGuidePaceSecPerKm": guide, "activeSec": float(t),
                "guidePaceSetAt": (guide_changed.isoformat()
                                   if mode == "guide_set_at" and guide_changed is not None else None),
                "distanceM": distance, "routeProgressM": distance if sc["grade_known"] else None,
                "inputAsOf": now.isoformat(), "resumedAt": None,
                "lastCoaching": ({"coachingId": len(published), "appliedAt": last_applied.isoformat()}
                                 if mode in ("last_coaching", "guide_set_at") and last_applied is not None else None),
            },
        }
        outcome = run_decide(DecideRequest.model_validate(body), model, policy, received_at=now, now=lambda: now)
        decision = outcome.response.decision
        if outcome.policy is not None and outcome.policy.allow_bpm is not None:
            allow = outcome.policy.allow_bpm
        if decision is None:
            continue
        pace = decision.recommended_pace_sec_per_km
        first_ease = decision.action == "EASE_OFF" and not eased
        due = last_publish is None or (now - last_publish).total_seconds() >= 30 or first_ease
        if abs(pace - guide) >= 5 and due:
            published.append((t, decision.reason, guide, pace))
            guide, last_applied, last_publish, guide_changed = pace, now, now, now
            slowest = max(slowest, guide)
            danger += decision.coaching_level == "DANGER"
            eased = eased or decision.action == "EASE_OFF"
            last_level = decision.coaching_level
        elif decision.coaching_level != last_level and due:
            # S15P31E105-503: 페이스가 같아도 코칭 단계가 바뀌면 백엔드가 발행한다(같은 안내를 다시 알림).
            level_msgs += 1
            last_applied, last_publish, last_level = now, now, decision.coaching_level
            danger += decision.coaching_level == "DANGER"
        if t % 60 == 0:
            timeline.append((t // 60, round(hr, 1), guide, decision.reason, decision.coaching_level))
    stats = {"over_allow_sec": over_sec, "max_hr": round(max_hr, 1), "slowest": slowest, "danger_msgs": danger,
             "allow": allow, "level_msgs": level_msgs}
    return published, timeline, hr, stats


def fmt(pace):
    return f"{int(pace // 60)}:{int(round(pace % 60)):02d}"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scenario", choices=sorted(SCENARIOS), required=True)
    parser.add_argument("--predictor", choices=("gru", "synthetic"), default="synthetic")
    parser.add_argument("--drift", type=float, default=None, help="심박 drift(bpm/분). 없으면 시나리오 값")
    parser.add_argument("--speed-gain", type=float, default=30.0, help="합성 러너 심박의 속도 기울기 bpm/(m/s)")
    args = parser.parse_args()
    global GAIN
    GAIN = args.speed_gain
    from app.main import default_policy_loader
    policy = default_policy_loader()
    if args.predictor == "gru":
        from tools.replay_cue_bpm import gru_sha_from_manifest
        if not os.getenv("HR_MODEL_SHA256") and gru_sha_from_manifest():
            os.environ["HR_MODEL_SHA256"] = gru_sha_from_manifest()
        from app.main import default_loader
        model = default_loader()
    else:
        model = SyntheticPredictor()
    sc = dict(SCENARIOS[args.scenario])
    if args.drift is not None:
        sc["drift_per_min"] = args.drift
    print(f"scenario={args.scenario} drift={sc['drift_per_min']} predictor={args.predictor} policy={policy.policy_version}")
    for mode in ("no_last_coaching", "last_coaching", "guide_set_at"):
        published, timeline, hr_end, st = simulate(sc, mode, model, policy)
        reasons = Counter(r for _, r, _, _ in published)
        print(f"\n[{mode}] 발행 {len(published)}회 {dict(reasons)} + 단계 변경 {st['level_msgs']}회 | 허용선({st['allow']:.0f}) 넘은 시간 {st['over_allow_sec']}초"
              f" | 최고 심박 {st['max_hr']} | 가장 느린 안내 {fmt(st['slowest'])} | DANGER {st['danger_msgs']}회"
              f" | 마지막 안내 {fmt(timeline[-1][2])} | 마지막 심박 {hr_end:.1f}")
        print("  분  심박   안내   reason          level")
        for minute, h, g, reason, level in timeline:
            print(f"  {minute:>2}  {h:5.1f}  {fmt(g)}  {reason or '-':<15} {level or '-'}")


if __name__ == "__main__":
    main()
