package com.runway.backend.domain.user.personalization;

import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.user.personalization.Ai06Sample.Quality;
import com.runway.backend.domain.user.personalization.Ai06Session.WorkoutQuality;
import com.runway.backend.domain.user.personalization.W07RoutePoint.DeviceType;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.stereotype.Component;

/**
 * W07 저장 기록(러닝 하나) → AI06 {@code sessions[]} 원소 순수 변환기.
 *
 * <p>규칙은 {@code docs/design/api/w07-ai06-conversion.md}, 참고 구현은 {@code ai/service/tools/w07_to_ai06.py}다.
 * DB·HTTP에 의존하지 않고 상태가 없으며(스레드 안전), DEM 고도는 {@link ElevationSource} 포트로 주입받는다. DEM 밖·NoData는 NaN이다.
 * 지구 반지름은 문서 값 6,371,000m를 쓴다(코스 경사 계산 값과 다르다).
 *
 * <p>러닝 선택(COMPLETED·미삭제·최신순·최대 50개)과 HTTP 호출은 이 클래스의 책임이 아니다.
 */
@Component
public class W07ToAi06Converter {

    /** 변환 결과 사유. {@link #OK}·{@link #TRUNCATED}만 session이 있다. */
    public enum Reason {
        OK,
        /** 2시간(1441행)보다 길어 앞 1441행만 변환했다. */
        TRUNCATED,
        /** 35~230bpm 범위의 HR 측정이 하나도 없다. */
        NO_START_HR,
        /** 격자가 25행(120초) 미만이다. */
        TOO_SHORT
    }

    /**
     * 변환 결과.
     *
     * @param session 변환된 러닝, 보낼 수 없으면 null
     * @param reason 사유
     */
    public record Result(Ai06Session session, Reason reason) {}

    public static final int GRID_S = 5;
    public static final double MAX_HOLD_S = 15.0;
    public static final double SEGMENT_GAP_S = 60.0;
    public static final double HR_MIN_BPM = 35.0;
    public static final double HR_MAX_BPM = 230.0;
    public static final double HR_MAX_RATE_BPM_PER_S = 4.0;
    public static final double SPEED_IMPLAUSIBLE_MPS = 7.0;
    /** AI06 SupportSample 허용 상한({@code speedMps} 0~15). 밖이면 null+MISSING으로 보낸다. */
    public static final double AI_SPEED_MAX_MPS = 15.0;
    public static final double DIST_JUMP_MPS = 8.0;
    public static final double DIST_JUMP_RESET_S = 30.0;
    public static final double GRADE_WINDOW_M = 30.0;
    public static final double ALT_SMOOTH_STEP_M = 5.0;
    public static final double ALT_SMOOTH_WIN_M = 30.0;
    public static final double GRADE_CLIP_PCT = 30.0;
    public static final double GRADE_MAX_SPAN_S = 120.0;
    public static final double LOW_QUALITY_FLAG_RATIO = 0.05;
    public static final int MIN_ROWS = 25;
    public static final int MAX_ROWS = 1441;
    /** 문서 값. {@code CourseGradeService}의 반지름과 다르다. */
    public static final double EARTH_RADIUS_M = 6_371_000.0;

    /**
     * 러닝 하나를 AI06 {@code sessions[]} 원소로 바꾼다.
     *
     * @param session 완료 러닝의 W07 원본
     * @param elevation DEM 고도 조회. null이면 경사는 전부 MISSING이다
     * @return 보낼 수 없으면({@code NO_START_HR}·{@code TOO_SHORT}) 빈 값
     */
    public Optional<Ai06Session> convert(W07Session session, ElevationSource elevation) {
        return Optional.ofNullable(convertWithReason(session, elevation).session());
    }

