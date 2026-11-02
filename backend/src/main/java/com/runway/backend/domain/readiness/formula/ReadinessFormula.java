package com.runway.backend.domain.readiness.formula;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * 러닝 준비도 1차 산식(S15P31E105-121 설계, docs/design/readiness-formula.md). 상태 없는 순수 계산이다.
 *
 * <p>평가 날짜 D의 수면(S)·회복(R)·부하(L) 점수를 각각 구해, 계산된 항목의 평균에 최저 항목 기반 상한을 적용한다. 입력이 부족한 항목은 제외하고
 * 신뢰도로 구분한다. 미측정 값을 0점으로 채우지 않는다. 항목 점수와 최종 점수는 소수 둘째 자리(HALF_UP)로 반올림한다.
 */
public final class ReadinessFormula {

    /** 평가에 필요한 가장 오래된 날짜까지의 일수(부하 28일 창: D-27~D). */
    public static final int LOOKBACK_DAYS = 27;

    /** 회복 기준 RHR(D-7~D-1 평균)에 필요한 최소 측정 일수. */
    static final int MIN_BASELINE_RHR_DAYS = 3;

    private static final MathContext MC = MathContext.DECIMAL64;
    private static final BigDecimal HUNDRED = BigDecimal.valueOf(100);
    private static final BigDecimal[] SLEEP_WEIGHTS = {
        new BigDecimal("0.5"), new BigDecimal("0.3"), new BigDecimal("0.2")
    };

    private ReadinessFormula() {}

    /**
     * @param date 평가 날짜 D
     * @param inputs 일별 건강값. D-27~D 밖의 날짜는 쓰지 않는다. 날짜는 중복되지 않아야 한다(DB 유니크 키)
     * @return 계산 가능한 항목이 하나도 없으면 빈 값
     */
    public static Optional<ReadinessScore> evaluate(LocalDate date, List<DailyHealthInput> inputs) {
        Map<LocalDate, DailyHealthInput> byDate = new HashMap<>();
        for (DailyHealthInput input : inputs) {
            byDate.put(input.metricDate(), input);
        }
        BigDecimal sleep = sleepScore(date, byDate);
        BigDecimal recovery = recoveryScore(date, byDate);
        BigDecimal load = loadScore(date, byDate);

        BigDecimal sum = BigDecimal.ZERO;
        BigDecimal min = null;
        int count = 0;
        for (BigDecimal score : new BigDecimal[] {sleep, recovery, load}) {
            if (score == null) {
                continue;
            }
            count++;
            sum = sum.add(score);
            min = min == null ? score : min.min(score);
        }
        if (count == 0) {
            return Optional.empty();
        }
        BigDecimal base = sum.divide(BigDecimal.valueOf(count), MC);
        BigDecimal readiness = round(base.min(cap(min)));
        return Optional.of(
                new ReadinessScore(
                        readiness,
                        ReadinessConfidence.ofComponentCount(count),
                        sleep,
                        recovery,
                        load));
    }

    /** 최저 항목 기반 상한. 70 이상 100, 50 이상 84, 30 이상 69, 그 밖 49. */
    static BigDecimal cap(BigDecimal lowest) {
        if (lowest.compareTo(BigDecimal.valueOf(70)) >= 0) {
            return HUNDRED;
        }
        if (lowest.compareTo(BigDecimal.valueOf(50)) >= 0) {
            return BigDecimal.valueOf(84);
        }
        if (lowest.compareTo(BigDecimal.valueOf(30)) >= 0) {
            return BigDecimal.valueOf(69);
        }
        return BigDecimal.valueOf(49);
    }

    /** S = 0.5·D0 + 0.3·D1 + 0.2·D2. 수면값이 있는 날만 가중치를 다시 나눠 계산한다. */
    static BigDecimal sleepScore(LocalDate date, Map<LocalDate, DailyHealthInput> byDate) {
        BigDecimal weighted = BigDecimal.ZERO;
        BigDecimal weights = BigDecimal.ZERO;
        for (int i = 0; i < SLEEP_WEIGHTS.length; i++) {
            DailyHealthInput day = byDate.get(date.minusDays(i));
            if (day == null || day.sleepDurationMin() == null) {
                continue;
            }
            weighted = weighted.add(SLEEP_WEIGHTS[i].multiply(sleepHoursScore(day.sleepDurationMin())));
            weights = weights.add(SLEEP_WEIGHTS[i]);
        }
        if (weights.signum() == 0) {
            return null;
        }
        return round(weighted.divide(weights, MC));
    }

    /**
     * 수면시간 점수. 7h 이상 100, 6h 70, 5h 40, 4h 10 사이는 선형 보간, 4h 미만은 0~10 선형. 경계는 분 단위로 정확히 비교한다(240·300·360·420분).
     */
    static BigDecimal sleepHoursScore(BigDecimal sleepMinutes) {
        BigDecimal minutes = sleepMinutes.max(BigDecimal.ZERO);
        if (minutes.compareTo(BigDecimal.valueOf(420)) >= 0) {
            return HUNDRED;
        }
        if (minutes.compareTo(BigDecimal.valueOf(240)) >= 0) {
            // 4h 10점에서 1시간(60분)마다 30점, 즉 1분에 0.5점씩 오른다(240→10, 300→40, 360→70, 420→100).
            return BigDecimal.TEN.add(minutes.subtract(BigDecimal.valueOf(240)).multiply(new BigDecimal("0.5")));
        }
        // 10 × 시간 / 4 = 분 / 24
        return minutes.divide(BigDecimal.valueOf(24), MC);
    }

