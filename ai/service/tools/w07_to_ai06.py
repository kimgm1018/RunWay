"""W07 저장 기록 → AI06 `POST /v1/hr/personalize` 요청 참고 변환 (S15P31E105-411).

백엔드(S15P31E105-410)가 Java로 옮기기 위한 참고 구현이다. 서비스 런타임(`app/`)에서는 쓰지 않는다.
규칙과 학습 근거는 docs/design/api/w07-ai06-conversion.md에 있다. 숫자 상수는 그 문서의 표와 같다.
옮기기 쉽도록 numpy 없이 표준 Python만 쓴다.

입력 (백엔드 DB에서 읽은 값)
- session: {"sessionId", "status", "deletedAt", "startedAt", "metricSamples", "routePoints"}
  - metricSamples: running_metric_samples 행. {"measuredAt", "heartRateBpm", "speedMps", "totalDistanceM",
    "isHrMeasured"}. 워치가 보내는 gradePercent는 null이므로 읽지 않는다.
  - routePoints: running_route_points 행에 백엔드가 DEM 고도와 기기 종류를 붙인 값. {"measuredAt", "deviceType",
    "longitude", "latitude", "demAltitudeM"}. deviceType = user_devices.device_type(WATCH/PHONE, device_id가
    없으면 PHONE으로 본다). DEM 밖이면 demAltitudeM = null.
"""
from __future__ import annotations

import bisect
import math
from datetime import datetime, timezone

GRID_S = 5                       # 5초 격자
MAX_HOLD_S = 15.0                # 마지막 관측을 이어 쓰는 최대 나이(초)
SEGMENT_GAP_S = 60.0             # 관측 간격이 이보다 길면 구간을 끊는다
HR_MIN_BPM, HR_MAX_BPM = 35.0, 230.0
HR_MAX_RATE_BPM_PER_S = 4.0      # 직전 유효 HR 대비 초당 변화 상한
SPEED_IMPLAUSIBLE_MPS = 7.0
DIST_JUMP_MPS = 8.0              # 직전 채택 거리 대비 이보다 빠르면 튐으로 버린다
DIST_JUMP_RESET_S = 30.0         # 이보다 오래 버리고 있었다면 새 값을 재시작으로 받는다(LOW)
GRADE_WINDOW_M = 30.0            # 뒤쪽 30m 경사
ALT_SMOOTH_STEP_M = 5.0          # 고도 평활: 5m 거리 격자
ALT_SMOOTH_WIN_M = 30.0          # 고도 평활: 가운데 30m 이동 평균
GRADE_CLIP_PCT = 30.0
GRADE_MAX_SPAN_S = 120.0         # 30m 창이 이보다 오래 걸리면(멈춤 포함) 경사를 쓰지 않는다
LOW_QUALITY_FLAG_RATIO = 0.05
MIN_ROWS, MAX_ROWS = 25, 1441    # AI06 samples 길이 제약
MAX_SESSIONS = 50                # AI06 sessions 길이 제약
EARTH_RADIUS_M = 6_371_000.0


def _ts(value) -> datetime:
    if isinstance(value, datetime):
        dt = value
    else:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    if dt.tzinfo is None or dt.utcoffset() is None:
        raise ValueError("시각에는 시간대가 있어야 합니다")
    return dt.astimezone(timezone.utc)


def _iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _haversine_m(lon1, lat1, lon2, lat2) -> float:
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def _last_at_or_before(times, t) -> int:
    """times(오름차순)에서 t 이하인 마지막 위치, 없으면 -1."""
    return bisect.bisect_right(times, t) - 1


def _any_in(times, lo, hi) -> bool:
    """(lo, hi] 구간에 시각이 하나라도 있는가."""
    return bisect.bisect_right(times, hi) > bisect.bisect_right(times, lo)


