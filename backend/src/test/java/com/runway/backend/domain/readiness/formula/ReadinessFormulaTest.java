package com.runway.backend.domain.readiness.formula;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Nested;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * 254 AC-1·AC-2. 121 설계 문서 예시값과 서버 해석(경계·보간·결측)을 확인한다. 기대값은 문서 표와 예시에서 손으로 계산한 값이며 구현을 복사하지 않는다.
 * 모든 건강값은 합성 데이터다.
 */
class ReadinessFormulaTest {

    private static final LocalDate D = LocalDate.of(2026, 10, 30);

    private static BigDecimal bd(String value) {
        return new BigDecimal(value);
    }

    private static DailyHealthInput day(int daysBefore, String sleepMin, String rhr, String load) {
        return new DailyHealthInput(
                D.minusDays(daysBefore),
                sleepMin == null ? null : bd(sleepMin),
                rhr == null ? null : bd(rhr),
                load == null ? null : bd(load));
    }

    @Nested
    class 문서_예시 {

        @Test
        void 수면_7_6_5시간_S는_79() {
            Optional<ReadinessScore> score =
                    ReadinessFormula.evaluate(
                            D, List.of(day(0, "420", null, null), day(1, "360", null, null), day(2, "300", null, null)));

            assertThat(score).isPresent();
            assertThat(score.get().sleepScore()).isEqualByComparingTo("79");
            assertThat(score.get().recoveryScore()).isNull();
            assertThat(score.get().loadScore()).isNull();
            assertThat(score.get().confidence()).isEqualTo(ReadinessConfidence.LOW);
            // 단일 항목 79: 평균 79, 최저 79 → 상한 100
            assertThat(score.get().readinessScore()).isEqualByComparingTo("79.00");
        }

