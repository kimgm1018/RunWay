"""예측 상한, 허용선, 목표 추종으로 pace 후보를 고른다."""
import math
from dataclasses import dataclass, replace
from datetime import datetime

from app.decide.policy_port import CandidateVerdict, PolicyCandidate, PolicyInput, PolicyOutput
from app.decide.schemas import DecideContext
from app.policy.config import PolicyConfig
from app.policy.detectors import detect
from app.policy.hr_reference import HrThresholds, blend_hr_thresholds
from app.pace_selector import DELTAS, RECOVER_BAND_BPM, PaceSelector, upper_bound
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


def ease_off_pace(ctx: DecideContext, pace_now_sec_per_km: float | None, cfg: PolicyConfig) -> float:
    """위험 심박일 때의 감속 권고 pace = max(안내, min(실측 + ease_off, 걷기 경계)).

    - 실측 페이스에 ease_off를 더한다. 러너가 안내대로 달리면 안내 + ease_off이고, 안내를 따르지 않고 빠르게 달리면
      권고가 안내에 머문다(같은 안내를 다시 알림). 예전(max(실측, 안내) + ease_off, S15P31E105-497)은 러너가 무시하는
      동안 30초마다 안내만 30초씩 느려졌다(팀 검토 2026-11-06, S15P31E105-506).
    - 권고는 지금 안내보다 빠르지 않다(S15P31E105-497). 처음 위험이 되면 코칭 단계가 DANGER로 바뀌어 페이스가
      같아도 백엔드가 알린다(S15P31E105-503).
    - 감속 권고가 이어져도 걷기 경계(walk_speed_mps, 1.5 m/s = 11:07/km)보다 느려지지 않는다. 멈춤·걷기 권고는
      두지 않는다(S15P31E105-504). 안내가 이미 걷기 경계보다 느리면 안내를 그대로 쓴다.
    """
    base = pace_now_sec_per_km if pace_now_sec_per_km is not None else ctx.anchor_pace_sec_per_km
    guide = ctx.current_guide_pace_sec_per_km
    pace = min(base + cfg.ease_off_sec_per_km, 1000.0 / cfg.walk_speed_mps)
    return max(pace, guide) if guide is not None else pace


