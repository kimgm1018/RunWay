package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class GroupGuidePaceCalculatorTest {

    @Test
    void median_odd_and_even_and_empty() {
        assertThat(GroupGuidePaceCalculator.medianSecPerKm(List.of(300, 360, 400))).isEqualTo(360);
        assertThat(GroupGuidePaceCalculator.medianSecPerKm(List.of(300, 400))).isEqualTo(350);
        assertThat(GroupGuidePaceCalculator.medianSecPerKm(List.of())).isNull();
        List<BigDecimal> withNull = new ArrayList<>();
        withNull.add(new BigDecimal("320.5"));
        withNull.add(new BigDecimal("0"));
        withNull.add(null);
        assertThat(GroupGuidePaceCalculator.medianSecPerKmFromBigDecimals(withNull)).isEqualTo(321);
    }
}
