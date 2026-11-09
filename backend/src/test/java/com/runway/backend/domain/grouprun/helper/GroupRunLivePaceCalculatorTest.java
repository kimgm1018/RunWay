package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import org.junit.jupiter.api.Test;

class GroupRunLivePaceCalculatorTest {

    @Test
    void fromAverageSpeedMps_convertsAndRounds() {
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(new BigDecimal("3.125")))
                .isEqualTo(320);
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(new BigDecimal("2.5")))
                .isEqualTo(400);
        // 1000 / (1000/321) = 321
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(BigDecimal.valueOf(1000.0 / 321)))
                .isEqualTo(321);
    }

    @Test
    void fromAverageSpeedMps_rejectsInvalid() {
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(null)).isNull();
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(BigDecimal.ZERO)).isNull();
        assertThat(GroupRunLivePaceCalculator.fromAverageSpeedMps(new BigDecimal("-1"))).isNull();
    }
}