    /** {@link #convert}와 같되 보낼 수 없는 사유와 2시간 초과 절단 여부를 함께 돌려준다. */
    public Result convertWithReason(W07Session session, ElevationSource elevation) {
        List<W07MetricSample> samples = session.samples() == null ? List.of() : session.samples();
        List<W07RoutePoint> routePoints =
                session.routePoints() == null ? List.of() : session.routePoints();

        // 앵커(0초): 35~230bpm 범위인 첫 HR 측정
        List<W07MetricSample> hrRaw = new ArrayList<>();
        for (W07MetricSample s : samples) {
            if (s.hrMeasured() && s.heartRate() != null) {
                hrRaw.add(s);
            }
        }
        hrRaw.sort(Comparator.comparing(W07MetricSample::measuredAt));
        Instant anchor = null;
        for (W07MetricSample s : hrRaw) {
            double h = s.heartRate();
            if (h >= HR_MIN_BPM && h <= HR_MAX_BPM) {
                anchor = s.measuredAt();
                break;
            }
        }
        if (anchor == null) {
            return new Result(null, Reason.NO_START_HR);
        }

        // 앵커보다 앞선 값은 버리고 시각(초)순으로 정렬한다(같은 시각은 입력 순서 유지)
        List<Timed<W07MetricSample>> metric = new ArrayList<>();
        for (W07MetricSample s : samples) {
            double t = rel(anchor, s.measuredAt());
            if (t >= 0) {
                metric.add(new Timed<>(t, s));
            }
        }
        metric.sort(Comparator.comparingDouble(Timed::t));
        List<Timed<W07RoutePoint>> route = new ArrayList<>();
        for (W07RoutePoint p : routePoints) {
            double t = rel(anchor, p.measuredAt());
            if (t >= 0) {
                route.add(new Timed<>(t, p));
            }
        }
        route.sort(Comparator.comparingDouble(Timed::t));

        // 마지막 관측 = 지표·경로점 중 가장 늦은 것 (metric에는 앵커 표본이 항상 있다)
        double lastT = 0;
        for (Timed<W07MetricSample> m : metric) {
            lastT = Math.max(lastT, m.t());
        }
        for (Timed<W07RoutePoint> r : route) {
            lastT = Math.max(lastT, r.t());
        }
        int nRows = (int) Math.min((long) Math.floor(lastT / GRID_S) + 1, MAX_ROWS);
        if (nRows < MIN_ROWS) {
            return new Result(null, Reason.TOO_SHORT);
        }

        // HR
        List<double[]> hr = new ArrayList<>(); // {t, bpm}
        for (Timed<W07MetricSample> m : metric) {
            W07MetricSample s = m.value();
            if (s.hrMeasured() && s.heartRate() != null) {
                hr.add(new double[] {m.t(), s.heartRate()});
            }
        }
        int[] hrFlags = hrSeries(hr);
        DoubleList hrOkT = new DoubleList();
        DoubleList hrOkV = new DoubleList();
        DoubleList hrBadT = new DoubleList();
        for (int i = 0; i < hr.size(); i++) {
            if (hrFlags[i] == 0) {
                hrOkT.add(hr.get(i)[0]);
                hrOkV.add(hr.get(i)[1]);
            } else {
                hrBadT.add(hr.get(i)[0]);
            }
        }

        // 속도: 누적 거리 차분. 줄어들거나 8m/s 넘게 튄 값은 버리고 표시한다(30초 넘게 버렸으면 재시작으로 받는다)
        DoubleList distT = new DoubleList();
        DoubleList distV = new DoubleList();
        DoubleList distBadT = new DoubleList();
        for (Timed<W07MetricSample> m : metric) {
            Double dObj = m.value().totalDistance();
            if (dObj == null) {
                continue;
            }
            double d = dObj;
            double t = m.t();
            if (distT.size() > 0 && t <= distT.last()) {
                continue;
            }
            if (distT.size() > 0) {
                double dt = t - distT.last();
                boolean bad = d < distV.last() || (d - distV.last()) / dt > DIST_JUMP_MPS;
                if (bad) {
                    distBadT.add(t);
                    if (dt <= DIST_JUMP_RESET_S || d < distV.last()) {
                        continue;
                    }
                }
            }
            distT.add(t);
            distV.add(d);
        }
        int[] distSeg = segments(distT);
        DoubleList spT = new DoubleList();
        DoubleList spV = new DoubleList(); // 거리 값이 전혀 없을 때만 쓴다
        for (Timed<W07MetricSample> m : metric) {
            if (m.value().speed() != null) {
                spT.add(m.t());
                spV.add(m.value().speed());
            }
        }

        // 경사: 워치 우선으로 고른 경로점의 DEM 고도. DEM 밖(NaN) 점은 뺀다
        List<Timed<W07RoutePoint>> pts = new ArrayList<>();
        DoubleList ptAlt = new DoubleList();
        if (elevation != null) {
            for (Timed<W07RoutePoint> r : pickRoutePoints(route)) {
                double alt = elevation.elevationAt(r.value().longitude(), r.value().latitude());
                if (!Double.isNaN(alt)) {
                    pts.add(r);
                    ptAlt.add(alt);
                }
            }
        }
        int np = pts.size();
        DoubleList gT = new DoubleList();
        for (Timed<W07RoutePoint> r : pts) {
            gT.add(r.t());
        }
        int[] gSeg = segments(gT);
        double[] cum = new double[np];
        double total = 0.0;
        for (int i = 0; i < np; i++) {
            if (i > 0) {
                W07RoutePoint q = pts.get(i - 1).value();
                W07RoutePoint p = pts.get(i).value();
                total += haversineM(q.longitude(), q.latitude(), p.longitude(), p.latitude());
            }
            cum[i] = total;
        }
        double[] alt = np > 0 ? smoothAltitude(ptAlt.toArray(), cum) : new double[0];
        Double[] gradePt = new Double[np];
        double[] spanPt = new double[np];
        for (int i = 0; i < np; i++) {
            int j = bisectRight(cum, np, cum[i] - GRADE_WINDOW_M) - 1;
            if (j < 0 || gSeg[j] != gSeg[i] || cum[i] - cum[j] <= 0) {
                continue;
            }
            gradePt[i] = 100.0 * (alt[i] - alt[j]) / (cum[i] - cum[j]);
            spanPt[i] = gT.get(i) - gT.get(j);
        }

        List<Ai06Sample> rows = new ArrayList<>(nRows);
        Double carry = null;
        Integer carrySeg = null;
        for (int r = 0; r < nRows; r++) {
            double g = (double) r * GRID_S;

            int k = hrOkT.lastAtOrBefore(g);
            boolean has = k >= 0 && g - hrOkT.get(k) <= MAX_HOLD_S;
            Double hrBpm = has ? hrOkV.get(k) : null;
            Quality hrQ =
                    !has
                            ? Quality.MISSING
                            : (hrBadT.anyIn(g - GRID_S, g) ? Quality.LOW : Quality.GOOD);
            boolean hrFilled = has && hrOkT.get(k) <= g - GRID_S;

            Double speed = null;
            if (distT.size() > 0) {
                int la = distT.lastAtOrBefore(g);
                int lp = distT.lastAtOrBefore(g - GRID_S);
                if (la >= 0 && lp >= 0 && distSeg[la] == distSeg[lp]) {
                    if (la > lp) {
                        carry = (distV.get(la) - distV.get(lp)) / (distT.get(la) - distT.get(lp));
                        carrySeg = distSeg[la];
                    }
                    speed = (carrySeg != null && carrySeg == distSeg[la]) ? carry : null;
                }
                if (la < 0 || g - distT.get(la) > MAX_HOLD_S) {
                    speed = null;
                }
            } else if (spT.size() > 0) {
                int k2 = spT.lastAtOrBefore(g);
                if (k2 >= 0 && g - spT.get(k2) <= MAX_HOLD_S) {
                    speed = spV.get(k2);
                }
            }
            Double speedOut = speed == null ? null : round(speed, 3);
            Quality spQ =
                    speed == null
                            ? Quality.MISSING
                            : (speed > SPEED_IMPLAUSIBLE_MPS || distBadT.anyIn(g - GRID_S, g)
                                    ? Quality.LOW
                                    : Quality.GOOD);
            // AI06 검증(0~15) 밖이면 요청 전체가 400이 되므로 그 칸만 비운다.
            if (speedOut != null && (speedOut < 0.0 || speedOut > AI_SPEED_MAX_MPS)) {
                speedOut = null;
                spQ = Quality.MISSING;
            }

            Double grade = null;
            Quality grQ = Quality.MISSING;
            int k3 = gT.lastAtOrBefore(g);
            if (k3 >= 0
                    && g - gT.get(k3) <= MAX_HOLD_S
                    && gradePt[k3] != null
                    && spanPt[k3] <= GRADE_MAX_SPAN_S) {
                double raw = gradePt[k3];
                grade = Math.max(-GRADE_CLIP_PCT, Math.min(GRADE_CLIP_PCT, raw));
                grQ = Math.abs(raw) > GRADE_CLIP_PCT ? Quality.LOW : Quality.GOOD;
            }
            Double gradeOut = grade == null ? null : round(grade, 2);

            rows.add(new Ai06Sample(r * GRID_S, hrBpm, speedOut, gradeOut, hrQ, spQ, grQ, hrFilled));
        }

        // workoutQuality: 마지막 행까지의 버린 원본 비율·60초 넘는 공백
        double cutoff = (double) (nRows - 1) * GRID_S;
        List<Timed<W07MetricSample>> used = new ArrayList<>();
        for (Timed<W07MetricSample> m : metric) {
            if (m.t() <= cutoff) {
                used.add(m);
            }
        }
        Set<Double> flagged = new HashSet<>();
        for (int i = 0; i < hrBadT.size(); i++) {
            if (hrBadT.get(i) <= cutoff) {
                flagged.add(hrBadT.get(i));
            }
        }
        for (int i = 0; i < distBadT.size(); i++) {
            if (distBadT.get(i) <= cutoff) {
                flagged.add(distBadT.get(i));
            }
        }
        for (Timed<W07MetricSample> m : used) {
            Double sp = m.value().speed();
            if (sp != null && sp > SPEED_IMPLAUSIBLE_MPS) {
                flagged.add(m.t());
            }
        }
        double ratio = used.isEmpty() ? 1.0 : (double) flagged.size() / used.size();
        boolean gaps = false;
        for (int i = 1; i < used.size(); i++) {
            if (used.get(i).t() - used.get(i - 1).t() > SEGMENT_GAP_S) {
                gaps = true;
                break;
            }
        }
        WorkoutQuality quality;
        if (ratio > LOW_QUALITY_FLAG_RATIO) {
            quality = WorkoutQuality.UNUSABLE;
        } else if (!flagged.isEmpty() || gaps) {
            quality = WorkoutQuality.USABLE_WITH_FLAGS;
        } else {
            quality = WorkoutQuality.CLEAN;
        }
        Ai06Session out =
                new Ai06Session(session.sessionId(), anchor, quality, List.copyOf(rows));
        return new Result(out, lastT > cutoff + GRID_S ? Reason.TRUNCATED : Reason.OK);
    }

