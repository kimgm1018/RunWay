package com.runway.backend.domain.runningrecord.helper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.runway.backend.domain.runningrecord.helper.KarvonenHeartRateZoneHelper.ZoneBounds;
import com.runway.backend.domain.runningrecord.helper.KarvonenHeartRateZoneHelper.ZoneRatio;
import java.math.BigDecimal;
import java.util.List;
import org.junit.jupiter.api.Test;

class KarvonenHeartRateZoneHelperTest {

    // 30y, HRmax 190, RHR 60 → HRR 130
    // Zone1 125–138 (60% boundary → zone2), Zone2 138–151, ... Zone5 177–190

    @Test
    void 경계_bpm은_상위_Zone에_포함한다() {
        List<ZoneBounds> bounds = KarvonenHeartRateZoneHelper.zoneBounds(190, 60);
        assertThat(bounds).hasSize(5);

        assertThat(KarvonenHeartRateZoneHelper.classify(125, bounds)).isEqualTo(1);
        assertThat(KarvonenHeartRateZoneHelper.classify(137.9, bounds)).isEqualTo(1);
        assertThat(KarvonenHeartRateZoneHelper.classify(138, bounds)).isEqualTo(2); // 60%
        assertThat(KarvonenHeartRateZoneHelper.classify(151, bounds)).isEqualTo(3); // 70%
        assertThat(KarvonenHeartRateZoneHelper.classify(164, bounds)).isEqualTo(4); // 80%
        assertThat(KarvonenHeartRateZoneHelper.classify(177, bounds)).isEqualTo(5); // 90%
        assertThat(KarvonenHeartRateZoneHelper.classify(190, bounds)).isEqualTo(5); // 100%
        assertThat(KarvonenHeartRateZoneHelper.classify(124.9, bounds)).isEqualTo(0);
        assertThat(KarvonenHeartRateZoneHelper.classify(190.1, bounds)).isEqualTo(0);
    }

    @Test
    void 비율은_측정_샘플_대비_Zone별_비중() {
        List<ZoneRatio> ratios =
                KarvonenHeartRateZoneHelper.ratios(
                        List.of(130.0, 138.0, 160.0, 180.0, 100.0), 190, 60);
        // 130→1, 138→2, 160→3, 180→5, 100→outside; measured=5
        assertThat(ratios).hasSize(5);
        assertThat(ratios.get(0).zone()).isEqualTo(1);
        assertThat(ratios.get(0).ratio()).isEqualByComparingTo("0.200000");
        assertThat(ratios.get(1).ratio()).isEqualByComparingTo("0.200000");
        assertThat(ratios.get(2).ratio()).isEqualByComparingTo("0.200000");
        assertThat(ratios.get(3).ratio()).isEqualByComparingTo("0.000000");
        assertThat(ratios.get(4).ratio()).isEqualByComparingTo("0.200000");
    }

    @Test
    void HRR이_0_이하이거나_샘플없으면_빈목록() {
        assertThat(KarvonenHeartRateZoneHelper.ratios(List.of(140.0), 60, 60)).isEmpty();
        assertThat(KarvonenHeartRateZoneHelper.ratios(List.of(), 190, 60)).isEmpty();
        assertThat(KarvonenHeartRateZoneHelper.zoneBounds(60, 80)).isEmpty();
    }

    @Test
    void 나이기반_HRmax() {
        assertThat(KarvonenHeartRateZoneHelper.hrMaxFromAge(30)).isCloseTo(190.0, within(0.001));
    }

    @Test
    void 목표심박_산식() {
        // (130 * 0.6) + 60 = 138
        assertThat(KarvonenHeartRateZoneHelper.targetBpm(130, 60, 0.6))
                .isCloseTo(138.0, within(0.001));
        assertThat(
                        KarvonenHeartRateZoneHelper.ratios(List.of(138.0), 190, 60)
                                .stream()
                                .filter(z -> z.zone() == 2)
                                .map(ZoneRatio::ratio)
                                .findFirst()
                                .orElse(BigDecimal.ZERO))
                .isEqualByComparingTo(BigDecimal.ONE.setScale(6));
    }
}