    /**
     * 오늘 RHR이 평소(D-7~D-1 평균) 대비 얼마나 올랐는지로 판단한다. 오늘 값이 없거나 평소 값이 3일 미만이면 계산하지 않는다.
     */
    static BigDecimal recoveryScore(LocalDate date, Map<LocalDate, DailyHealthInput> byDate) {
        DailyHealthInput today = byDate.get(date);
        if (today == null || today.restingHrBpm() == null) {
            return null;
        }
        BigDecimal sum = BigDecimal.ZERO;
        int days = 0;
        for (int i = 1; i <= 7; i++) {
            DailyHealthInput day = byDate.get(date.minusDays(i));
            if (day != null && day.restingHrBpm() != null) {
                sum = sum.add(day.restingHrBpm());
                days++;
            }
        }
        if (days < MIN_BASELINE_RHR_DAYS || sum.signum() <= 0) {
            return null;
        }
        return recoveryStep(today.restingHrBpm(), sum, days);
    }

    /**
     * 변화율 구간(상단 포함): ≤3% 100, ≤5% 90, ≤8% 80, ≤12% 65, ≤15% 50, 초과 35.
     *
     * <p>평균을 나눗셈으로 구하면 반올림 오차로 정확히 +5%인 입력이 5%를 조금 넘는 값이 되어 한 단계 낮게 나온다. 그래서 변화율 ≤ k%를 나눗셈 없이
     * {@code (오늘 × 일수 − 합) × 100 ≤ k × 합}으로 비교한다(합 > 0).
     */
    static BigDecimal recoveryStep(BigDecimal todayRhr, BigDecimal baselineSum, int baselineDays) {
        BigDecimal scaledChange =
                todayRhr.multiply(BigDecimal.valueOf(baselineDays)).subtract(baselineSum).multiply(HUNDRED);
        int[][] steps = {{3, 100}, {5, 90}, {8, 80}, {12, 65}, {15, 50}};
        for (int[] step : steps) {
            if (scaledChange.compareTo(baselineSum.multiply(BigDecimal.valueOf(step[0]))) <= 0) {
                return round(BigDecimal.valueOf(step[1]));
            }
        }
        return round(BigDecimal.valueOf(35));
    }

    /**
     * 최근 7일(D-6~D) 부하 합 / 평소 주간 부하(D-27~D 합 ÷ 4). 28일 창에 부하 값이 하루도 없거나 평소 부하가 0이면 계산하지 않는다. 값이 없는 날은
     * 운동하지 않은 날(0)로 본다.
     */
    static BigDecimal loadScore(LocalDate date, Map<LocalDate, DailyHealthInput> byDate) {
        BigDecimal acute = BigDecimal.ZERO;
        BigDecimal total = BigDecimal.ZERO;
        boolean measured = false;
        for (int i = 0; i <= LOOKBACK_DAYS; i++) {
            DailyHealthInput day = byDate.get(date.minusDays(i));
            if (day == null || day.dailyTrainingLoad() == null) {
                continue;
            }
            measured = true;
            total = total.add(day.dailyTrainingLoad());
            if (i < 7) {
                acute = acute.add(day.dailyTrainingLoad());
            }
        }
        if (!measured || total.signum() <= 0) {
            return null;
        }
        return loadRatioScore(acute, total);
    }

    /**
     * 부하 비율(최근 7일 합 ÷ (28일 합 ÷ 4)) 점수. ≤1.0 100, 1.0~1.2 100→90, 1.2~1.4 90→80, 1.4~1.6 80→65, 1.6~2.0 65→50
     * 선형, 2.0 초과 35. 구간 판정은 나눗셈 없이 {@code 최근 7일 합 × 4 ≤ k × 28일 합}으로 정확히 비교한다(28일 합 > 0).
     */
    static BigDecimal loadRatioScore(BigDecimal acute, BigDecimal total) {
        BigDecimal scaledAcute = acute.multiply(BigDecimal.valueOf(4));
        BigDecimal ratio = scaledAcute.divide(total, MC);
        String[][] segments = {
            {"1.0", "1.2", "100", "90"},
            {"1.2", "1.4", "90", "80"},
            {"1.4", "1.6", "80", "65"},
            {"1.6", "2.0", "65", "50"}
        };
        if (scaledAcute.compareTo(total) <= 0) {
            return round(HUNDRED);
        }
        for (String[] segment : segments) {
            if (scaledAcute.compareTo(total.multiply(new BigDecimal(segment[1]))) <= 0) {
                return round(interpolate(ratio, segment[0], segment[1], segment[2], segment[3]));
            }
        }
        return round(BigDecimal.valueOf(35));
    }

    private static BigDecimal interpolate(
            BigDecimal x, String fromX, String toX, String fromScore, String toScore) {
        BigDecimal x0 = new BigDecimal(fromX);
        BigDecimal x1 = new BigDecimal(toX);
        BigDecimal y0 = new BigDecimal(fromScore);
        BigDecimal y1 = new BigDecimal(toScore);
        BigDecimal fraction = x.subtract(x0).divide(x1.subtract(x0), MC);
        return y0.add(fraction.multiply(y1.subtract(y0)));
    }

    private static BigDecimal round(BigDecimal value) {
        return value.setScale(2, RoundingMode.HALF_UP);
    }
}