class MpcPolicy:
    """MPC 정책 v0.5 구현."""
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
        # 20초 이상은 서비스가 먼저 INPUT_INSUFFICIENT로 막는다. HR_STALE는 정책을 직접 부를 때만 쓰는 방어용이다.
        stale = inp.input_age_sec > self.cfg.hr_stale_sec
        ref = inp.hr_thresholds or blend_hr_thresholds(self.cfg)
        prog = progress(ctx, inp.pace_now_sec_per_km, self.cfg)
        phase, plan_weight = handover_phase(ctx.active_sec, self.cfg)
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

        # 안내 그대로(기준 페이스 대비 0초/km) 후보의 위치. 후보는 기준 + DELTAS 순서다(S15P31E105-624).
        base = next((i for i, c in enumerate(inp.candidates) if c.delta_sec_per_km == 0), None)
        # 러너가 지금 실측 속도로 계속 달릴 때의 상한 심박. 안내 그대로 후보의 경사·여유 표 칸을 쓴다(S15P31E105-504).
        actual_peak = None
        if inp.actual_pred_hr_bpm is not None and base is not None:
            dspeed = inp.speed_now_mps - mean_past if mean_past is not None else None
            grade = _mean(inp.candidates[base].future_grade_pct)
            actual_peak = max(p + self.margins.margin(h, dspeed, grade)
                              for h, p in zip((30, 60, 120), inp.actual_pred_hr_bpm))

        baseline_peak = peaks[base] if base is not None else None
        baseline_allow = allow_by_candidate[base] if base is not None else allow_at(prog.p, ref, self.cfg)
        baseline_hard = hard_by_candidate[base] if base is not None else ref.danger_bpm
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
            recommended = ease_off_pace(ctx, inp.pace_now_sec_per_km, self.cfg)
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
            return replace(output, handover_phase=phase, plan_weight=plan_weight, coaching_level="DANGER")

        if baseline_peak is None:
            gate = "ALL"
        elif baseline_peak >= baseline_allow:
            gate = "SLOW_ONLY"
        elif baseline_peak >= baseline_allow - self.cfg.band_bpm:
            gate = "HOLD_OR_SLOW"
        else:
            gate = "ALL"

        # 코칭 단계(S15P31E105-504). CAUTION = 이대로 가면 힘들어질 것: 안내 페이스로도 허용선 이상(SLOW_ONLY),
        # 과속 감지(OVERPACE), 또는 실측 속도로 계속 달릴 때의 상한이 허용선 이상. 그 밖은 OK(막지 않음).
        caution = (gate == "SLOW_ONLY" or "OVERPACE" in warnings
                   or (actual_peak is not None and actual_peak >= baseline_allow))
        coaching_level = "CAUTION" if caution else "OK"

        # 페이스 선택은 그룹 페이스 AI10과 같은 규칙이다(S15P31E105-624, app.pace_selector). 후보는 기준 + DELTAS,
        # "상한 < 허용선"을 통과하는 가장 빠른 후보, 가속은 허용 − 3 bpm과 목표 페이스 상한, 변경 뒤 120초 쿨다운
        # (위험 심박 감속은 예외), 출발 180초는 +10초/km까지만 감속, 10초/km 미만 변화는 유지.
        # 안내가 바뀐 시각은 guidePaceSetAt, 없으면 마지막으로 워치에 적용된 코칭 시각이다. 재개 시각도 변경으로 본다.
        guide_set_at = ctx.guide_pace_set_at
        if guide_set_at is None and ctx.last_coaching is not None:
            guide_set_at = ctx.last_coaching.applied_at
        change_times = [t for t in (guide_set_at, ctx.resumed_at) if t is not None]
        since_change = (inp.now - max(change_times)).total_seconds() if change_times else None
        if base is None:
            raise ValueError("기준 페이스 후보(0초/km)가 없습니다")
        current = inp.candidates[base].pace_sec_per_km

        def selection_upper(c, peak, allow, is_sprint):
            if is_sprint:
                # 결승 400 m 안: 결승 뒤 지평선은 빼고(upper_by_candidate의 None) 남은 지평선 최대로 본다(리뷰 A-1/B-1).
                upper = peak if peak is not None else -math.inf
            else:
                upper = upper_bound(c.pred_hr_bpm, c.pace_sec_per_km, current, mean_past,
                                    _mean(c.future_grade_pct), self.cfg, self.margins)
            # 선택기는 허용선 하나와 비교하므로 후보별 허용선(스프린트는 위험 기준) 차이만큼 옮겨 같은 비교를 만든다.
            return upper - (allow - baseline_allow)

        request_uppers = [selection_upper(c, peaks[i], allow_by_candidate[i], sprint[i])
                          for i, c in enumerate(inp.candidates)]
        # 선택 목록: 러너가 안내보다 느리면(slow_rows) 느린 후보는 max(안내, 실측) + 폭으로 바꾼다(수정 1).
        entries = []        # (후보, 요청 위치 또는 None, 선택 상한, 스프린트)
        for i, c in enumerate(inp.candidates):
            if not (inp.slow_rows and c.pace_sec_per_km > current + 0.01):
                entries.append((c, i, request_uppers[i], sprint[i]))
        for c in inp.slow_rows:
            is_sprint = (prog.distance_goal and prog.remaining_m is not None and prog.remaining_m <= self.cfg.sprint_m
                         and c.future_speed_mps * 120.0 >= prog.remaining_m)
            row_allow = ref.danger_bpm if is_sprint else allow_at(prog.p, ref, self.cfg)
            known = [p + self.margins.margin(h, None, _mean(c.future_grade_pct))
                     for h, p in zip((30, 60, 120), c.pred_hr_bpm)
                     if not (is_sprint and c.future_speed_mps * h > prog.remaining_m)]
            entries.append((c, None, selection_upper(c, max(known) if known else None, row_allow, is_sprint), is_sprint))
        entries.sort(key=lambda e: e[0].pace_sec_per_km)
        slow_base = (inp.slow_rows[0].pace_sec_per_km - min(d for d in DELTAS if d > 0)) if inp.slow_rows else None
        selector = PaceSelector([e[0].pace_sec_per_km for e in entries], current, [[e[2] for e in entries]],
                                [baseline_allow])
        # 가속 상한은 목표에 필요한 페이스다. 목표가 없거나 닿을 수 없거나 입력이 늦으면 올리지 않는다.
        cap = None if stale or prog.goal_unreachable else prog.pace_req_sec_per_km
        # 위험(수정 2): 안내 그대로의 2분 예측 자체(여유 없이)가 허용선 이상. 이때는 쿨다운 중에도 늦추고 출발 180초
        # +10 상한도 걸지 않는다. 예측 + 여유만 넘는 경우(보통의 심박 감속)는 쿨다운·워밍업을 지킨다.
        # 결승 뒤 120초 예측은 쓰지 않는다(리뷰 B-6).
        pred_120 = inp.candidates[base].pred_hr_bpm[2] if upper_by_candidate[base][2] is not None else None
        danger = pred_120 is not None and pred_120 >= baseline_allow
        selection = selector.select(danger=danger, cap=cap, elapsed_sec=ctx.active_sec,
                                    since_change_sec=since_change, slow_base=slow_base, warmup_exempt=danger)
        chosen_entry = entries[selection.index]
        verdicts = []
        for index, item in enumerate(inp.candidates):
            faster = item.pace_sec_per_km < current
            passed = request_uppers[index] < baseline_allow - (RECOVER_BAND_BPM if faster else 0.0)
            reject = None if passed else "UPPER_OVER_ALLOW"
            if passed and faster and stale:
                passed, reject = False, "HR_STALE"      # 입력이 늦으면 올리지 않는다(리뷰 A-4)
            # score: 선택에 쓴 상한 − 허용선(음수일수록 여유). 화면 표시용이며 선택에는 쓰지 않는다.
            verdicts.append(CandidateVerdict(upper_hr_bpm=upper_by_candidate[index], peak_upper_bpm=peaks[index],
                                             passed=passed, reject_reason=reject,
                                             score=request_uppers[index] - baseline_allow))
        candidate, chosen = chosen_entry[0], chosen_entry[1]
        if chosen is not None:
            candidate = inp.candidates[chosen]
        at_floor = not_following = False
        settled = (guide_set_at is None
                   or (inp.now - guide_set_at).total_seconds() >= self.cfg.not_following_grace_sec)
        if (gate == "SLOW_ONLY" and guide is not None and inp.pace_now_sec_per_km is not None and settled
                and inp.pace_now_sec_per_km <= guide - self.cfg.not_following_sec_per_km):
            # 러너가 안내를 따르지 않는다(안내보다 빠름). 안내를 더 늦춰도 러너는 그대로라 안내만 느려진다.
            # 같은 안내를 다시 알리고 단계만 올린다(팀 검토 2026-11-06). 안내를 바꾼 뒤 not_following_grace_sec(60초)는
            # 러너가 따라올 시간으로 두고, 그 뒤로는 쿨다운 중에도 같게 둬서 단계가 오가지 않게 한다.
            not_following = True
            chosen = base
            candidate = replace(inp.candidates[base], pace_sec_per_km=guide,
                                delta_sec_per_km=int(round(guide - ctx.anchor_pace_sec_per_km)))
            warnings.append("GUIDE_NOT_FOLLOWED")
        elif candidate.delta_sec_per_km > 0:
            # 걷기 경계(11:07/km)보다 느리게는 안내하지 않는다. 하한에 닿으면 위험 알림(DANGER)으로 올린다(팀 검토 2026-11-06).
            floor = 1000.0 / self.cfg.walk_speed_mps
            if candidate.pace_sec_per_km >= floor:
                at_floor = True
                pace = max(floor, guide if guide is not None else ctx.anchor_pace_sec_per_km)
                if abs(pace - candidate.pace_sec_per_km) > 0.01:
                    chosen = None
                    candidate = replace(candidate, pace_sec_per_km=pace,
                                        delta_sec_per_km=int(round(pace - ctx.anchor_pace_sec_per_km)))
        delta = candidate.delta_sec_per_km
        if not_following or delta > 0:
            reason = "SLOW_DOWN_HR"
        elif prog.goal_unreachable:
            reason = "GOAL_UNREACHABLE"
        elif delta < 0:
            reason = "SPRINT" if chosen is not None and sprint[chosen] else "SPEED_UP_GOAL"
        elif stale:
            reason = "HR_STALE"
        else:
            reason = "HOLD"
        d = abs(delta)
        peak_text = _round_int(peaks[chosen]) if chosen is not None else "-"
        allow_text = _round_int(allow_by_candidate[chosen]) if chosen is not None else _round_int(baseline_allow)
        if reason == "HOLD" and gate == "SLOW_ONLY":
            # 심박은 허용선 이상이지만 안내를 바꾼 지 120초가 안 돼 반응을 기다린다(쿨다운).
            reason_text = f"심박 반응 대기. 상한 {_round_int(baseline_peak)} ≥ 허용 {_round_int(baseline_allow)}, 안내 유지"
        elif reason == "HOLD":
            reason_text = f"현재 pace 유지. 상한 {_round_int(baseline_peak)} < 허용 {_round_int(baseline_allow)}"
        elif reason == "SPEED_UP_GOAL":
            reason_text = f"목표보다 늦어 {_round_int(d)}초 빠르게. 상한 {peak_text} < 허용 {allow_text}"
        elif reason == "SLOW_DOWN_HR" and not_following:
            reason_text = f"안내를 따르지 않음. 상한 {_round_int(baseline_peak)} ≥ 허용 {_round_int(baseline_allow)}, 같은 안내 다시"
        elif reason == "SLOW_DOWN_HR":
            reason_text = f"상한 {_round_int(baseline_peak)} ≥ 허용 {_round_int(baseline_allow)}. {_round_int(d)}초 느리게"
        elif reason == "SPRINT":
            reason_text = f"결승 {_round_int(prog.remaining_m)} m 전. {_round_int(d)}초 빠르게"
        elif reason == "GOAL_UNREACHABLE":
            reason_text = "목표 시간 달성이 어려워 무리하지 않음"
        elif reason == "HR_STALE":
            reason_text = "입력 지연으로 가속하지 않음"
        else:
            reason_text = "현재 pace 유지"
        status = "HR_STALE" if stale else "OK"
        publish = (not_following or guide is None
                   or abs(candidate.pace_sec_per_km - guide) >= self.cfg.publish_delta_sec_per_km)
        if at_floor or not_following:
            # 하한이면 위험 알림, 안내 미준수면 단계를 한 칸 올린다(OK → CAUTION → DANGER).
            coaching_level = "DANGER" if at_floor or coaching_level == "CAUTION" else "CAUTION"
        output = self._base_output(status=status, action="GUIDE_PACE", chosen=chosen,
                                   pace=candidate.pace_sec_per_km, reason=reason, reason_text=reason_text,
                                   gate=gate, verdicts=tuple(verdicts), publish=publish, ref=ref,
                                   allow=baseline_allow, hard_eff=baseline_hard, actual_minus=actual_minus,
                                   prog=prog, warnings=tuple(warnings))
        return replace(output, handover_phase=phase, plan_weight=plan_weight, coaching_level=coaching_level,
                       chosen_pred_hr_bpm=candidate.pred_hr_bpm if chosen is None else None,
                       selector_reason=None if not_following else selection.reason)
