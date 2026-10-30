package com.runway.backend.domain.runningrecord.helper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/**
 * 카르보넨(Karvonen) 심박 Zone 분류. 상위 경계 bpm은 다음 Zone에 포함한다(예: 60% → Zone2).
 */
public final class KarvonenHeartRateZoneHelper {

    private KarvonenHeartRateZoneHelper() {}

    public record ZoneRatio(int zone, BigDecimal ratio) {}

    public record ZoneBounds(double lowerInclusive, double upperExclusiveOrInclusive, boolean upperInclusive) {}

    /**
     * @param hrMax 최대 심박
     * @param rhr 안정시 심박
     * @return Zone1..5 하한/상한(bpm). HRR &lt;= 0이면 empty
     */
    public static List<ZoneBounds> zoneBounds(double hrMax, double rhr) {
        double hrr = hrMax - rhr;
        if (!(hrr > 0) || Double.isNaN(hrr) || Double.isInfinite(hrr)) {
            return List.of();
        }
        List<ZoneBounds> bounds = new ArrayList<>(5);
        for (int zone = 1; zone <= 5; zone++) {
            double lowerPct = 0.4 + zone * 0.1; // zone1 → 0.5
            double upperPct = lowerPct + 0.1;
            double lower = targetBpm(hrr, rhr, lowerPct);
            double upper = targetBpm(hrr, rhr, upperPct);
            boolean upperInclusive = zone == 5;
            bounds.add(new ZoneBounds(lower, upper, upperInclusive));
        }
        return bounds;
    }

    public static double targetBpm(double hrr, double rhr, double intensityFraction) {
        return (hrr * intensityFraction) + rhr;
    }

    /** @return 1..5, or 0 if outside all zones */
    public static int classify(double heartRateBpm, List<ZoneBounds> bounds) {
        if (bounds.size() != 5) {
            return 0;
        }
        for (int i = 0; i < 5; i++) {
            ZoneBounds b = bounds.get(i);
            if (heartRateBpm < b.lowerInclusive()) {
                continue;
            }
            if (b.upperInclusive()) {
                if (heartRateBpm <= b.upperExclusiveOrInclusive()) {
                    return i + 1;
                }
            } else if (heartRateBpm < b.upperExclusiveOrInclusive()) {
                return i + 1;
            }
        }
        return 0;
    }

    /**
     * 측정 샘플 대비 Zone 비율. 산정 불가(경계 없음·샘플 0)면 빈 목록.
     * Zone 밖 샘플도 분모에 포함하며, 반환은 항상 Zone 1..5이다.
     */
    public static List<ZoneRatio> ratios(List<Double> heartRatesBpm, double hrMax, double rhr) {
        List<ZoneBounds> bounds = zoneBounds(hrMax, rhr);
        if (bounds.isEmpty() || heartRatesBpm == null || heartRatesBpm.isEmpty()) {
            return List.of();
        }
        int[] counts = new int[6];
        int measured = 0;
        for (Double hr : heartRatesBpm) {
            if (hr == null || hr.isNaN() || hr.isInfinite()) {
                continue;
            }
            measured++;
            int zone = classify(hr, bounds);
            if (zone >= 1 && zone <= 5) {
                counts[zone]++;
            }
        }
        if (measured == 0) {
            return List.of();
        }
        List<ZoneRatio> ratios = new ArrayList<>(5);
        for (int zone = 1; zone <= 5; zone++) {
            BigDecimal ratio =
                    BigDecimal.valueOf(counts[zone])
                            .divide(BigDecimal.valueOf(measured), 6, RoundingMode.HALF_UP);
            ratios.add(new ZoneRatio(zone, ratio));
        }
        return ratios;
    }

    /** 만 나이 기준 HRmax = 220 - ageYears. */
    public static double hrMaxFromAge(int ageYears) {
        return 220.0 - ageYears;
    }
}
