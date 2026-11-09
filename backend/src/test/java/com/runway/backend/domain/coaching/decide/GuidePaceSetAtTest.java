package com.runway.backend.domain.coaching.decide;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.coaching.decide.GuidePaceSetAt.AppliedPace;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

/** S15P31E105-516 — 같은 페이스 streak vs 페이스 변경. */
class GuidePaceSetAtTest {

    private static final Instant T0 = Instant.parse("2026-11-05T03:00:00Z");

    private static AppliedPace pace(Instant at, String secPerKm) {
        return new AppliedPace(at, new BigDecimal(secPerKm));
    }

    @Test
    void 적용_코칭이_없으면_null이다() {
        assertThat(GuidePaceSetAt.resolve(List.of())).isNull();
        assertThat(GuidePaceSetAt.resolve(null)).isNull();
    }

    @Test
    void 단일_적용은_그_시각이다() {
        assertThat(GuidePaceSetAt.resolve(List.of(pace(T0.minusSeconds(90), "355.50"))))
                .isEqualTo(T0.minusSeconds(90));
    }

    @Test
    void 같은_페이스로_단계만_바뀌면_처음_적용_시각을_유지한다() {
        Instant changed = T0.minusSeconds(180);
        Instant levelOnly = T0.minusSeconds(30);
        Instant setAt =
                GuidePaceSetAt.resolve(
                        List.of(
                                pace(levelOnly, "360.00"),
                                pace(changed, "360.00"),
                                pace(T0.minusSeconds(300), "350.00")));

        assertThat(setAt).isEqualTo(changed);
    }

    @Test
    void 페이스가_바뀌면_그_적용_시각으로_갱신된다() {
        Instant newest = T0.minusSeconds(20);
        Instant setAt =
                GuidePaceSetAt.resolve(
                        List.of(
                                pace(newest, "370.00"),
                                pace(T0.minusSeconds(100), "360.00"),
                                pace(T0.minusSeconds(200), "360.00")));

        assertThat(setAt).isEqualTo(newest);
    }
}