        @Test
        void 평소_RHR_60_오늘_66이면_10퍼센트_증가로_R은_65() {
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, null, "66", null));
            for (int i = 1; i <= 7; i++) {
                inputs.add(day(i, null, "60", null));
            }

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.recoveryScore()).isEqualByComparingTo("65");
            assertThat(score.readinessScore()).isEqualByComparingTo("65.00");
        }

        @Test
        void 최근7일_410_평소주간_400이면_비율_1_025로_L은_98_75() {
            // 28일 합 1600(주 평균 400), 최근 7일 410: D-6~D에 410, D-27~D-7에 1190.
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, null, null, "410"));
            inputs.add(day(10, null, null, "1190"));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("98.75");
        }

        @Test
        void 수면90_회복80_부하70이면_평균80() {
            // 문서 예시 (90+80+70)/3 = 80, 최저 70 → 상한 100 → 80.
            // S: 6h40m(400분)×3일 → 90. R: 평소 60, 오늘 64 → +6.67% → 80.
            // L: 최근 7일 460, 28일 합 1200(주 300) → 비율 1.5333 → 80 − (0.1333/0.2)×15 = 70.
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, "400", "64", "460"));
            inputs.add(day(1, "400", "60", null));
            inputs.add(day(2, "400", "60", null));
            inputs.add(day(3, null, "60", null));
            inputs.add(day(10, null, null, "740"));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.sleepScore()).isEqualByComparingTo("90");
            assertThat(score.recoveryScore()).isEqualByComparingTo("80");
            assertThat(score.loadScore()).isEqualByComparingTo("70");
            assertThat(score.readinessScore()).isEqualByComparingTo("80.00");
        }

        // 문서 예시 (100,100,20) → 평균 73.3, 상한 49는 부하 점수 최저가 35라 입력으로 재현할 수 없다. 같은 규칙(최저 30 미만 → 49)은
        // 상한 표 테스트와 세_항목_결합(최저 35 → 69)으로 확인한다.
    }

    @Nested
    class 세_항목_결합 {

        @Test
        void 세_항목이_모두_있으면_HIGH와_상한을_적용한다() {
            // S: 7h×3일 = 100. R: 오늘 60, 평소 60 → 0% → 100. L: 최근 7일 1000, 28일 합 1000 → 비율 4.0 → 35.
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, "420", "60", "1000"));
            inputs.add(day(1, "420", "60", null));
            inputs.add(day(2, "420", "60", null));
            inputs.add(day(3, null, "60", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.sleepScore()).isEqualByComparingTo("100");
            assertThat(score.recoveryScore()).isEqualByComparingTo("100");
            assertThat(score.loadScore()).isEqualByComparingTo("35");
            assertThat(score.confidence()).isEqualTo(ReadinessConfidence.HIGH);
            // 평균 78.33, 최저 35 → 상한 69
            assertThat(score.readinessScore()).isEqualByComparingTo("69.00");
        }

        @Test
        void 최저_항목이_30_미만이면_평균이_높아도_49로_제한한다() {
            // S: 1h×3일 → 2.5. R: 0% → 100. L: 최근 7일 없음, 28일 내 400 → 100. 평균 67.5, 최저 2.5 → 상한 49.
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, "60", "60", null));
            inputs.add(day(1, "60", "60", null));
            inputs.add(day(2, "60", "60", null));
            inputs.add(day(3, null, "60", null));
            inputs.add(day(20, null, null, "400"));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.sleepScore()).isEqualByComparingTo("2.5");
            assertThat(score.readinessScore()).isEqualByComparingTo("49.00");
        }

        @Test
        void 두_항목이면_MEDIUM이고_두_항목_평균을_쓴다() {
            List<DailyHealthInput> inputs = new ArrayList<>();
            inputs.add(day(0, "360", "60", null)); // 수면 6h만 → S 70
            for (int i = 1; i <= 3; i++) {
                inputs.add(day(i, null, "60", null)); // R 100
            }

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.confidence()).isEqualTo(ReadinessConfidence.MEDIUM);
            assertThat(score.loadScore()).isNull();
            // 평균 85, 최저 70 → 상한 100
            assertThat(score.readinessScore()).isEqualByComparingTo("85.00");
        }

        @Test
        void 계산할_항목이_없으면_결과가_없다() {
            // 오늘 RHR만 있고 평소 값이 없다 → R 불가. 수면·부하 없음.
            assertThat(ReadinessFormula.evaluate(D, List.of(day(0, null, "60", null)))).isEmpty();
            assertThat(ReadinessFormula.evaluate(D, List.of())).isEmpty();
        }
    }

    @Nested
    class 수면 {

        @ParameterizedTest
        @CsvSource({
            "600, 100", // 10h
            "420, 100", // 7h
            "390, 85", // 6.5h 보간
            "360, 70",
            "300, 40",
            "270, 25", // 4.5h
            "241, 10.5",
            "240, 10",
            "228, 9.5", // 3.8h → 10×3.8/4
            "120, 5", // 2h → 10×2/4
            "0, 0"
        })
        void 수면시간_점수는_표와_선형_보간을_따른다(String minutes, String expected) {
            assertThat(ReadinessFormula.sleepHoursScore(bd(minutes))).isEqualByComparingTo(expected);
        }

        @Test
        void 없는_날은_가중치를_다시_나눈다() {
            // D0 7h(100), D1 없음, D2 4h(10) → (0.5×100 + 0.2×10) / 0.7 = 74.2857…
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, List.of(day(0, "420", null, null), day(2, "240", null, null)))
                            .orElseThrow();

            assertThat(score.sleepScore()).isEqualByComparingTo("74.29");
        }

        @Test
        void 사흘_범위_밖의_수면은_쓰지_않는다() {
            assertThat(ReadinessFormula.evaluate(D, List.of(day(3, "420", null, null)))).isEmpty();
        }
    }

    @Nested
    class 회복 {

        /** 평소 RHR 100 × 3일(합 300). 오늘 값이 곧 변화율(+%)이 된다. */
        @ParameterizedTest
        @CsvSource({
            "90, 100",
            "103, 100",
            "103.01, 90",
            "105, 90",
            "105.01, 80",
            "108, 80",
            "108.01, 65",
            "112, 65",
            "112.01, 50",
            "115, 50",
            "115.01, 35"
        })
        void 변화율_구간은_상단을_포함한다(String todayRhr, String expected) {
            assertThat(ReadinessFormula.recoveryStep(bd(todayRhr), bd("300"), 3))
                    .isEqualByComparingTo(expected);
        }

        /** A-1 회귀: 평균이 나누어떨어지지 않아도 정확히 +5%·+8%는 상단 포함으로 판정한다. */
        @ParameterizedTest
        @CsvSource({
            "52.85, 90", // 평소 (50+50+51)/3 = 50.333…, ×1.05 = 52.85
            "54.36, 80" // ×1.08 = 54.36
        })
        void 나누어떨어지지_않는_평균의_정확한_경계도_상단을_포함한다(String todayRhr, String expected) {
            List<DailyHealthInput> inputs =
                    List.of(
                            day(0, null, todayRhr, null),
                            day(1, null, "50", null),
                            day(2, null, "50", null),
                            day(3, null, "51", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.recoveryScore()).isEqualByComparingTo(expected);
        }

        @Test
        void 평소_RHR이_3일_미만이면_계산하지_않는다() {
            List<DailyHealthInput> inputs =
                    List.of(day(0, null, "60", null), day(1, null, "60", null), day(2, null, "60", null));

            assertThat(ReadinessFormula.evaluate(D, inputs)).isEmpty();
        }

        @Test
        void 평소_RHR이_3일이면_계산하고_8일_전_값은_쓰지_않는다() {
            // D-8의 100bpm이 섞이면 평균이 바뀌어 점수가 달라진다.
            List<DailyHealthInput> inputs =
                    List.of(
                            day(0, null, "62", null),
                            day(1, null, "60", null),
                            day(4, null, "60", null),
                            day(7, null, "60", null),
                            day(8, null, "100", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            // (62-60)/60 = 3.33% → 90
            assertThat(score.recoveryScore()).isEqualByComparingTo("90");
        }

        @Test
        void 오늘_RHR이_없으면_계산하지_않는다() {
            List<DailyHealthInput> inputs = new ArrayList<>();
            for (int i = 1; i <= 7; i++) {
                inputs.add(day(i, null, "60", null));
            }

            assertThat(ReadinessFormula.evaluate(D, inputs)).isEmpty();
        }
    }

    @Nested
    class 부하 {

        /** 28일 합 400(평소 주간 100). 최근 7일 합이 곧 비율 × 100이 된다. */
        @ParameterizedTest
        @CsvSource({
            "50, 100",
            "100, 100",
            "110, 95",
            "120, 90",
            "130, 85",
            "140, 80",
            "150, 72.5",
            "160, 65",
            "180, 57.5",
            "200, 50",
            "201, 35"
        })
        void 비율_점수는_구간_선형_보간을_따른다(String acute, String expected) {
            assertThat(ReadinessFormula.loadRatioScore(bd(acute), bd("400")))
                    .isEqualByComparingTo(expected);
        }

        @Test
        void 최근_7일은_D_6까지이고_D_7은_평소에만_들어간다() {
            // D-6 120 → 최근 7일 120, 28일 합 400 → 비율 1.2 → 90. D-6을 빼면 최근 0 → 100이 된다.
            ReadinessScore included =
                    ReadinessFormula.evaluate(D, List.of(day(6, null, null, "120"), day(20, null, null, "280")))
                            .orElseThrow();
            // D-7 120 → 최근 7일 0 → 100. D-7을 넣으면 비율 1.2 → 90이 된다.
            ReadinessScore excluded =
                    ReadinessFormula.evaluate(D, List.of(day(7, null, null, "120"), day(20, null, null, "280")))
                            .orElseThrow();

            assertThat(included.loadScore()).isEqualByComparingTo("90");
            assertThat(excluded.loadScore()).isEqualByComparingTo("100");
        }

        @Test
        void 평소_부하는_D_27까지_포함한다() {
            // 최근 100, D-27 300 → 28일 합 400 → 비율 1.0 → 100. D-27을 빼면 합 100 → 비율 4 → 35.
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, List.of(day(0, null, null, "100"), day(27, null, null, "300")))
                            .orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("100");
        }

        @Test
        void D_28_부하는_평소에_넣지_않는다() {
            // D-28 300을 넣으면 비율 1.0 → 100. 빼면 합 100 → 비율 4 → 35.
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, List.of(day(0, null, null, "100"), day(28, null, null, "300")))
                            .orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("35");
        }

        @Test
        void 부하_값이_28일_내에_없으면_계산하지_않는다() {
            assertThat(ReadinessFormula.evaluate(D, List.of(day(28, null, null, "500")))).isEmpty();
        }

        @Test
        void 부하가_모두_0이면_계산하지_않는다() {
            assertThat(ReadinessFormula.evaluate(D, List.of(day(0, null, null, "0")))).isEmpty();
        }

        @Test
        void 최근_7일에_운동이_없으면_100이다() {
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, List.of(day(20, null, null, "400"))).orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("100");
        }
    }

    /** 599 AC-5. 부하 이력이 28일보다 짧으면 이력 일수 H로 평소 주간 부하를 나눈다(28일 합 × 7 ÷ H, H는 7~28). */
    @Nested
    class 부하_이력_보정 {

        private final List<DailyHealthInput> inputs =
                List.of(day(9, null, null, "100"), day(0, null, null, "100"));

        @Test
        void 첫_부하가_10일_전이면_평소는_합_x_7_나누기_10이다() {
            // 평소 = 200 × 7 / 10 = 140, 최근 7일 100 → 비율 0.71 → 100
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, inputs, D.minusDays(9)).orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("100");
            assertThat(ReadinessFormula.usualWeeklyLoad(bd("200"), 10)).isEqualByComparingTo("140.00");
        }

        @Test
        void 첫_부하를_모르면_28일_이력으로_본다() {
            // 평소 = 200 / 4 = 50, 최근 7일 100 → 비율 2.0 → 50
            assertThat(ReadinessFormula.evaluate(D, inputs).orElseThrow().loadScore())
                    .isEqualByComparingTo("50");
            assertThat(ReadinessFormula.evaluate(D, inputs, null).orElseThrow().loadScore())
                    .isEqualByComparingTo("50");
        }

        @Test
        void 이력이_28일_이상이면_기존_값과_같다() {
            assertThat(ReadinessFormula.evaluate(D, inputs, D.minusDays(40)).orElseThrow().loadScore())
                    .isEqualByComparingTo("50");
            assertThat(ReadinessFormula.evaluate(D, inputs, D.minusDays(27)).orElseThrow().loadScore())
                    .isEqualByComparingTo("50");
        }

        @Test
        void 이력이_7일보다_짧아도_7일로_나눈다() {
            // 오늘 하루 100: H = 7 → 평소 100, 비율 1.0 → 100
            ReadinessScore score =
                    ReadinessFormula.evaluate(D, List.of(day(0, null, null, "100")), D).orElseThrow();

            assertThat(score.loadScore()).isEqualByComparingTo("100");
        }

        @ParameterizedTest
        @CsvSource({"0, 7", "6, 7", "7, 8", "9, 10", "27, 28", "28, 28", "100, 28"})
        void 이력_일수는_7에서_28_사이다(int firstLoadDaysBefore, int expected) {
            assertThat(ReadinessFormula.historyDays(D, D.minusDays(firstLoadDaysBefore)))
                    .isEqualTo(expected);
        }

        @Test
        void 이력_보정에서도_구간_경계는_나눗셈_없이_비교한다() {
            // H = 14: 비율 = 최근 7일 × 14 / (7 × 28일 합). 28일 합 200, 최근 7일 120 → 1.2 정확히 → 90
            assertThat(ReadinessFormula.loadRatioScore(bd("120"), bd("200"), 14))
                    .isEqualByComparingTo("90");
        }
    }

    @Nested
    class 상한 {

        @ParameterizedTest
        @CsvSource({"100, 100", "70, 100", "69.99, 84", "50, 84", "49.99, 69", "30, 69", "29.99, 49", "0, 49"})
        void 최저_항목에_따라_상한이_정해진다(String lowest, String expected) {
            assertThat(ReadinessFormula.cap(bd(lowest))).isEqualByComparingTo(expected);
        }
    }

    /** S15P31E105-639 AC-3·AC-4. 항목 점수와 R 변화율을 함께 돌려주고, 최종 점수와 항목 점수의 관계가 성립한다. */
    @Nested
    class 항목_점수와_변화율 {

        @ParameterizedTest
        @CsvSource({
            "52.5, 5.0, 90", // 평소 50 → +5.0%(상단 포함 90)
            "48, -4.0, 100", // 평소보다 낮으면 음수
            "52.85, 5.0, 90", // 평소 50.333… → +5.0%(4.9999…가 아니라 정확히 5)
            "52.52, 5.1, 80", // +5.04% → 올림 5.1. R도 5% 초과라 80(HALF_UP이면 5.0으로 보여 90처럼 읽힌다)
            "50.01, 0.1, 100", // +0.02% → 올림 0.1
            "47.98, -4.0, 100" // −4.04% → +∞ 방향 올림 −4.0
        })
        void R_변화율은_R_계산과_같은_평소_RHR로_구해_소수_첫째_자리로_올림한다(
                String todayRhr, String expectedPct, String expectedR) {
            boolean uneven = todayRhr.equals("52.85");
            List<DailyHealthInput> inputs =
                    List.of(
                            day(0, null, todayRhr, null),
                            day(1, null, "50", null),
                            day(2, null, "50", null),
                            day(3, null, uneven ? "51" : "50", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.restingHrChangePct()).isEqualByComparingTo(expectedPct);
            assertThat(score.restingHrChangePct().scale()).isEqualTo(1);
            assertThat(score.recoveryScore()).isEqualByComparingTo(expectedR);
        }

        /** 리뷰 A-1·B-1 회귀: 표시 변화율로 판단한 R 구간이 실제 R 점수와 항상 같다. 평소 RHR 두 종류에 대해 0.01bpm 간격으로 확인한다. */
        @Test
        void 표시_변화율로_판단한_구간이_R_점수와_항상_같다() {
            for (String third : new String[] {"50", "51"}) {
                for (int hundredths = 4500; hundredths <= 6200; hundredths++) {
                    String today = BigDecimal.valueOf(hundredths, 2).toPlainString();
                    List<DailyHealthInput> inputs =
                            List.of(
                                    day(0, null, today, null),
                                    day(1, null, "50", null),
                                    day(2, null, "50", null),
                                    day(3, null, third, null));

                    ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

                    assertThat(score.recoveryScore())
                            .as("today=%s baseline3=%s pct=%s", today, third, score.restingHrChangePct())
                            .isEqualByComparingTo(stepOfDisplayedPct(score.restingHrChangePct()));
                }
            }
        }

        /** 산식 4절 표를 표시값(소수 첫째 자리)에 그대로 적용한 점수. */
        private BigDecimal stepOfDisplayedPct(BigDecimal pct) {
            int[][] steps = {{3, 100}, {5, 90}, {8, 80}, {12, 65}, {15, 50}};
            for (int[] step : steps) {
                if (pct.compareTo(BigDecimal.valueOf(step[0])) <= 0) {
                    return BigDecimal.valueOf(step[1]);
                }
            }
            return BigDecimal.valueOf(35);
        }

        @Test
        void R이_제외되면_변화율도_null이다() {
            // 평소 RHR 2일뿐 → R 제외, 수면만 계산
            List<DailyHealthInput> inputs =
                    List.of(
                            day(0, "420", "60", null),
                            day(1, null, "60", null),
                            day(2, null, "60", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.recoveryScore()).isNull();
            assertThat(score.restingHrChangePct()).isNull();
            assertThat(score.sleepScore()).isEqualByComparingTo("100");
        }

        @Test
        void 세_항목의_평균에_최저_항목_상한을_적용한_값이_최종_점수다() {
            // S: 오늘 6h(70)만 → 70. R: 평소 50, 오늘 56(+12%) → 65. L: 최근 7일만 부하 → 이력 보정 없음(28일) 비율 4 → 35
            List<DailyHealthInput> inputs =
                    List.of(
                            day(0, "360", "56", "100"),
                            day(1, null, "50", null),
                            day(2, null, "50", null),
                            day(3, null, "50", null));

            ReadinessScore score = ReadinessFormula.evaluate(D, inputs).orElseThrow();

            assertThat(score.sleepScore()).isEqualByComparingTo("70");
            assertThat(score.recoveryScore()).isEqualByComparingTo("65");
            assertThat(score.loadScore()).isEqualByComparingTo("35");
            assertThat(score.restingHrChangePct()).isEqualByComparingTo("12.0");
            // 평균 56.67, 최저 35 → 상한 69 → 56.67
            assertThat(score.readinessScore()).isEqualByComparingTo("56.67");
            assertThat(score.confidence()).isEqualTo(ReadinessConfidence.HIGH);
        }
    }
}
