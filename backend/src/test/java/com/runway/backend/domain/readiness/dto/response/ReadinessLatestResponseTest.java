package com.runway.backend.domain.readiness.dto.response;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.Arrays;
import java.util.List;
import java.util.Objects;
import org.junit.jupiter.api.Test;

/** S15P31E105-639 AC-2. 날짜별 부하 합 보존 반올림. 기대값은 손으로 계산했다. */
class ReadinessLatestResponseTest {

    private static List<BigDecimal> values(String... raw) {
        return Arrays.stream(raw).map(v -> v == null ? null : new BigDecimal(v)).toList();
    }

    private static BigDecimal sum(List<BigDecimal> values) {
        return values.stream().filter(Objects::nonNull).reduce(BigDecimal.ZERO, BigDecimal::add);
    }

    @Test
    void 각_날_반올림_합이_주간_합과_다르면_소수부가_큰_날에_0_01을_더한다() {
        // 원값 합 3.0150 → 3.02. 각 날 HALF_UP이면 1.01 × 3 = 3.03으로 어긋난다.
        List<BigDecimal> raw = values("1.0050", "1.0050", "1.0050");

        List<BigDecimal> rounded = ReadinessLatestResponse.roundPreservingSum(raw);

        // 내림 1.00 × 3 = 3.00, 모자란 0.02를 소수부가 같으므로 앞 날짜부터 배분
        assertThat(rounded)
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactly(new BigDecimal("1.01"), new BigDecimal("1.01"), new BigDecimal("1.00"));
        assertThat(sum(rounded)).isEqualByComparingTo(sum(raw).setScale(2, RoundingMode.HALF_UP));
    }

    @Test
    void 소수부가_큰_날이_먼저_받고_null은_그대로_둔다() {
        // 합 10.0160 → 10.02. 내림 합 10.00, 0.02 배분: 소수부 0.0090(D-4) > 0.0050(D-6) > 0.0020(D)
        List<BigDecimal> raw =
                values("2.0050", null, "3.0090", null, null, null, "5.0020");

        List<BigDecimal> rounded = ReadinessLatestResponse.roundPreservingSum(raw);

        assertThat(rounded.get(0)).isEqualByComparingTo("2.01");
        assertThat(rounded.get(1)).isNull();
        assertThat(rounded.get(2)).isEqualByComparingTo("3.01");
        assertThat(rounded.get(3)).isNull();
        assertThat(rounded.get(6)).isEqualByComparingTo("5.00");
        assertThat(sum(rounded)).isEqualByComparingTo("10.02");
        for (int i = 0; i < raw.size(); i++) {
            if (raw.get(i) != null) {
                assertThat(rounded.get(i).subtract(raw.get(i)).abs()).isLessThan(new BigDecimal("0.01"));
                assertThat(rounded.get(i).scale()).isEqualTo(2);
            }
        }
    }

    @Test
    void 이미_둘째_자리인_값과_전부_null은_바꾸지_않는다() {
        assertThat(ReadinessLatestResponse.roundPreservingSum(values("120.0000", "0.0000", "95.5000")))
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactly(new BigDecimal("120.00"), new BigDecimal("0.00"), new BigDecimal("95.50"));
        assertThat(ReadinessLatestResponse.roundPreservingSum(values(null, null, null)))
                .containsExactly(null, null, null);
    }
}
