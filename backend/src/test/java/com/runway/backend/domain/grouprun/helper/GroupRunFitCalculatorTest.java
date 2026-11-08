package com.runway.backend.domain.grouprun.helper;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse.ComfortRange;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

class GroupRunFitCalculatorTest {

    private static List<BigDecimal> paces(String... values) {
        List<BigDecimal> list = new ArrayList<>();
        for (String value : values) {
            list.add(value == null ? null : new BigDecimal(value));
        }
        return list;
    }

    @Test
    void recentPace_isRoundedMean_ofUpToFiveLatest() {
        assertThat(GroupRunFitCalculator.recentPaceSecPerKm(paces("300", "330"))).isEqualTo(315);
        // 반올림: (300 + 301) / 2 = 300.5 -> 301
        assertThat(GroupRunFitCalculator.recentPaceSecPerKm(paces("300", "301"))).isEqualTo(301);
        // 6번째 값은 반영하지 않는다.
        assertThat(
                        GroupRunFitCalculator.recentPaceSecPerKm(
                                paces("300", "300", "300", "300", "300", "900")))
                .isEqualTo(300);
    }

    @Test
    void recentPace_nullWhenNoValidValue() {
        assertThat(GroupRunFitCalculator.recentPaceSecPerKm(null)).isNull();
        assertThat(GroupRunFitCalculator.recentPaceSecPerKm(List.of())).isNull();
        assertThat(GroupRunFitCalculator.recentPaceSecPerKm(paces(null, "0"))).isNull();
    }

    @Test
    void comfortRange_twoOrMorePaces_isMinMax() {
        assertThat(GroupRunFitCalculator.comfortRange(List.of(330, 300, 360), 999))
                .isEqualTo(new ComfortRange(300, 360));
        assertThat(GroupRunFitCalculator.comfortRange(List.of(320, 320), null))
                .isEqualTo(new ComfortRange(320, 320));
    }

    @Test
    void comfortRange_underTwoPaces_fallsBackToGuidePaceSpread() {
        assertThat(GroupRunFitCalculator.comfortRange(List.of(300), 350))
                .isEqualTo(new ComfortRange(330, 370));
        assertThat(GroupRunFitCalculator.comfortRange(List.of(), 350))
                .isEqualTo(new ComfortRange(330, 370));
    }

    @Test
    void comfortRange_nullWithoutPacesAndGuide() {
        assertThat(GroupRunFitCalculator.comfortRange(List.of(), null)).isNull();
        assertThat(GroupRunFitCalculator.comfortRange(List.of(300), null)).isNull();
    }
}
