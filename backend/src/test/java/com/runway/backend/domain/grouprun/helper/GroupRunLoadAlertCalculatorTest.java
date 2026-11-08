package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.grouprun.dto.response.GroupRunLiveResponse.LoadAlert;
import java.math.BigDecimal;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class GroupRunLoadAlertCalculatorTest {

    @Test
    void evaluate_paceAtOrBelowGuideMinus30_isStrained() {
        // 경계: guide-30(=330)은 포함, 331은 제외
        LoadAlert alert = GroupRunLoadAlertCalculator.evaluate(360, List.of(330, 331, 300, 400));

        assertThat(alert).isEqualTo(new LoadAlert(2, 375));
    }

    @Test
    void evaluate_noStrained_returnsNull() {
        assertThat(GroupRunLoadAlertCalculator.evaluate(360, List.of(331, 360, 420))).isNull();
    }

    @Test
    void evaluate_nullGuideOrNoPaces_returnsNull() {
        assertThat(GroupRunLoadAlertCalculator.evaluate(null, List.of(100))).isNull();
        assertThat(GroupRunLoadAlertCalculator.evaluate(360, null)).isNull();
        assertThat(GroupRunLoadAlertCalculator.evaluate(360, List.of())).isNull();
        assertThat(GroupRunLoadAlertCalculator.evaluate(360, Arrays.asList(null, null))).isNull();
    }

    @Test
    void toPaceSecPerKm_roundsPositive_andRejectsInvalid() {
        assertThat(GroupRunLoadAlertCalculator.toPaceSecPerKm(new BigDecimal("320.50")))
                .isEqualTo(321);
        assertThat(GroupRunLoadAlertCalculator.toPaceSecPerKm(null)).isNull();
        assertThat(GroupRunLoadAlertCalculator.toPaceSecPerKm(BigDecimal.ZERO)).isNull();
        assertThat(GroupRunLoadAlertCalculator.toPaceSecPerKm(new BigDecimal("-5"))).isNull();
    }
}