def _interp(x, xs, ys) -> float:
    """numpy.interp와 같은 선형 보간(양 끝 밖은 끝값)."""
    if x <= xs[0]:
        return ys[0]
    if x >= xs[-1]:
        return ys[-1]
    k = bisect.bisect_right(xs, x) - 1
    x0, x1 = xs[k], xs[k + 1]
    return ys[k] + (ys[k + 1] - ys[k]) * (x - x0) / (x1 - x0)


def _smooth_altitude(alt, cum):
    """거리 5m 격자에 고도를 옮겨 가운데 7칸(30m) 평균을 내고 원래 점으로 되돌린다(학습 dist30과 같다)."""
    xs, ys = [], []
    for c, a in zip(cum, alt):               # 같은 누적 거리는 첫 점만 쓴다
        if not xs or c > xs[-1]:
            xs.append(c)
            ys.append(a)
    if len(xs) < 3:
        return list(alt)
    n_grid = int(math.floor((xs[-1] - xs[0]) / ALT_SMOOTH_STEP_M)) + 1
    grid = [xs[0] + i * ALT_SMOOTH_STEP_M for i in range(n_grid)]
    if grid[-1] < xs[-1]:
        grid.append(grid[-1] + ALT_SMOOTH_STEP_M)
    on_grid = [_interp(g, xs, ys) for g in grid]
    k = max(1, int(round(ALT_SMOOTH_WIN_M / ALT_SMOOTH_STEP_M)))
    k += (k + 1) % 2                          # 홀수 창 (30m/5m = 6 → 7칸)
    half = k // 2
    sm = []
    for i in range(len(on_grid)):
        part = on_grid[max(0, i - half):i + half + 1]
        sm.append(sum(part) / len(part))
    return [_interp(c, grid, sm) for c in cum]


def _segments(times):
    """관측 시각 간격이 60초를 넘으면 새 구간. 각 점의 구간 번호."""
    seg, out = 0, []
    for i, t in enumerate(times):
        if i and t - times[i - 1] > SEGMENT_GAP_S:
            seg += 1
        out.append(seg)
    return out


def _pick_route_points(route):
    """워치 점을 먼저 쓰고, 앞뒤 15초 안에 워치 점이 없는 폰 점만 보탠다. 같은 구간을 두 기기로 두 번 세지 않는다."""
    watch_t = [t for t, p in route if p.get("deviceType") == "WATCH"]
    out = []
    for t, p in route:
        if p.get("deviceType") == "WATCH":
            out.append((t, p))
            continue
        k = bisect.bisect_left(watch_t, t - MAX_HOLD_S)
        if k < len(watch_t) and watch_t[k] <= t + MAX_HOLD_S:
            continue                          # 이 시각은 워치 GPS가 덮는다
        out.append((t, p))
    return out


def _hr_series(hr_samples):
    """HR 원본에 표시를 붙인다. 0 = 유효, 1 = 범위 밖, 2 = 직전 유효 대비 초당 4bpm 초과 변화."""
    flags, last = [], None
    for t, h in hr_samples:
        if not (HR_MIN_BPM <= h <= HR_MAX_BPM):
            flags.append(1)
            continue
        if last is not None:
            dt = t - last[0]
            if dt <= 0 or abs(h - last[1]) / dt > HR_MAX_RATE_BPM_PER_S:
                flags.append(2)
                continue
        flags.append(0)
        last = (t, h)
    return flags


