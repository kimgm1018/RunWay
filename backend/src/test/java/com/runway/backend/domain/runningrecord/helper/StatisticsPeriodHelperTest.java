package com.runway.backend.domain.runningrecord.helper;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.runningrecord.helper.StatisticsPeriodHelper.InstantWindow;
import com.runway.backend.domain.runningrecord.helper.StatisticsPeriodHelper.PeriodType;
import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneOffset;
import java.util.List;
import org.junit.jupiter.api.Test;

class StatisticsPeriodHelperTest {

    @Test
    void WEEK_월요일_시작_일요일_포함_직전주는_바로_이전() {
        // 2026-03-04 is Wednesday Asia/Seoul
        LocalDate base = LocalDate.of(2026, 3, 4);
        InstantWindow current = StatisticsPeriodHelper.windowContaining(PeriodType.WEEK, base);
        InstantWindow previous = StatisticsPeriodHelper.previousWindow(PeriodType.WEEK, base);

        Instant expectedStart =
                LocalDate.of(2026, 3, 2).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant();
        Instant expectedEnd =
                LocalDate.of(2026, 3, 9).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant();
        assertThat(current.fromInclusive()).isEqualTo(expectedStart);
        assertThat(current.toExclusive()).isEqualTo(expectedEnd);
        assertThat(StatisticsPeriodHelper.toLocalDate(current.fromInclusive()).getDayOfWeek())
                .isEqualTo(DayOfWeek.MONDAY);

        Instant prevStart =
                LocalDate.of(2026, 2, 23).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant();
        assertThat(previous.fromInclusive()).isEqualTo(prevStart);
        assertThat(previous.toExclusive()).isEqualTo(expectedStart);
    }

    @Test
    void MONTH_달력월_경계와_직전월() {
        LocalDate base = LocalDate.of(2026, 3, 15);
        InstantWindow current = StatisticsPeriodHelper.windowContaining(PeriodType.MONTH, base);
        InstantWindow previous = StatisticsPeriodHelper.previousWindow(PeriodType.MONTH, base);

        assertThat(current.fromInclusive())
                .isEqualTo(LocalDate.of(2026, 3, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(current.toExclusive())
                .isEqualTo(LocalDate.of(2026, 4, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(previous.fromInclusive())
                .isEqualTo(LocalDate.of(2026, 2, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(previous.toExclusive()).isEqualTo(current.fromInclusive());
    }

    @Test
    void YEAR_연도_경계() {
        LocalDate base = LocalDate.of(2026, 10, 30);
        InstantWindow current = StatisticsPeriodHelper.windowContaining(PeriodType.YEAR, base);
        InstantWindow previous = StatisticsPeriodHelper.previousWindow(PeriodType.YEAR, base);

        assertThat(current.fromInclusive())
                .isEqualTo(LocalDate.of(2026, 1, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(current.toExclusive())
                .isEqualTo(LocalDate.of(2027, 1, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(previous.fromInclusive())
                .isEqualTo(LocalDate.of(2025, 1, 1).atStartOfDay(StatisticsPeriodHelper.ZONE).toInstant());
        assertThat(previous.toExclusive()).isEqualTo(current.fromInclusive());
    }

    @Test
    void 주_시작이_UTC와_다를_수_있는_서울_자정() {
        // 2026-03-01 00:00 KST == 2026-02-28 15:00 UTC
        InstantWindow march =
                StatisticsPeriodHelper.windowContaining(
                        PeriodType.MONTH, LocalDate.of(2026, 3, 1));
        assertThat(march.fromInclusive())
                .isEqualTo(Instant.parse("2026-02-28T15:00:00Z"));
        assertThat(march.fromInclusive().atZone(ZoneOffset.UTC).getMonthValue()).isEqualTo(2);
    }

    @Test
    void monthWeekStarts_부분_주를_포함한다() {
        // March 2026: Sun 1 ... Sat 28, Sun 29-Tue 31 → weeks start Feb 23, Mar 2, 9, 16, 23, 30
        List<LocalDate> starts = StatisticsPeriodHelper.monthWeekStarts(LocalDate.of(2026, 3, 10));
        assertThat(starts)
                .containsExactly(
                        LocalDate.of(2026, 2, 23),
                        LocalDate.of(2026, 3, 2),
                        LocalDate.of(2026, 3, 9),
                        LocalDate.of(2026, 3, 16),
                        LocalDate.of(2026, 3, 23),
                        LocalDate.of(2026, 3, 30));
        assertThat(StatisticsPeriodHelper.weekOfMonth(LocalDate.of(2026, 3, 1), LocalDate.of(2026, 3, 1)))
                .isEqualTo(1);
        assertThat(StatisticsPeriodHelper.weekOfMonth(LocalDate.of(2026, 3, 4), LocalDate.of(2026, 3, 1)))
                .isEqualTo(2);
    }

    @Test
    void paceTrend_월_목록은_끝월_포함_N개() {
        List<YearMonth> months =
                StatisticsPeriodHelper.yearMonthsInRange(LocalDate.of(2026, 10, 30), 6);
        assertThat(months)
                .containsExactly(
                        YearMonth.of(2026, 5),
                        YearMonth.of(2026, 6),
                        YearMonth.of(2026, 7),
                        YearMonth.of(2026, 8),
                        YearMonth.of(2026, 9),
                        YearMonth.of(2026, 10));
    }
}
