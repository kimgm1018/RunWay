"""예측 상한, 허용선, 목표 추종으로 pace 후보를 고른다."""
import math
from dataclasses import dataclass, replace
from datetime import datetime

from app.decide.policy_port import CandidateVerdict, PolicyInput, PolicyOutput
from app.decide.schemas import DecideContext
from app.policy.config import PolicyConfig
from app.policy.detectors import detect
from app.policy.hr_reference import HrThresholds, blend_hr_thresholds
from app.policy.residual_margin import MarginTable


@dataclass(frozen=True)
class Progress:
    p: float
    pace_req_sec_per_km: float | None
    budget_sec: float | None
    remaining_m: float | None
    eta_sec: float | None
    eta_minus_goal_sec: float | None
    goal_unreachable: bool
    distance_goal: bool


def _ratio_at(ctx: DecideContext) -> float:
    if not ctx.plan:
        return 1.0
    for segment in ctx.plan:
        if segment.start_m <= ctx.distance_m < segment.end_m:
            return segment.ratio
    return ctx.plan[-1].ratio


def progress(ctx: DecideContext, pace_now_sec_per_km: float | None, cfg: PolicyConfig) -> Progress:
    goal = ctx.goal
    distance = goal.target_distance_m
    duration = goal.target_duration_sec
    target_pace = goal.target_pace_sec_per_km
    if distance is not None and duration is None and target_pace is not None:
        duration = target_pace * distance / 1000.0
    p = 0.0
    pace_req = None
    budget = None
    remaining = None
    eta = None
    eta_minus = None
    distance_goal = distance is not None
    goal_unreachable = False
    ratio = _ratio_at(ctx)
    if distance is not None:
        remaining = max(0.0, distance - ctx.distance_m)
        p = min(1.0, max(0.0, ctx.distance_m / distance)) if distance > 0 else 0.0
        if duration is not None:
            budget = duration - ctx.active_sec
            if remaining > 0 and budget > 0:
                if ctx.plan:
                    weighted_km = 0.0
                    for segment in ctx.plan:
                        lo = max(ctx.distance_m, segment.start_m)
                        hi = min(distance, segment.end_m)
                        if hi > lo:
                            weighted_km += (hi - lo) / 1000.0 * segment.ratio
                    if weighted_km > 0:
                        pace_req = budget / weighted_km * ratio
                else:
                    pace_req = budget / (remaining / 1000.0)
            goal_unreachable = budget <= 0 or (pace_req is not None and pace_req < ctx.anchor_pace_sec_per_km - cfg.chase_limit_sec_per_km)
            phase, _ = handover_phase(ctx.active_sec, cfg)
            if ctx.plan and phase in ("PLAN_HOLD", "PLAN_BLEND"):
                goal_unreachable = False
        elif target_pace is not None and remaining > 0:
            pace_req = target_pace * ratio
        if pace_now_sec_per_km is not None:
            eta = ctx.active_sec + (remaining / 1000.0) * pace_now_sec_per_km
            if duration is not None:
                eta_minus = eta - duration
    elif duration is not None:
        p = min(1.0, max(0.0, ctx.active_sec / duration)) if duration > 0 else 0.0
    elif target_pace is not None:
        pace_req = target_pace * ratio
    return Progress(p, pace_req, budget, remaining, eta, eta_minus, goal_unreachable, distance_goal)


def allow_at(p: float, ref: HrThresholds, cfg: PolicyConfig) -> float:
    x = min(1.0, max(0.0, (p - cfg.p0) / (1.0 - cfg.p0)))
    smooth = 3.0 * x * x - 2.0 * x * x * x
    return ref.sustain_bpm + smooth * (ref.danger_bpm - ref.sustain_bpm)


def _mean(values: tuple[float | None, ...] | None) -> float | None:
    if values is None or not values or any(v is None for v in values):
        return None
    return sum(values) / len(values)


def _round_int(value: float | None) -> int | str:
    if value is None:
        return "—"
    return math.floor(value + 0.5) if value >= 0 else math.ceil(value - 0.5)


def handover_phase(active_sec: float, cfg: PolicyConfig) -> tuple[str | None, float | None]:
    """러닝 초반 계획 비중 w. 계획 유지(w=1) → 선형으로 넘겨주기 → MPC 단독(w=0). 0, 0이면 꺼짐(None)."""
    hold, end = cfg.plan_hold_sec, cfg.plan_blend_end_sec
    if end <= 0:
        return None, None
    if active_sec < hold:
        return "PLAN_HOLD", 1.0
    if active_sec < end:
        return "PLAN_BLEND", 1.0 - (active_sec - hold) / (end - hold)
    return "MPC", 0.0


