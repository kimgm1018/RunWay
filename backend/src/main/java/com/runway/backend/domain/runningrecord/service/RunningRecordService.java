package com.runway.backend.domain.runningrecord.service;

import com.runway.backend.domain.runningrecord.dto.response.RunningRecordDetailResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordHeartRateZoneResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordListItemResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordListResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordPaceTrendItemResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordPaceTrendResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordPreviousPeriodResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordSplitItemResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordSplitsResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordStatisticsBreakdownItemResponse;
import com.runway.backend.domain.runningrecord.dto.response.RunningRecordStatisticsResponse;
import com.runway.backend.domain.runningrecord.helper.KarvonenHeartRateZoneHelper;
import com.runway.backend.domain.runningrecord.helper.RunningRecordAccessHelper;
import com.runway.backend.domain.runningrecord.helper.StatisticsPeriodHelper;
import com.runway.backend.domain.runningrecord.helper.StatisticsPeriodHelper.InstantWindow;
import com.runway.backend.domain.runningrecord.helper.StatisticsPeriodHelper.PeriodType;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.ListCursor;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.ListItemRow;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.RunTypeFilter;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SessionRow;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SortType;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.StatsSessionRow;
import com.runway.backend.global.exception.ApiException;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Period;
import java.time.YearMonth;
import java.time.format.DateTimeParseException;
import java.util.ArrayList;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class RunningRecordService {

    private static final int DEFAULT_LIMIT = 20;
    private static final int MAX_LIMIT = 50;
    private static final int DEFAULT_PACE_TREND_MONTHS = 6;
    private static final int MAX_PACE_TREND_MONTHS = 24;
    private static final int PACE_SCALE = 2;

    /**
     * Opaque cursor payload: {@code SORT|sortValue|id}. sortValue is ISO-8601 Instant (LATEST) or
     * plain decimal (DISTANCE/PACE); empty sortValue means NULL sort key.
     */
    private static final Pattern CURSOR_PATTERN =
            Pattern.compile("(LATEST|DISTANCE|PACE)\\|([^|]*)\\|(\\d+)");

    private final RunningRecordJdbcRepository runningRecordJdbcRepository;
    private final RunningRecordAccessHelper runningRecordAccessHelper;

    /**
     * H01 목록. {@code from}/{@code to}는 ISO-8601 Instant이며, 둘 다 있으면 {@code started_at >= from AND
     * started_at < to} (from inclusive, to exclusive).
     */
    @Transactional(readOnly = true)
    public RunningRecordListResponse list(
            long userId,
            String cursor,
            Integer limit,
            String from,
            String to,
            Long courseId,
            String runType,
            String sort) {
        requireExistingUser(userId);

        int pageSize = resolveLimit(limit);
        Instant fromInclusive = parseInstantParam(from, "from");
        Instant toExclusive = parseInstantParam(to, "to");
        if (fromInclusive != null && toExclusive != null && !fromInclusive.isBefore(toExclusive)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "from은 to보다 이전이어야 합니다.");
        }
        RunTypeFilter runTypeFilter = parseRunType(runType);
        SortType sortType = parseSort(sort);
        ListCursor listCursor = parseCursor(cursor, sortType);

        List<ListItemRow> rows =
                runningRecordJdbcRepository.findCompletedRecords(
                        userId,
                        fromInclusive,
                        toExclusive,
                        courseId,
                        runTypeFilter,
                        sortType,
                        listCursor,
                        pageSize + 1);

        boolean hasMore = rows.size() > pageSize;
        List<ListItemRow> pageRows = hasMore ? rows.subList(0, pageSize) : rows;

        List<RunningRecordListItemResponse> items =
                pageRows.stream()
                        .map(
                                row ->
                                        new RunningRecordListItemResponse(
                                                row.id(),
                                                row.courseId(),
                                                row.startedAt(),
                                                row.totalDistance(),
                                                row.movingDuration(),
                                                row.averagePace(),
                                                row.goalAchieved()))
                        .toList();

        String nextPage =
                hasMore ? encodeCursor(sortType, pageRows.get(pageRows.size() - 1)) : null;
        return new RunningRecordListResponse(items, nextPage);
    }

    @Transactional(readOnly = true)
    public RunningRecordDetailResponse getDetail(long userId, long sessionId) {
        requireExistingUser(userId);
        SessionRow session = runningRecordAccessHelper.requireOwnedSession(userId, sessionId);
        return new RunningRecordDetailResponse(
                session.id(),
                session.goalDistance(),
                session.goalDuration(),
                session.totalDistance(),
                session.movingDuration(),
                session.elapsedDuration(),
                session.averagePace(),
                session.averageHeartRate(),
                session.averageCadence(),
                session.goalAchieved(),
                session.courseId(),
                session.goalPace(),
                session.comparisonSessionId());
    }

    @Transactional(readOnly = true)
    public RunningRecordSplitsResponse getSplits(long userId, long sessionId) {
        requireExistingUser(userId);
        runningRecordAccessHelper.requireOwnedSession(userId, sessionId);
        List<RunningRecordSplitItemResponse> splits =
                runningRecordJdbcRepository.findSplitsBySessionId(sessionId).stream()
                        .map(
                                row ->
                                        new RunningRecordSplitItemResponse(
                                                row.startDistance(),
                                                row.endDistance(),
                                                row.pace(),
                                                row.averageHeartRate(),
                                                row.averageCadence()))
                        .toList();
        return new RunningRecordSplitsResponse(splits);
    }

    /** H06 러닝 통계 요약. */
    @Transactional(readOnly = true)
    public RunningRecordStatisticsResponse getStatistics(
            long userId, String period, String baseDate, String runType) {
        requireExistingUser(userId);
        PeriodType periodType = parsePeriod(period);
        LocalDate resolvedBaseDate = parseBaseDate(baseDate);
        RunTypeFilter runTypeFilter = parseRunType(runType);

        InstantWindow currentWindow =
                StatisticsPeriodHelper.windowContaining(periodType, resolvedBaseDate);
        InstantWindow previousWindow =
                StatisticsPeriodHelper.previousWindow(periodType, resolvedBaseDate);

        List<StatsSessionRow> currentSessions =
                runningRecordJdbcRepository.findStatsSessions(
                        userId,
                        currentWindow.fromInclusive(),
                        currentWindow.toExclusive(),
                        runTypeFilter);
        List<StatsSessionRow> previousSessions =
                runningRecordJdbcRepository.findStatsSessions(
                        userId,
                        previousWindow.fromInclusive(),
                        previousWindow.toExclusive(),
                        runTypeFilter);

        PeriodTotals current = totalsOf(currentSessions);
        PeriodTotals previous = totalsOf(previousSessions);

        List<RunningRecordStatisticsBreakdownItemResponse> breakdown =
                buildBreakdown(periodType, resolvedBaseDate, currentSessions);
        List<RunningRecordHeartRateZoneResponse> heartRateZones =
                buildHeartRateZones(
                        userId,
                        resolvedBaseDate,
                        currentWindow.fromInclusive(),
                        currentWindow.toExclusive(),
                        runTypeFilter);

        return new RunningRecordStatisticsResponse(
                current.runCount(),
                current.totalDistanceM(),
                current.totalDurationSec(),
                current.averagePaceSecPerKm(),
                breakdown,
                heartRateZones,
                previousPeriodOf(current, previous));
    }

    /** H07 평균 페이스 추이. */
    @Transactional(readOnly = true)
    public RunningRecordPaceTrendResponse getPaceTrend(long userId, Integer months) {
        requireExistingUser(userId);
        int resolvedMonths = resolvePaceTrendMonths(months);
        LocalDate today = StatisticsPeriodHelper.todayInZone();
        InstantWindow window = StatisticsPeriodHelper.monthsEndingAt(today, resolvedMonths);

        List<StatsSessionRow> sessions =
                runningRecordJdbcRepository.findStatsSessions(
                        userId,
                        window.fromInclusive(),
                        window.toExclusive(),
                        RunTypeFilter.ALL);

        Map<YearMonth, List<StatsSessionRow>> byMonth = new LinkedHashMap<>();
        for (YearMonth ym : StatisticsPeriodHelper.yearMonthsInRange(today, resolvedMonths)) {
            byMonth.put(ym, new ArrayList<>());
        }
        for (StatsSessionRow session : sessions) {
            if (session.startedAt() == null) {
                continue;
            }
            YearMonth ym = YearMonth.from(StatisticsPeriodHelper.toLocalDate(session.startedAt()));
            List<StatsSessionRow> bucket = byMonth.get(ym);
            if (bucket != null) {
                bucket.add(session);
            }
        }

        List<RunningRecordPaceTrendItemResponse> items = new ArrayList<>(byMonth.size());
        for (Map.Entry<YearMonth, List<StatsSessionRow>> entry : byMonth.entrySet()) {
            PeriodTotals totals = totalsOf(entry.getValue());
            items.add(
                    new RunningRecordPaceTrendItemResponse(
                            StatisticsPeriodHelper.formatYearMonth(entry.getKey()),
                            totals.averagePaceSecPerKm(),
                            totals.runCount()));
        }

        BigDecimal changeSecPerKm = null;
        if (!items.isEmpty()) {
            BigDecimal first = items.getFirst().averagePaceSecPerKm();
            BigDecimal last = items.getLast().averagePaceSecPerKm();
            if (first != null && last != null) {
                changeSecPerKm = last.subtract(first);
            }
        }
        return new RunningRecordPaceTrendResponse(items, changeSecPerKm);
    }

    private List<RunningRecordHeartRateZoneResponse> buildHeartRateZones(
            long userId,
            LocalDate baseDate,
            Instant fromInclusive,
            Instant toExclusive,
            RunTypeFilter runType) {
        Optional<Double> hrMax = resolveHrMax(userId, baseDate);
        Optional<Double> rhr = resolveRhr(userId, baseDate);
        if (hrMax.isEmpty() || rhr.isEmpty()) {
            return List.of();
        }
        List<BigDecimal> samples =
                runningRecordJdbcRepository.findHeartRateSamplesInPeriod(
                        userId, fromInclusive, toExclusive, runType);
        List<Double> bpm =
                samples.stream().map(BigDecimal::doubleValue).toList();
        return KarvonenHeartRateZoneHelper.ratios(bpm, hrMax.get(), rhr.get()).stream()
                .map(z -> new RunningRecordHeartRateZoneResponse(z.zone(), z.ratio()))
                .toList();
    }

    private Optional<Double> resolveHrMax(long userId, LocalDate baseDate) {
        Optional<BigDecimal> fromMetrics =
                runningRecordJdbcRepository
                        .findHealthMetricOnOrBefore(userId, baseDate, "max_heart_rate")
                        .or(
                                () ->
                                        runningRecordJdbcRepository.findLatestHealthMetric(
                                                userId, "max_heart_rate"));
        if (fromMetrics.isPresent()) {
            return Optional.of(fromMetrics.get().doubleValue());
        }
        return runningRecordJdbcRepository
                .findBirthDate(userId)
                .map(
                        birthDate -> {
                            int age = Period.between(birthDate, baseDate).getYears();
                            if (age < 0) {
                                return null;
                            }
                            return KarvonenHeartRateZoneHelper.hrMaxFromAge(age);
                        });
    }

    private Optional<Double> resolveRhr(long userId, LocalDate baseDate) {
        return runningRecordJdbcRepository
                .findHealthMetricOnOrBefore(userId, baseDate, "rhr_bpm")
                .or(() -> runningRecordJdbcRepository.findLatestHealthMetric(userId, "rhr_bpm"))
                .map(BigDecimal::doubleValue);
    }

    private static List<RunningRecordStatisticsBreakdownItemResponse> buildBreakdown(
            PeriodType period, LocalDate baseDate, List<StatsSessionRow> sessions) {
        return switch (period) {
            case WEEK -> buildWeekBreakdown(sessions);
            case MONTH -> buildMonthBreakdown(baseDate, sessions);
            case YEAR -> buildYearBreakdown(baseDate.getYear(), sessions);
        };
    }

    private static List<RunningRecordStatisticsBreakdownItemResponse> buildWeekBreakdown(
            List<StatsSessionRow> sessions) {
        Map<String, BigDecimal> distances = new LinkedHashMap<>();
        for (String day : StatisticsPeriodHelper.weekDayLabels()) {
            distances.put(day, BigDecimal.ZERO);
        }
        for (StatsSessionRow session : sessions) {
            if (session.startedAt() == null) {
                continue;
            }
            String day =
                    StatisticsPeriodHelper.dayLabel(
                            StatisticsPeriodHelper.toLocalDate(session.startedAt()));
            distances.merge(day, distanceOrZero(session), BigDecimal::add);
        }
        List<RunningRecordStatisticsBreakdownItemResponse> items = new ArrayList<>(7);
        for (Map.Entry<String, BigDecimal> entry : distances.entrySet()) {
            items.add(
                    RunningRecordStatisticsBreakdownItemResponse.forDay(
                            entry.getKey(), entry.getValue()));
        }
        return items;
    }

    private static List<RunningRecordStatisticsBreakdownItemResponse> buildMonthBreakdown(
            LocalDate baseDate, List<StatsSessionRow> sessions) {
        List<LocalDate> weekStarts = StatisticsPeriodHelper.monthWeekStarts(baseDate);
        Map<Integer, BigDecimal> distances = new LinkedHashMap<>();
        for (int week = 1; week <= weekStarts.size(); week++) {
            distances.put(week, BigDecimal.ZERO);
        }
        for (StatsSessionRow session : sessions) {
            if (session.startedAt() == null) {
                continue;
            }
            LocalDate local = StatisticsPeriodHelper.toLocalDate(session.startedAt());
            int week = StatisticsPeriodHelper.weekOfMonth(local, baseDate);
            distances.merge(week, distanceOrZero(session), BigDecimal::add);
        }
        List<RunningRecordStatisticsBreakdownItemResponse> items = new ArrayList<>();
        for (Map.Entry<Integer, BigDecimal> entry : distances.entrySet()) {
            items.add(
                    RunningRecordStatisticsBreakdownItemResponse.forWeek(
                            entry.getKey(), entry.getValue()));
        }
        return items;
    }

    private static List<RunningRecordStatisticsBreakdownItemResponse> buildYearBreakdown(
            int year, List<StatsSessionRow> sessions) {
        Map<String, BigDecimal> distances = new LinkedHashMap<>();
        for (String month : StatisticsPeriodHelper.yearMonthLabels(year)) {
            distances.put(month, BigDecimal.ZERO);
        }
        for (StatsSessionRow session : sessions) {
            if (session.startedAt() == null) {
                continue;
            }
            String month =
                    StatisticsPeriodHelper.formatYearMonth(
                            YearMonth.from(StatisticsPeriodHelper.toLocalDate(session.startedAt())));
            if (distances.containsKey(month)) {
                distances.merge(month, distanceOrZero(session), BigDecimal::add);
            }
        }
        List<RunningRecordStatisticsBreakdownItemResponse> items = new ArrayList<>(12);
        for (Map.Entry<String, BigDecimal> entry : distances.entrySet()) {
            items.add(
                    RunningRecordStatisticsBreakdownItemResponse.forMonth(
                            entry.getKey(), entry.getValue()));
        }
        return items;
    }

    private static PeriodTotals totalsOf(List<StatsSessionRow> sessions) {
        long runCount = sessions.size();
        BigDecimal totalDistance = BigDecimal.ZERO;
        long totalDuration = 0L;
        BigDecimal paceSum = BigDecimal.ZERO;
        long paceCount = 0L;
        for (StatsSessionRow session : sessions) {
            totalDistance = totalDistance.add(distanceOrZero(session));
            if (session.movingDuration() != null) {
                totalDuration += session.movingDuration();
            }
            if (session.averagePace() != null) {
                paceSum = paceSum.add(session.averagePace());
                paceCount++;
            }
        }
        BigDecimal averagePace =
                paceCount == 0
                        ? null
                        : paceSum.divide(
                                BigDecimal.valueOf(paceCount), PACE_SCALE, RoundingMode.HALF_UP);
        return new PeriodTotals(runCount, totalDistance, totalDuration, averagePace);
    }

    private static RunningRecordPreviousPeriodResponse previousPeriodOf(
            PeriodTotals current, PeriodTotals previous) {
        BigDecimal paceDelta = null;
        if (current.averagePaceSecPerKm() != null && previous.averagePaceSecPerKm() != null) {
            paceDelta = current.averagePaceSecPerKm().subtract(previous.averagePaceSecPerKm());
        }
        return new RunningRecordPreviousPeriodResponse(
                previous.runCount(),
                previous.totalDistanceM(),
                previous.averagePaceSecPerKm(),
                current.runCount() - previous.runCount(),
                current.totalDistanceM().subtract(previous.totalDistanceM()),
                paceDelta);
    }

    private static BigDecimal distanceOrZero(StatsSessionRow session) {
        return session.totalDistance() == null ? BigDecimal.ZERO : session.totalDistance();
    }

    private static PeriodType parsePeriod(String period) {
        if (period == null || period.isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "period는 WEEK, MONTH, YEAR만 허용됩니다.");
        }
        try {
            return PeriodType.valueOf(period.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "period는 WEEK, MONTH, YEAR만 허용됩니다.");
        }
    }

    private static LocalDate parseBaseDate(String baseDate) {
        if (baseDate == null || baseDate.isBlank()) {
            return StatisticsPeriodHelper.todayInZone();
        }
        try {
            return LocalDate.parse(baseDate.trim());
        } catch (DateTimeParseException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_PERIOD",
                    "baseDate는 YYYY-MM-DD 형식이어야 합니다.");
        }
    }

    private static int resolvePaceTrendMonths(Integer months) {
        if (months == null) {
            return DEFAULT_PACE_TREND_MONTHS;
        }
        if (months < 1 || months > MAX_PACE_TREND_MONTHS) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "months는 1 이상 " + MAX_PACE_TREND_MONTHS + " 이하여야 합니다.");
        }
        return months;
    }

    private record PeriodTotals(
            long runCount,
            BigDecimal totalDistanceM,
            long totalDurationSec,
            BigDecimal averagePaceSecPerKm) {}

    private void requireExistingUser(long userId) {
        if (!runningRecordJdbcRepository.existsUserById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_LIMIT;
        }
        if (limit < 1 || limit > MAX_LIMIT) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "limit은 1 이상 " + MAX_LIMIT + " 이하여야 합니다.");
        }
        return limit;
    }

    private static Instant parseInstantParam(String raw, String name) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        try {
            return Instant.parse(raw.trim());
        } catch (DateTimeParseException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    name + "은 ISO-8601 Instant 형식이어야 합니다.");
        }
    }

    private static RunTypeFilter parseRunType(String runType) {
        if (runType == null || runType.isBlank()) {
            return RunTypeFilter.ALL;
        }
        try {
            return RunTypeFilter.valueOf(runType.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "runType은 ALL, SOLO, GROUP만 허용됩니다.");
        }
    }

    private static SortType parseSort(String sort) {
        if (sort == null || sort.isBlank()) {
            return SortType.LATEST;
        }
        try {
            return SortType.valueOf(sort.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "sort는 LATEST, DISTANCE, PACE만 허용됩니다.");
        }
    }

    private static ListCursor parseCursor(String cursor, SortType expectedSort) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            String decoded =
                    new String(
                            Base64.getUrlDecoder().decode(cursor.trim()), StandardCharsets.UTF_8);
            Matcher matcher = CURSOR_PATTERN.matcher(decoded);
            if (!matcher.matches()) {
                throw invalidCursor();
            }
            SortType sort = SortType.valueOf(matcher.group(1));
            if (sort != expectedSort) {
                throw invalidCursor();
            }
            String sortValue = matcher.group(2);
            long id = Long.parseLong(matcher.group(3));
            if (id < 1) {
                throw invalidCursor();
            }
            return switch (sort) {
                case LATEST ->
                        ListCursor.forLatest(
                                sortValue.isEmpty() ? null : Instant.parse(sortValue), id);
                case DISTANCE ->
                        ListCursor.forDistance(
                                sortValue.isEmpty() ? null : new BigDecimal(sortValue), id);
                case PACE ->
                        ListCursor.forPace(
                                sortValue.isEmpty() ? null : new BigDecimal(sortValue), id);
            };
        } catch (IllegalArgumentException | DateTimeParseException | ArithmeticException ex) {
            throw invalidCursor();
        }
    }

    private static String encodeCursor(SortType sort, ListItemRow row) {
        String sortValue =
                switch (sort) {
                    case LATEST ->
                            row.startedAt() == null ? "" : row.startedAt().toString();
                    case DISTANCE ->
                            row.totalDistance() == null
                                    ? ""
                                    : row.totalDistance().toPlainString();
                    case PACE ->
                            row.averagePace() == null ? "" : row.averagePace().toPlainString();
                };
        String raw = sort.name() + "|" + sortValue + "|" + row.id();
        return Base64.getUrlEncoder()
                .withoutPadding()
                .encodeToString(raw.getBytes(StandardCharsets.UTF_8));
    }

    private static ApiException invalidCursor() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "cursor 형식이 올바르지 않습니다.");
    }
}
