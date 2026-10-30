package com.runway.backend.domain.runningrecord.helper;

import java.time.DayOfWeek;
import java.time.Instant;
import java.time.LocalDate;
import java.time.YearMonth;
import java.time.ZoneId;
import java.time.format.DateTimeFormatter;
import java.time.temporal.TemporalAdjusters;
import java.util.ArrayList;
import java.util.List;

/**
 * H06/H07 기간 경계. MVP 기본 시간대는 {@code Asia/Seoul}, 주 시작은 월요일이다.
 */
public final class StatisticsPeriodHelper {

    public static final ZoneId ZONE = ZoneId.of("Asia/Seoul");

    private static final DateTimeFormatter YEAR_MONTH = DateTimeFormatter.ofPattern("yyyy-MM");

    private StatisticsPeriodHelper() {}

    public enum PeriodType {
        WEEK,
        MONTH,
        YEAR
    }

    /** Inclusive start instant and exclusive end instant in UTC for the calendar window. */
    public record InstantWindow(Instant fromInclusive, Instant toExclusive) {}

    public static LocalDate todayInZone() {
        return LocalDate.now(ZONE);
    }

    public static InstantWindow windowContaining(PeriodType period, LocalDate baseDate) {
        return switch (period) {
            case WEEK -> {
                LocalDate monday = baseDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
                yield toInstantWindow(monday, monday.plusWeeks(1));
            }
            case MONTH -> {
                LocalDate first = baseDate.withDayOfMonth(1);
                yield toInstantWindow(first, first.plusMonths(1));
            }
            case YEAR -> {
                LocalDate first = LocalDate.of(baseDate.getYear(), 1, 1);
                yield toInstantWindow(first, first.plusYears(1));
            }
        };
    }

    /** Same-length calendar window immediately before {@link #windowContaining}. */
    public static InstantWindow previousWindow(PeriodType period, LocalDate baseDate) {
        return switch (period) {
            case WEEK -> {
                LocalDate monday = baseDate.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
                LocalDate prevMonday = monday.minusWeeks(1);
                yield toInstantWindow(prevMonday, monday);
            }
            case MONTH -> {
                LocalDate first = baseDate.withDayOfMonth(1);
                LocalDate prevFirst = first.minusMonths(1);
                yield toInstantWindow(prevFirst, first);
            }
            case YEAR -> {
                LocalDate first = LocalDate.of(baseDate.getYear(), 1, 1);
                yield toInstantWindow(first.minusYears(1), first);
            }
        };
    }

    public static InstantWindow toInstantWindow(LocalDate startInclusive, LocalDate endExclusive) {
        Instant from = startInclusive.atStartOfDay(ZONE).toInstant();
        Instant to = endExclusive.atStartOfDay(ZONE).toInstant();
        return new InstantWindow(from, to);
    }

    /** Pace-trend: {@code months} calendar months ending at the month of {@code endDate} inclusive. */
    public static InstantWindow monthsEndingAt(LocalDate endDate, int months) {
        YearMonth end = YearMonth.from(endDate);
        YearMonth start = end.minusMonths(months - 1L);
        return toInstantWindow(start.atDay(1), end.plusMonths(1).atDay(1));
    }

    public static List<YearMonth> yearMonthsInRange(LocalDate endDate, int months) {
        YearMonth end = YearMonth.from(endDate);
        YearMonth start = end.minusMonths(months - 1L);
        List<YearMonth> result = new ArrayList<>(months);
        YearMonth cursor = start;
        while (!cursor.isAfter(end)) {
            result.add(cursor);
            cursor = cursor.plusMonths(1);
        }
        return result;
    }

    public static String formatYearMonth(YearMonth yearMonth) {
        return yearMonth.format(YEAR_MONTH);
    }

    public static LocalDate toLocalDate(Instant instant) {
        return instant.atZone(ZONE).toLocalDate();
    }

    /** MON..SUN labels for a calendar week containing {@code baseDate}. */
    public static List<String> weekDayLabels() {
        return List.of("MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN");
    }

    public static String dayLabel(LocalDate date) {
        return switch (date.getDayOfWeek()) {
            case MONDAY -> "MON";
            case TUESDAY -> "TUE";
            case WEDNESDAY -> "WED";
            case THURSDAY -> "THU";
            case FRIDAY -> "FRI";
            case SATURDAY -> "SAT";
            case SUNDAY -> "SUN";
        };
    }

    /**
     * Monday-start week order within the calendar month of {@code baseDate} (1-based). Weeks that
     * only partially overlap the month are included.
     */
    public static List<LocalDate> monthWeekStarts(LocalDate baseDate) {
        LocalDate monthStart = baseDate.withDayOfMonth(1);
        LocalDate monthEnd = monthStart.with(TemporalAdjusters.lastDayOfMonth());
        LocalDate firstWeekStart = monthStart.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        LocalDate lastWeekStart = monthEnd.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        List<LocalDate> starts = new ArrayList<>();
        for (LocalDate cursor = firstWeekStart;
                !cursor.isAfter(lastWeekStart);
                cursor = cursor.plusWeeks(1)) {
            starts.add(cursor);
        }
        return starts;
    }

    /** 1-based week index in {@link #monthWeekStarts} for {@code date}, or empty if outside month weeks. */
    public static int weekOfMonth(LocalDate date, LocalDate baseDateInMonth) {
        LocalDate weekStart = date.with(TemporalAdjusters.previousOrSame(DayOfWeek.MONDAY));
        List<LocalDate> starts = monthWeekStarts(baseDateInMonth);
        int index = starts.indexOf(weekStart);
        if (index < 0) {
            throw new IllegalArgumentException("date is outside month week range");
        }
        return index + 1;
    }

    public static List<String> yearMonthLabels(int year) {
        List<String> labels = new ArrayList<>(12);
        for (int month = 1; month <= 12; month++) {
            labels.add(formatYearMonth(YearMonth.of(year, month)));
        }
        return labels;
    }

}
