package com.runway.backend.domain.readiness.dto.response;

import com.runway.backend.domain.readiness.formula.ReadinessFormula;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LatestReadinessRow;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository.LoadWindow;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;

/**
 * R02 응답이며 R03 날짜별 조회(S15P31E105-660)도 같은 형식을 쓴다. readinessConfidence는 미산출이면 null로 포함한다(신뢰도이며 준비도 등급이 아니다). 건강 지표는 readinessDate와 같은 날짜의
 * 본인 일별 건강 행 값이며, 행이나 값이 없으면 null로 포함한다.
 *
 * @param readinessDate 준비도 기준일(워치 시간대 날짜). 클라이언트가 오늘 결과인지 판단한다
 * @param restingHrBpm 기준일 안정시 심박수(bpm)
 * @param restingHrSource 안정시 심박 출처(RUNWAY_WATCH·SAMSUNG_HEALTH, S15P31E105-600). 값이 없으면 null
 * @param sleepDurationMin 기준일 수면시간(분)
 * @param healthUpdatedAt 기준일 건강 행의 마지막 변경 시각(준비도 평가 시각이 아니다)
 * @param weeklyTrainingLoad readinessDate 기준 D-6~D 부하 합(S15P31E105-599). D-27~D에 부하 값이 없으면 null
 * @param usualWeeklyTrainingLoad 평소 주간 부하(28일 합 × 7 ÷ 이력 일수). D-27~D에 부하 값이 없으면 null
 * @param dailyTrainingLoads D-6~D 날짜별 부하 7개(날짜 오름차순, S15P31E105-639). 값 없는 날 load는 null. load 합 =
 *     weeklyTrainingLoad
 * @param sleepScore 이 점수 계산에 쓴 수면 항목 점수. 제외 항목·V30 이전 결과는 null(recoveryScore·loadScore도 같다)
 * @param restingHrChangePct R 계산에 쓴 평소 대비 기준일 안정시 심박 변화율(%). R이 제외되면 null
 */
public record ReadinessLatestResponse(
        long id,
        BigDecimal readinessScore,
        LocalDate readinessDate,
        String readinessConfidence,
        BigDecimal restingHrBpm,
        String restingHrSource,
        BigDecimal sleepDurationMin,
        Instant healthUpdatedAt,
        BigDecimal weeklyTrainingLoad,
        BigDecimal usualWeeklyTrainingLoad,
        List<DailyTrainingLoad> dailyTrainingLoads,
        BigDecimal sleepScore,
        BigDecimal recoveryScore,
        BigDecimal loadScore,
        BigDecimal restingHrChangePct) {

    /** 하루 부하. load는 소수 둘째 자리이며 값 없는 날(운동 없음·심박 없음)은 null이다. 0으로 채우지 않는다. */
    public record DailyTrainingLoad(LocalDate date, BigDecimal load) {}

    public static ReadinessLatestResponse from(LatestReadinessRow row) {
        LoadWindow load = row.load();
        BigDecimal weekly = null;
        BigDecimal usual = null;
        if (load != null) {
            weekly = load.weeklySum().setScale(2, RoundingMode.HALF_UP);
            usual =
                    ReadinessFormula.usualWeeklyLoad(
                            load.totalSum(),
                            ReadinessFormula.historyDays(row.readinessDate(), load.firstLoadDate()));
        }
        List<BigDecimal> rounded = roundPreservingSum(row.dailyLoads());
        List<DailyTrainingLoad> daily = new ArrayList<>(rounded.size());
        LocalDate first = row.readinessDate().minusDays(rounded.size() - 1L);
        for (int i = 0; i < rounded.size(); i++) {
            daily.add(new DailyTrainingLoad(first.plusDays(i), rounded.get(i)));
        }
        return new ReadinessLatestResponse(
                row.id(),
                row.readinessScore(),
                row.readinessDate(),
                row.confidence(),
                row.restingHrBpm(),
                row.restingHrSource(),
                row.sleepDurationMin(),
                row.healthUpdatedAt(),
                weekly,
                usual,
                List.copyOf(daily),
                row.sleepScore(),
                row.recoveryScore(),
                row.loadScore(),
                row.restingHrChangePct());
    }

    /**
     * 합 보존 반올림(S15P31E105-639). 각 값을 소수 둘째 자리로 내린 뒤, 원값 합을 HALF_UP으로 반올림한 합이 되도록 모자란 0.01을 버린 소수부가 큰
     * 값부터(같으면 앞 날짜) 하나씩 더한다. 각 값의 오차는 0.01 미만이고, null이 아닌 값의 합은 {@code weeklyTrainingLoad}(원값 합의
     * HALF_UP)와 같다. null은 그대로 둔다.
     */
    static List<BigDecimal> roundPreservingSum(List<BigDecimal> values) {
        BigDecimal[] result = new BigDecimal[values.size()];
        BigDecimal[] remainders = new BigDecimal[values.size()];
        BigDecimal rawSum = BigDecimal.ZERO;
        BigDecimal floorSum = BigDecimal.ZERO;
        List<Integer> present = new ArrayList<>();
        for (int i = 0; i < values.size(); i++) {
            BigDecimal value = values.get(i);
            if (value == null) {
                continue;
            }
            BigDecimal floor = value.setScale(2, RoundingMode.FLOOR);
            result[i] = floor;
            remainders[i] = value.subtract(floor);
            rawSum = rawSum.add(value);
            floorSum = floorSum.add(floor);
            present.add(i);
        }
        int missingUnits =
                rawSum.setScale(2, RoundingMode.HALF_UP)
                        .subtract(floorSum)
                        .movePointRight(2)
                        .intValueExact();
        present.sort(
                Comparator.comparing((Integer i) -> remainders[i])
                        .reversed()
                        .thenComparing(i -> i));
        BigDecimal unit = new BigDecimal("0.01");
        for (int k = 0; k < missingUnits; k++) {
            int i = present.get(k);
            result[i] = result[i].add(unit);
        }
        return Arrays.asList(result);
    }
}