def convert_session(session: dict) -> tuple[dict | None, str]:
    """완료 러닝 하나 → AI06 sessions[] 원소. 보낼 수 없으면 (None, 사유)."""
    hr_raw = []
    for s in session.get("metricSamples", []):
        if s.get("isHrMeasured") and s.get("heartRateBpm") is not None:
            hr_raw.append((_ts(s["measuredAt"]), float(s["heartRateBpm"])))
    hr_raw.sort(key=lambda x: x[0])
    anchor = next((t for t, h in hr_raw if HR_MIN_BPM <= h <= HR_MAX_BPM), None)
    if anchor is None:
        return None, "NO_START_HR"

    def rel(value) -> float:
        return (_ts(value) - anchor).total_seconds()

    metric = sorted(((rel(s["measuredAt"]), s) for s in session.get("metricSamples", [])), key=lambda x: x[0])
    metric = [(t, s) for t, s in metric if t >= 0]
    route = sorted(((rel(p["measuredAt"]), p) for p in session.get("routePoints", [])), key=lambda x: x[0])
    route = [(t, p) for t, p in route if t >= 0]

    last_t = max([t for t, _ in metric] + [t for t, _ in route])
    n_rows = min(int(math.floor(last_t / GRID_S)) + 1, MAX_ROWS)
    if n_rows < MIN_ROWS:
        return None, "TOO_SHORT"

    # HR
    hr = [(t, float(s["heartRateBpm"])) for t, s in metric
          if s.get("isHrMeasured") and s.get("heartRateBpm") is not None]
    hr_flags = _hr_series(hr)
    hr_ok_t = [t for (t, _), f in zip(hr, hr_flags) if f == 0]
    hr_ok_v = [h for (_, h), f in zip(hr, hr_flags) if f == 0]
    hr_bad_t = [t for (t, _), f in zip(hr, hr_flags) if f != 0]

    # 속도: 누적 거리(totalDistanceM) 차분. 줄어들거나 8m/s 넘게 튄 값은 버리고 표시한다(30초 넘게 버렸으면 재시작으로 받는다)
    dist_t, dist_v, dist_bad_t = [], [], []
    for t, s in metric:
        d = s.get("totalDistanceM")
        if d is None:
            continue
        d = float(d)
        if dist_t and t <= dist_t[-1]:
            continue
        if dist_t:
            dt = t - dist_t[-1]
            bad = d < dist_v[-1] or (d - dist_v[-1]) / dt > DIST_JUMP_MPS
            if bad:
                dist_bad_t.append(t)
                if dt <= DIST_JUMP_RESET_S or d < dist_v[-1]:
                    continue
        dist_t.append(t)
        dist_v.append(d)
    dist_seg = _segments(dist_t)
    sp_t = [t for t, s in metric if s.get("speedMps") is not None]          # 거리 값이 없을 때만 쓴다
    sp_v = [float(s["speedMps"]) for t, s in metric if s.get("speedMps") is not None]

    # 경사: 워치 우선으로 고른 경로점의 DEM 고도
    pts = [(t, p) for t, p in _pick_route_points(route) if p.get("demAltitudeM") is not None]
    g_t = [t for t, _ in pts]
    g_seg = _segments(g_t)
    cum, total = [], 0.0
    for i, (t, p) in enumerate(pts):
        if i:
            q = pts[i - 1][1]
            total += _haversine_m(q["longitude"], q["latitude"], p["longitude"], p["latitude"])
        cum.append(total)
    alt = _smooth_altitude([float(p["demAltitudeM"]) for _, p in pts], cum) if pts else []
    grade_pt, span_pt = [], []
    for i in range(len(pts)):
        j = bisect.bisect_right(cum, cum[i] - GRADE_WINDOW_M) - 1
        if j < 0 or g_seg[j] != g_seg[i] or cum[i] - cum[j] <= 0:
            grade_pt.append(None)
            span_pt.append(None)
            continue
        grade_pt.append(100.0 * (alt[i] - alt[j]) / (cum[i] - cum[j]))
        span_pt.append(g_t[i] - g_t[j])

    samples, carry, carry_seg = [], None, None
    for r in range(n_rows):
        g = float(r * GRID_S)
        row = {"elapsedSec": r * GRID_S}

        k = _last_at_or_before(hr_ok_t, g)
        has = k >= 0 and g - hr_ok_t[k] <= MAX_HOLD_S
        row["hrBpm"] = hr_ok_v[k] if has else None
        hr_q = "MISSING" if not has else ("LOW" if _any_in(hr_bad_t, g - GRID_S, g) else "GOOD")
        hr_filled = bool(has and hr_ok_t[k] <= g - GRID_S)

        speed = None
        if dist_t:
            la = _last_at_or_before(dist_t, g)
            lp = _last_at_or_before(dist_t, g - GRID_S)
            if la >= 0 and lp >= 0 and dist_seg[la] == dist_seg[lp]:
                if la > lp:
                    carry = (dist_v[la] - dist_v[lp]) / (dist_t[la] - dist_t[lp])
                    carry_seg = dist_seg[la]
                speed = carry if carry_seg == dist_seg[la] else None
            if la < 0 or g - dist_t[la] > MAX_HOLD_S:
                speed = None
        elif sp_t:
            k2 = _last_at_or_before(sp_t, g)
            if k2 >= 0 and g - sp_t[k2] <= MAX_HOLD_S:
                speed = sp_v[k2]
        row["speedMps"] = None if speed is None else round(speed, 3)
        sp_q = ("MISSING" if speed is None else
                "LOW" if speed > SPEED_IMPLAUSIBLE_MPS or _any_in(dist_bad_t, g - GRID_S, g) else "GOOD")

        grade, gr_q = None, "MISSING"
        k3 = _last_at_or_before(g_t, g)
        if k3 >= 0 and g - g_t[k3] <= MAX_HOLD_S and grade_pt[k3] is not None \
                and span_pt[k3] <= GRADE_MAX_SPAN_S:
            raw = grade_pt[k3]
            grade = max(-GRADE_CLIP_PCT, min(GRADE_CLIP_PCT, raw))
            gr_q = "LOW" if abs(raw) > GRADE_CLIP_PCT else "GOOD"
        row["gradePercent"] = None if grade is None else round(grade, 2)

        row.update(hrQuality=hr_q, speedQuality=sp_q, gradeQuality=gr_q, hrIsFilled=hr_filled)
        samples.append(row)

    cutoff = (n_rows - 1) * GRID_S
    used = [(t, s) for t, s in metric if t <= cutoff]
    flagged = set(t for t in hr_bad_t if t <= cutoff) | set(t for t in dist_bad_t if t <= cutoff)
    flagged |= {t for t, s in used if s.get("speedMps") is not None and float(s["speedMps"]) > SPEED_IMPLAUSIBLE_MPS}
    ratio = len(flagged) / len(used) if used else 1.0
    gaps = any(b[0] - a[0] > SEGMENT_GAP_S for a, b in zip(used, used[1:]))
    if ratio > LOW_QUALITY_FLAG_RATIO:
        quality = "UNUSABLE"
    elif flagged or gaps:
        quality = "USABLE_WITH_FLAGS"
    else:
        quality = "CLEAN"
    return {
        "sessionId": session["sessionId"],
        "sessionStartedAt": _iso(anchor),
        "workoutQuality": quality,
        "samples": samples,
    }, ("TRUNCATED" if last_t > cutoff + GRID_S else "OK")


def build_request(user_id: int, sessions: list[dict]) -> dict | None:
    """보낼 러닝 고르기: COMPLETED·미삭제, 시작 시각 최신순으로 변환해 성공한 것 최대 50개. 없으면 None.

    sessions는 종료 결과가 확정된(모든 batch 저장 확인) 러닝만 넣는다. 그 판단은 백엔드가 한다.
    """
    picked = []
    candidates = [s for s in sessions if s.get("status") == "COMPLETED" and s.get("deletedAt") is None]
    for s in sorted(candidates, key=lambda s: _ts(s["startedAt"]), reverse=True):
        converted, _reason = convert_session(s)
        if converted is not None:
            picked.append(converted)
        if len(picked) == MAX_SESSIONS:
            break
    if not picked:
        return None
    return {"userId": user_id, "sessions": picked}
