package com.runway.backend.domain.readiness.trainingload;

import com.runway.backend.domain.runningrecord.helper.KarvonenHeartRateZoneHelper;
import com.runway.backend.domain.runningrecord.helper.KarvonenHeartRateZoneHelper.ZoneBounds;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.SortedMap;
import java.util.TreeMap;

/**
 * 운동 1건의 심박 Zone 부하(Edwards TRIMP) 계산(S15P31E105-599, docs/design/readiness-formula.md 5절). 상태 없는 순수 계산이다.
 *
 * <p>입력은 "bpm(정수)별 머문 초" 히스토그램이다. RunWay 러닝은 서버가 심박 샘플로 {@link #histogram(List)}를 만들고, 삼성 헬스 운동은 폰이 같은
 * 규칙으로 만든 값을 W06으로 받는다. Zone은 기록 통계(H06)와 같은 Karvonen 기준이며 Zone N 머문 분 × N의 합이 부하다.
 */
public final class TrainingLoadCalculator {

    /** 샘플 하나가 대표하는 최대 시간. 이보다 긴 간격은 측정 공백으로 보고 60초만 센다. */
    public static final long MAX_DWELL_MILLIS = 60_000;

    public static final int MIN_BPM = 30;
    public static final int MAX_BPM = 220;

    private static final int ZONES = 5;

    private TrainingLoadCalculator() {}

    /** 측정 시각과 심박. */
    public record Sample(Instant measuredAt, double bpm) {}

    /**
     * @param zoneSeconds Zone1..5 머문 초(길이 5)
     * @param trainingLoad Σ(Zone N 초 ÷ 60 × N), 소수 넷째 자리(HALF_UP)
     */
    public record Result(List<Integer> zoneSeconds, BigDecimal trainingLoad) {
        public Result {
            zoneSeconds = List.copyOf(zoneSeconds);
        }

        public int zoneSeconds(int zone) {
            return zoneSeconds.get(zone - 1);
        }
    }

    /**
     * 샘플 → bpm별 머문 초. 유효 샘플(30~220bpm, 유한값)을 시각 오름차순(같은 시각은 입력 순서)으로 보고, 같은 시각의 두 번째 이후 샘플은 버린다. 샘플 i의
     * 머문 시간은 {@code min(다음 유효 샘플 시각 − i 시각, 60초)}이고 마지막 샘플은 0이다. bpm은 반올림(HALF_UP) 정수다. 밀리초로 더한 뒤 bpm마다
     * 초로 반올림(HALF_UP)하고 0초인 bpm은 넣지 않는다.
     *
     * @param samples 시각 오름차순으로 정렬된 샘플(같은 시각은 저장 순서)
     */
    public static SortedMap<Integer, Integer> histogram(List<Sample> samples) {
        List<Sample> valid =
                samples.stream()
                        .filter(
                                s ->
                                        s.measuredAt() != null
                                                && Double.isFinite(s.bpm())
                                                && s.bpm() >= MIN_BPM
                                                && s.bpm() <= MAX_BPM)
                        .toList();
        SortedMap<Integer, Long> millis = new TreeMap<>();
        Sample current = null;
        for (Sample next : valid) {
            if (current != null && next.measuredAt().equals(current.measuredAt())) {
                continue;
            }
            if (current != null) {
                long gap = Duration.between(current.measuredAt(), next.measuredAt()).toMillis();
                millis.merge(roundBpm(current.bpm()), Math.min(Math.max(gap, 0), MAX_DWELL_MILLIS), Long::sum);
            }
            current = next;
        }
        SortedMap<Integer, Integer> seconds = new TreeMap<>();
        for (Map.Entry<Integer, Long> entry : millis.entrySet()) {
            int value =
                    BigDecimal.valueOf(entry.getValue())
                            .divide(BigDecimal.valueOf(1000), 0, RoundingMode.HALF_UP)
                            .intValueExact();
            if (value > 0) {
                seconds.put(entry.getKey(), value);
            }
        }
        return Collections.unmodifiableSortedMap(seconds);
    }

    /**
     * 히스토그램 → Zone별 초와 부하. HRR(= hrMax − rhr)이 0 이하이면 모든 Zone이 0이다. rhr이 0이면 Zone은 HRmax 비율(50·60·70·80·90%)이다.
     *
     * @param histogram bpm(30~220 정수) → 머문 초(양수)
     */
    public static Result calculate(Map<Integer, Integer> histogram, double hrMax, double rhr) {
        List<ZoneBounds> bounds = KarvonenHeartRateZoneHelper.zoneBounds(hrMax, rhr);
        int[] zones = new int[ZONES];
        for (Map.Entry<Integer, Integer> entry : histogram.entrySet()) {
            int zone = KarvonenHeartRateZoneHelper.classify(entry.getKey(), bounds);
            if (zone >= 1 && zone <= ZONES) {
                zones[zone - 1] = Math.addExact(zones[zone - 1], entry.getValue());
            }
        }
        long weighted = 0;
        for (int zone = 1; zone <= ZONES; zone++) {
            weighted += (long) zones[zone - 1] * zone;
        }
        BigDecimal load =
                BigDecimal.valueOf(weighted).divide(BigDecimal.valueOf(60), 4, RoundingMode.HALF_UP);
        return new Result(List.of(zones[0], zones[1], zones[2], zones[3], zones[4]), load);
    }

    private static int roundBpm(double bpm) {
        return BigDecimal.valueOf(bpm).setScale(0, RoundingMode.HALF_UP).intValueExact();
    }
}