    // ---- 내부 규칙 ----

    private record Timed<T>(double t, T value) {}

    /** 앵커 기준 초(소수 포함). Python {@code timedelta.total_seconds()}와 같이 마이크로초 단위로 센다. */
    private static double rel(Instant anchor, Instant value) {
        return ChronoUnit.MICROS.between(anchor, value) / 1_000_000.0;
    }

    /** Python {@code round(x, digits)}와 같이 정확한 이진값 기준 half-even 반올림. */
    private static double round(double value, int digits) {
        return new BigDecimal(value).setScale(digits, RoundingMode.HALF_EVEN).doubleValue();
    }

    private static double haversineM(double lon1, double lat1, double lon2, double lat2) {
        double p1 = Math.toRadians(lat1);
        double p2 = Math.toRadians(lat2);
        double dp = p2 - p1;
        double dl = Math.toRadians(lon2 - lon1);
        double sdp = Math.sin(dp / 2);
        double sdl = Math.sin(dl / 2);
        double a = sdp * sdp + Math.cos(p1) * Math.cos(p2) * sdl * sdl;
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a));
    }

    /** 오름차순 배열 앞 size개에서 x 이하 개수(Python {@code bisect_right}). */
    private static int bisectRight(double[] a, int size, double x) {
        int lo = 0;
        int hi = size;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (x < a[mid]) {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        return lo;
    }

    /** 오름차순 배열 앞 size개에서 x 미만 개수(Python {@code bisect_left}). */
    private static int bisectLeft(double[] a, int size, double x) {
        int lo = 0;
        int hi = size;
        while (lo < hi) {
            int mid = (lo + hi) >>> 1;
            if (a[mid] < x) {
                lo = mid + 1;
            } else {
                hi = mid;
            }
        }
        return lo;
    }

    /** numpy.interp와 같은 선형 보간(양 끝 밖은 끝값). */
    private static double interp(double x, double[] xs, double[] ys) {
        int n = xs.length;
        if (x <= xs[0]) {
            return ys[0];
        }
        if (x >= xs[n - 1]) {
            return ys[n - 1];
        }
        int k = bisectRight(xs, n, x) - 1;
        double x0 = xs[k];
        double x1 = xs[k + 1];
        return ys[k] + (ys[k + 1] - ys[k]) * (x - x0) / (x1 - x0);
    }

    /** 거리 5m 격자에 고도를 옮겨 가운데 7칸(30m) 평균을 내고 원래 점으로 되돌린다. */
    private static double[] smoothAltitude(double[] alt, double[] cum) {
        DoubleList xs = new DoubleList();
        DoubleList ys = new DoubleList();
        for (int i = 0; i < cum.length; i++) { // 같은 누적 거리는 첫 점만 쓴다
            if (xs.size() == 0 || cum[i] > xs.last()) {
                xs.add(cum[i]);
                ys.add(alt[i]);
            }
        }
        if (xs.size() < 3) {
            return alt.clone();
        }
        double[] x = xs.toArray();
        double[] y = ys.toArray();
        int nGrid = (int) Math.floor((x[x.length - 1] - x[0]) / ALT_SMOOTH_STEP_M) + 1;
        DoubleList gridList = new DoubleList();
        for (int i = 0; i < nGrid; i++) {
            gridList.add(x[0] + i * ALT_SMOOTH_STEP_M);
        }
        if (gridList.last() < x[x.length - 1]) {
            gridList.add(gridList.last() + ALT_SMOOTH_STEP_M);
        }
        double[] grid = gridList.toArray();
        double[] onGrid = new double[grid.length];
        for (int i = 0; i < grid.length; i++) {
            onGrid[i] = interp(grid[i], x, y);
        }
        int k = Math.max(1, (int) Math.rint(ALT_SMOOTH_WIN_M / ALT_SMOOTH_STEP_M));
        k += (k + 1) % 2; // 홀수 창 (30m/5m = 6 → 7칸)
        int half = k / 2;
        double[] sm = new double[grid.length];
        for (int i = 0; i < grid.length; i++) {
            int from = Math.max(0, i - half);
            int to = Math.min(grid.length, i + half + 1);
            double sum = 0;
            for (int j = from; j < to; j++) {
                sum += onGrid[j];
            }
            sm[i] = sum / (to - from);
        }
        double[] out = new double[cum.length];
        for (int i = 0; i < cum.length; i++) {
            out[i] = interp(cum[i], grid, sm);
        }
        return out;
    }

    /** 관측 시각 간격이 60초를 넘으면 새 구간. 각 점의 구간 번호. */
    private static int[] segments(DoubleList times) {
        int[] out = new int[times.size()];
        int seg = 0;
        for (int i = 0; i < times.size(); i++) {
            if (i > 0 && times.get(i) - times.get(i - 1) > SEGMENT_GAP_S) {
                seg++;
            }
            out[i] = seg;
        }
        return out;
    }

    /** 워치 점을 먼저 쓰고, 앞뒤 15초 안에 워치 점이 없는 폰 점만 보탠다. 같은 시간대를 두 기기로 두 번 세지 않는다. */
    private static List<Timed<W07RoutePoint>> pickRoutePoints(List<Timed<W07RoutePoint>> route) {
        DoubleList watchT = new DoubleList();
        for (Timed<W07RoutePoint> r : route) {
            if (r.value().deviceType() == DeviceType.WATCH) {
                watchT.add(r.t());
            }
        }
        double[] wt = watchT.toArray();
        List<Timed<W07RoutePoint>> out = new ArrayList<>();
        for (Timed<W07RoutePoint> r : route) {
            if (r.value().deviceType() == DeviceType.WATCH) {
                out.add(r);
                continue;
            }
            int k = bisectLeft(wt, wt.length, r.t() - MAX_HOLD_S);
            if (k < wt.length && wt[k] <= r.t() + MAX_HOLD_S) {
                continue; // 이 시각은 워치 GPS가 덮는다
            }
            out.add(r);
        }
        return out;
    }

    /** HR 원본 표시. 0 = 유효, 1 = 범위 밖, 2 = 직전 유효 대비 초당 4bpm 초과 변화. */
    private static int[] hrSeries(List<double[]> hr) {
        int[] flags = new int[hr.size()];
        double[] last = null;
        for (int i = 0; i < hr.size(); i++) {
            double t = hr.get(i)[0];
            double h = hr.get(i)[1];
            if (!(h >= HR_MIN_BPM && h <= HR_MAX_BPM)) {
                flags[i] = 1;
                continue;
            }
            if (last != null) {
                double dt = t - last[0];
                if (dt <= 0 || Math.abs(h - last[1]) / dt > HR_MAX_RATE_BPM_PER_S) {
                    flags[i] = 2;
                    continue;
                }
            }
            last = new double[] {t, h};
        }
        return flags;
    }

    /** 작은 double 목록. 오름차순 시각 질의(bisect)를 제공한다. */
    private static final class DoubleList {
        private double[] data = new double[16];
        private int size;

        void add(double v) {
            if (size == data.length) {
                data = Arrays.copyOf(data, size * 2);
            }
            data[size++] = v;
        }

        int size() {
            return size;
        }

        double get(int i) {
            return data[i];
        }

        double last() {
            return data[size - 1];
        }

        double[] toArray() {
            return Arrays.copyOf(data, size);
        }

        /** t 이하인 마지막 위치, 없으면 -1. */
        int lastAtOrBefore(double t) {
            return bisectRight(data, size, t) - 1;
        }

        /** (lo, hi] 구간에 값이 하나라도 있는가. */
        boolean anyIn(double lo, double hi) {
            return bisectRight(data, size, hi) > bisectRight(data, size, lo);
        }
    }
}