def plan_pace(ctx: DecideContext, prog: Progress) -> float:
    """계획 구간 목표 pace. 계획·목표가 없거나 목표에 닿을 수 없으면 현재 안내 pace(없으면 anchor)를 유지한다."""
    if ctx.plan and prog.pace_req_sec_per_km is not None and not prog.goal_unreachable:
        return prog.pace_req_sec_per_km
    guide = ctx.current_guide_pace_sec_per_km
    return guide if guide is not None else ctx.anchor_pace_sec_per_km


class MpcPolicy:
    """MPC 정책 v0.4 구현."""
    def __init__(self, cfg: PolicyConfig, margins: MarginTable):
        self.cfg = cfg
        self.margins = margins
        self.policy_version = cfg.policy_version
        self.input_insufficient_sec = cfg.input_insufficient_sec
        self.margin_table_version = margins.version

    def _base_output(self, *, status: str, action: str, chosen: int | None, pace: float | None,
                     reason: str | None, reason_text: str | None, gate: str | None,
                     verdicts: tuple[CandidateVerdict, ...], publish: bool, ref: HrThresholds | None = None,
                     allow: float | None = None, hard_eff: float | None = None, actual_minus: float | None = None,
                     prog: Progress | None = None, warnings: tuple[str, ...] = ()) -> PolicyOutput:
        return PolicyOutput(
            status=status, action=action, chosen_index=chosen, recommended_pace_sec_per_km=pace,
            reason=reason, reason_text=reason_text, gate=gate, verdicts=verdicts, publish_suggested=publish,
            allow_bpm=allow, hard_eff_bpm=hard_eff,
            hr_danger_bpm=ref.danger_bpm if ref else None,
            hr_sustain_bpm=ref.sustain_bpm if ref else None,
            hr_threshold_source=ref.source if ref else None,
            hr_threshold_weight=ref.weight if ref else None,
            margin_table_version=self.margins.version,
            actual_minus_guide_sec_per_km=actual_minus,
            eta_sec=prog.eta_sec if prog else None,
            eta_minus_goal_sec=prog.eta_minus_goal_sec if prog else None,
            warnings=warnings,
        )

    def decide(self, inp: PolicyInput) -> PolicyOutput:
        ctx = inp.context
        if inp.speed_now_mps is None or inp.speed_now_mps < self.cfg.walk_speed_mps:
            return self._base_output(status="NOT_RUNNING", action="NOT_RUNNING", chosen=None, pace=None,
                                     reason=None, reason_text=None, gate=None, verdicts=(), publish=False)
        stale = inp.input_age_sec > self.cfg.hr_stale_sec
        ref = inp.hr_thresholds or blend_hr_thresholds(self.cfg)
        prog = progress(ctx, inp.pace_now_sec_per_km, self.cfg)
        phase, plan_weight = handover_phase(ctx.active_sec, self.cfg)
        speeds = [c.future_speed_mps for c in inp.candidates]
        mean_past = None
        past_speeds = [speed for _, speed in inp.recent_cells[-6:]]
        if len(past_speeds) == 6 and all(v is not None for v in past_speeds):
            mean_past = sum(past_speeds) / 6.0
        upper_by_candidate: list[tuple[float | None, float | None, float | None]] = []
        peaks: list[float | None] = []
        allow_by_candidate: list[float] = []
        hard_by_candidate: list[float] = []
        sprint: list[bool] = []
        grade_unknown = False
        for candidate in inp.candidates:
            remaining = prog.remaining_m
            is_sprint = (prog.distance_goal and remaining is not None and remaining <= self.cfg.sprint_m
                         and candidate.future_speed_mps * 120.0 >= remaining)
            sprint.append(is_sprint)
            # 옛 정책: 마지막 400 m는 허용선 = hard, 안전 한계 = HRmax.
            # v0.4: HRmax가 없어져 안전 한계만 위험 기준 + final_stretch_extra_bpm으로 바꾼다. 허용선은 위험 기준 그대로.
            hard_eff = (ref.danger_bpm + self.cfg.final_stretch_extra_bpm
                        if is_sprint else ref.danger_bpm)
            allow = ref.danger_bpm if is_sprint else allow_at(prog.p, ref, self.cfg)
            allow_by_candidate.append(allow)
            hard_by_candidate.append(hard_eff)
            dspeed = candidate.future_speed_mps - mean_past if mean_past is not None else None
            mean_grade = _mean(candidate.future_grade_pct)
            if mean_grade is None:
                grade_unknown = True
            upper = []
            for h, prediction in zip((30, 60, 120), candidate.pred_hr_bpm):
                if is_sprint and remaining is not None and candidate.future_speed_mps * h > remaining:
                    upper.append(None)
                else:
                    upper.append(prediction + self.margins.margin(h, dspeed, mean_grade))
            upper_tuple = tuple(upper)
            upper_by_candidate.append(upper_tuple)
            known = [v for v in upper_tuple if v is not None]
            peaks.append(max(known) if known else None)

        baseline_peak = peaks[2] if len(peaks) > 2 else None
        baseline_allow = allow_by_candidate[2] if allow_by_candidate else allow_at(prog.p, ref, self.cfg)
        baseline_hard = hard_by_candidate[2] if hard_by_candidate else ref.danger_bpm
        safety = ((inp.hr_now_bpm is not None and inp.hr_now_bpm >= baseline_hard)
                  or (baseline_peak is not None and baseline_peak >= baseline_hard))
        guide = ctx.current_guide_pace_sec_per_km
        warnings = list(detect(inp.recent_cells, guide_pace_sec_per_km=guide, allow_bpm=baseline_allow,
                               hr_now_bpm=inp.hr_now_bpm, cfg=self.cfg))
        if grade_unknown:
            warnings.append("GRADE_UNKNOWN")
        actual_minus = (inp.pace_now_sec_per_km - guide
                        if inp.pace_now_sec_per_km is not None and guide is not None else None)
        if safety:
            base_pace = inp.pace_now_sec_per_km if inp.pace_now_sec_per_km is not None else ctx.anchor_pace_sec_per_km
            recommended = base_pace + self.cfg.ease_off_sec_per_km
            if guide is not None and guide >= base_pace + self.cfg.ease_off_sec_per_km:
                warnings.append("WALK_ADVISED")
            verdicts = tuple(CandidateVerdict(upper_hr_bpm=u, peak_upper_bpm=p, passed=False,
                                               reject_reason="SAFETY", score=None)
                             for u, p in zip(upper_by_candidate, peaks))
            peak_display = max(inp.hr_now_bpm or -math.inf, baseline_peak or -math.inf)
            reason_text = (f"심박 상한 {_round_int(peak_display)} ≥ 힘든 선 {_round_int(baseline_hard)}. "
                           f"{_round_int(self.cfg.ease_off_sec_per_km)}초 느리게")
            output = self._base_output(status="SAFETY", action="EASE_OFF", chosen=None, pace=recommended,
                                       reason="SAFETY", reason_text=reason_text, gate=None, verdicts=verdicts,
                                       publish=True, ref=ref, allow=baseline_allow, hard_eff=baseline_hard,
                                       actual_minus=actual_minus, prog=prog, warnings=tuple(warnings))
            # 심박 안전이 먼저다. 계획 단계는 알리기만 한다.
            return replace(output, handover_phase=phase, plan_weight=plan_weight)

        if baseline_peak is None:
            gate = "ALL"
        elif baseline_peak >= baseline_allow:
            gate = "SLOW_ONLY"
        elif baseline_peak >= baseline_allow - self.cfg.band_bpm:
            gate = "HOLD_OR_SLOW"
        else:
            gate = "ALL"

        hold_times = [t for t in (ctx.guide_pace_set_at, ctx.resumed_at) if t is not None]
        hold = bool(hold_times and (inp.now - max(hold_times)).total_seconds() < self.cfg.hold_sec)
        pace_req = prog.pace_req_sec_per_km
        wt = 0.0 if pace_req is None or prog.goal_unreachable else self.cfg.w_t_base + ctx.goal_preference
        verdicts_list = []
        for index, candidate in enumerate(inp.candidates):
            delta = candidate.delta_sec_per_km
            peak = peaks[index]
            rejection = None
            if gate == "SLOW_ONLY" and delta <= 0:
                rejection = "GATE_SLOW_ONLY"
            elif gate == "HOLD_OR_SLOW" and delta < 0:
                rejection = "GATE_HOLD_OR_SLOW"
            elif gate == "ALL" and delta < 0 and peak is not None and peak >= allow_by_candidate[index] - self.cfg.band_bpm:
                rejection = "UPPER_OVER_ALLOW"
            if rejection is None and delta < 0 and stale:
                rejection = "HR_STALE"
            if rejection is None and delta < 0 and hold:
                rejection = "ACCEL_IN_HOLD"
            score = None
            if rejection is None:
                tracking = 0.0 if pace_req is None else wt * abs(candidate.pace_sec_per_km - pace_req) / self.cfg.score_unit_sec_per_km
                change = self.cfg.w_c * abs(candidate.pace_sec_per_km - ctx.anchor_pace_sec_per_km) / self.cfg.score_unit_sec_per_km
                score = tracking + change
            verdicts_list.append(CandidateVerdict(upper_hr_bpm=upper_by_candidate[index], peak_upper_bpm=peak,
                                                   passed=rejection is None, reject_reason=rejection, score=score))
        allowed = [i for i, v in enumerate(verdicts_list) if v.passed and v.score is not None]
        if not allowed:
            allowed = [2]
        chosen = min(allowed, key=lambda i: (verdicts_list[i].score, abs(inp.candidates[i].delta_sec_per_km),
                                              -inp.candidates[i].delta_sec_per_km))
        handover_reason = None
        if phase in ("PLAN_HOLD", "PLAN_BLEND") and gate != "SLOW_ONLY":
            # 심박 gate·가속 금지를 통과한 후보 안에서만 고른다. SLOW_ONLY면 MPC(감속) 결정을 그대로 쓴다.
            target = (plan_weight * plan_pace(ctx, prog)
                      + (1.0 - plan_weight) * inp.candidates[chosen].pace_sec_per_km)
            chosen = min(allowed, key=lambda i: (abs(inp.candidates[i].pace_sec_per_km - target),
                                                  -inp.candidates[i].pace_sec_per_km))
            handover_reason = phase
        candidate = inp.candidates[chosen]
        delta = candidate.delta_sec_per_km
        if delta > 0 and gate == "SLOW_ONLY":
            reason = "SLOW_DOWN_HR"
        elif prog.goal_unreachable:
            reason = "GOAL_UNREACHABLE"
        elif delta < 0:
            reason = "SPRINT" if sprint[chosen] else "SPEED_UP_GOAL"
        elif delta > 0:
            reason = "SLOW_DOWN_GOAL"
        elif stale:
            reason = "HR_STALE"
        else:
            reason = "HOLD"
        if handover_reason is not None:
            reason = handover_reason
        d = abs(delta)
        peak_text = _round_int(peaks[chosen])
        allow_text = _round_int(allow_by_candidate[chosen])
        if reason == "HOLD":
            reason_text = f"현재 pace 유지. 상한 {_round_int(baseline_peak)} < 허용 {_round_int(baseline_allow)}"
        elif reason == "SPEED_UP_GOAL":
            reason_text = f"목표보다 늦어 {_round_int(d)}초 빠르게. 상한 {peak_text} < 허용 {allow_text}"
        elif reason == "SLOW_DOWN_GOAL":
            reason_text = f"목표보다 빨라 {_round_int(d)}초 느리게"
        elif reason == "SLOW_DOWN_HR":
            reason_text = f"상한 {_round_int(baseline_peak)} ≥ 허용 {_round_int(baseline_allow)}. {_round_int(d)}초 느리게"
        elif reason == "SPRINT":
            reason_text = f"결승 {_round_int(prog.remaining_m)} m 전. {_round_int(d)}초 빠르게"
        elif reason == "GOAL_UNREACHABLE":
            reason_text = "목표 시간 달성이 어려워 무리하지 않음"
        elif reason == "HR_STALE":
            reason_text = "입력 지연으로 가속하지 않음"
        elif reason == "PLAN_HOLD":
            reason_text = "출발 초반이라 계획 pace 유지"
        elif reason == "PLAN_BLEND":
            reason_text = f"계획 pace에서 MPC로 넘겨주는 중(계획 비중 {plan_weight:.2f})"
        else:
            reason_text = "현재 pace 유지"
        status = "HR_STALE" if stale else "OK"
        publish = guide is None or abs(candidate.pace_sec_per_km - guide) >= self.cfg.publish_delta_sec_per_km
        output = self._base_output(status=status, action="GUIDE_PACE", chosen=chosen,
                                   pace=candidate.pace_sec_per_km, reason=reason, reason_text=reason_text,
                                   gate=gate, verdicts=tuple(verdicts_list), publish=publish, ref=ref,
                                   allow=baseline_allow, hard_eff=baseline_hard, actual_minus=actual_minus,
                                   prog=prog, warnings=tuple(warnings))
        return replace(output, handover_phase=phase, plan_weight=plan_weight)
