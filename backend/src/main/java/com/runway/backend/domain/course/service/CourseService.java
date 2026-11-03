package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.BookmarkCourseRequest;
import com.runway.backend.domain.course.dto.request.RecommendCoursesRequest;
import com.runway.backend.domain.course.dto.response.BookmarkCourseResponse;
import com.runway.backend.domain.course.dto.response.BookmarkedCourseItemResponse;
import com.runway.backend.domain.course.dto.response.BookmarkedCourseListResponse;
import com.runway.backend.domain.course.dto.response.CourseDetailResponse;
import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;
import com.runway.backend.domain.course.dto.response.RecommendedCourseItemResponse;
import com.runway.backend.domain.course.dto.response.UnbookmarkCourseResponse;
import com.runway.backend.domain.course.entity.CourseBookmark;
import com.runway.backend.domain.course.repository.CourseBookmarkRepository;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.BookmarkUpsertRow;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.BookmarkedCourseRow;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.CourseRow;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.RecommendCourseRow;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonGeographyMapper;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.global.geo.GeoJsonPoint;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;

@Service
@RequiredArgsConstructor
public class CourseService {

    private static final int ALIAS_MAX_LENGTH = 50;
    private static final int DEFAULT_BOOKMARK_LIMIT = 20;
    private static final int MAX_BOOKMARK_LIMIT = 50;
    private static final int DEFAULT_RECOMMEND_LIMIT = 20;
    private static final int MAX_RECOMMEND_LIMIT = 50;
    private static final double DEFAULT_RADIUS_M = 3_000d;
    private static final double DISTANCE_TOLERANCE_RATIO = 0.10d;
    private static final Set<String> ALLOWED_ENVIRONMENT_TYPES =
            Set.of("PARK", "RIVERSIDE", "URBAN", "BEACH", "TRACK");

    private final CourseJdbcRepository courseJdbcRepository;
    private final CourseBookmarkRepository courseBookmarkRepository;
    private final JsonMapper jsonMapper;

    @Transactional(readOnly = true)
    public RecommendCoursesResponse recommend(long userId, RecommendCoursesRequest request) {
        requireExistingUser(userId);
        ValidatedRecommendSearch search = validateRecommendSearch(request);

        List<RecommendCourseRow> rows =
                courseJdbcRepository.findRecommendations(
                        search.startEwkt(),
                        search.radiusM(),
                        search.minDistanceM(),
                        search.maxDistanceM(),
                        search.environmentTypes(),
                        search.limit());

        List<RecommendedCourseItemResponse> courses = new ArrayList<>(rows.size());
        for (RecommendCourseRow row : rows) {
            int estimatedDurationSec =
                    estimateDurationSecRequired(row.distanceM(), search.paceSecPerKm());
            courses.add(
                    new RecommendedCourseItemResponse(
                            row.id(),
                            row.regionCode(),
                            row.status(),
                            row.distanceM(),
                            row.environmentTags(),
                            estimatedDurationSec));
        }
        return new RecommendCoursesResponse(courses);
    }

    @Transactional(readOnly = true)
    public CourseDetailResponse getDetail(long userId, long courseId, Double targetPaceSecPerKm) {
        requireExistingUser(userId);
        CourseRow course =
                courseJdbcRepository.findById(courseId).orElseThrow(CourseService::courseNotFound);

        String myAlias =
                courseBookmarkRepository
                        .findByUserIdAndCourseId(userId, courseId)
                        .map(CourseBookmark::getCustomName)
                        .orElse(null);

        List<String> environmentTags = courseJdbcRepository.findEnvironmentTags(courseId);
        Integer estimatedDurationSec = estimateDurationSec(course.distanceM(), targetPaceSecPerKm);

        return new CourseDetailResponse(
                course.id(),
                myAlias,
                course.description(),
                parseLineString(course.routeGeoJson()),
                parsePoint(course.startGeoJson()),
                course.distanceM(),
                course.elevationGainM(),
                parseElevationProfile(course.elevationProfileJson()),
                environmentTags,
                estimatedDurationSec,
                course.status(),
                course.mergedIntoCourseId());
    }

    @Transactional
    public BookmarkCourseResponse bookmark(
            long userId, long courseId, BookmarkCourseRequest request) {
        requireExistingUser(userId);
        requireCourseExists(courseId);

        BookmarkCourseRequest effective =
                request == null ? BookmarkCourseRequest.omitted() : request;
        if (effective.aliasPresent()) {
            validateAliasLength(effective.alias());
        }

        // UNIQUE 경합에도 멱등하도록 JDBC upsert (JPA find-then-save는 동시 INSERT 시 500).
        BookmarkUpsertRow row =
                courseJdbcRepository.upsertBookmark(
                        userId, courseId, effective.aliasPresent(), effective.alias());
        return new BookmarkCourseResponse(row.customName(), row.createdAt(), true);
    }

    @Transactional
    public UnbookmarkCourseResponse unbookmark(long userId, long courseId) {
        requireExistingUser(userId);
        requireCourseExists(courseId);
        courseBookmarkRepository.deleteByUserIdAndCourseId(userId, courseId);
        return new UnbookmarkCourseResponse(false);
    }

    @Transactional(readOnly = true)
    public BookmarkedCourseListResponse listBookmarkedCourses(
            long userId, String cursor, Integer limit, String difficultyIgnored) {
        requireExistingUser(userId);
        int pageSize = resolveLimit(limit);
        Long cursorId = parseCursor(cursor);

        List<BookmarkedCourseRow> rows =
                courseJdbcRepository.findBookmarkedCourses(userId, cursorId, pageSize + 1);

        boolean hasMore = rows.size() > pageSize;
        List<BookmarkedCourseRow> pageRows = hasMore ? rows.subList(0, pageSize) : rows;

        List<BookmarkedCourseItemResponse> items =
                pageRows.stream()
                        .map(
                                row ->
                                        new BookmarkedCourseItemResponse(
                                                row.courseId(),
                                                row.regionCode(),
                                                row.status(),
                                                row.mergedIntoCourseId(),
                                                row.customName(),
                                                row.distanceM()))
                        .toList();

        String nextPage =
                hasMore ? String.valueOf(pageRows.get(pageRows.size() - 1).bookmarkId()) : null;
        return new BookmarkedCourseListResponse(items, nextPage);
    }

    private void requireExistingUser(long userId) {
        if (!courseJdbcRepository.existsUserById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }

    private void requireCourseExists(long courseId) {
        if (!courseJdbcRepository.existsById(courseId)) {
            throw courseNotFound();
        }
    }

    private static void validateAliasLength(String alias) {
        if (alias != null && alias.length() > ALIAS_MAX_LENGTH) {
            throw new ApiException(
                    ErrorCode.VALIDATION_ERROR_COURSE_VALIDATE_ALIAS_LENGTH,
                    String.valueOf(ALIAS_MAX_LENGTH));
        }
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_BOOKMARK_LIMIT;
        }
        if (limit < 1 || limit > MAX_BOOKMARK_LIMIT) {
            throw new ApiException(
                    ErrorCode.VALIDATION_LIMIT_OUT_OF_RANGE, String.valueOf(MAX_BOOKMARK_LIMIT));
        }
        return limit;
    }

    private static Long parseCursor(String cursor) {
        if (cursor == null || cursor.isBlank()) {
            return null;
        }
        try {
            long value = Long.parseLong(cursor.trim());
            if (value < 1) {
                throw invalidCursor();
            }
            return value;
        } catch (NumberFormatException ex) {
            throw invalidCursor();
        }
    }

    private static ValidatedRecommendSearch validateRecommendSearch(
            RecommendCoursesRequest request) {
        if (request == null) {
            throw new ApiException(ErrorCode.SEARCH_CONDITIONS_REQUIRED);
        }
        double latitude = requireFinite(request.latitude(), "latitude");
        double longitude = requireFinite(request.longitude(), "longitude");
        if (latitude < -90 || latitude > 90) {
            throw new ApiException(ErrorCode.SEARCH_LATITUDE_INVALID);
        }
        if (longitude < -180 || longitude > 180) {
            throw new ApiException(ErrorCode.SEARCH_LONGITUDE_INVALID);
        }

        double targetDistanceM = requirePositive(request.targetDistanceM(), "targetDistanceM");
        double paceSecPerKm = resolvePaceSecPerKm(request, targetDistanceM);

        double radiusM =
                request.radiusM() == null
                        ? DEFAULT_RADIUS_M
                        : requirePositive(request.radiusM(), "radiusM");
        int limit = resolveRecommendLimit(request.limit());
        List<String> environmentTypes = normalizeEnvironmentTypes(request.environmentTypes());

        BigDecimal target = BigDecimal.valueOf(targetDistanceM);
        BigDecimal minDistanceM =
                target.multiply(BigDecimal.valueOf(1.0d - DISTANCE_TOLERANCE_RATIO))
                        .setScale(2, RoundingMode.HALF_UP);
        BigDecimal maxDistanceM =
                target.multiply(BigDecimal.valueOf(1.0d + DISTANCE_TOLERANCE_RATIO))
                        .setScale(2, RoundingMode.HALF_UP);

        String startEwkt = GeoJsonGeographyMapper.toEwkt(GeoJsonPoint.of(longitude, latitude));
        return new ValidatedRecommendSearch(
                startEwkt,
                radiusM,
                minDistanceM,
                maxDistanceM,
                environmentTypes,
                limit,
                paceSecPerKm);
    }

    private static double resolvePaceSecPerKm(
            RecommendCoursesRequest request, double targetDistanceM) {
        String rawType = request.goalInputType();
        if (rawType == null || rawType.isBlank()) {
            throw new ApiException(ErrorCode.SEARCH_GOAL_TYPE_INVALID);
        }
        String goalInputType = rawType.trim().toUpperCase(Locale.ROOT);
        return switch (goalInputType) {
            case "TIME" -> {
                if (request.targetPaceSecPerKm() != null) {
                    throw new ApiException(ErrorCode.SEARCH_TIME_PACE_CONFLICT);
                }
                double durationSec =
                        requirePositive(request.targetDurationSec(), "targetDurationSec");
                double pace = durationSec * 1000.0d / targetDistanceM;
                if (!(pace > 0) || Double.isInfinite(pace)) {
                    throw new ApiException(ErrorCode.SEARCH_CALCULATED_PACE_INVALID);
                }
                yield pace;
            }
            case "PACE" -> {
                if (request.targetDurationSec() != null) {
                    throw new ApiException(ErrorCode.SEARCH_PACE_DURATION_CONFLICT);
                }
                yield requirePositive(request.targetPaceSecPerKm(), "targetPaceSecPerKm");
            }
            default -> throw new ApiException(ErrorCode.SEARCH_GOAL_TYPE_INVALID);
        };
    }

    private static List<String> normalizeEnvironmentTypes(List<String> raw) {
        if (raw == null || raw.isEmpty()) {
            return List.of();
        }
        LinkedHashSet<String> normalized = new LinkedHashSet<>();
        for (String value : raw) {
            if (value == null || value.isBlank()) {
                throw new ApiException(ErrorCode.SEARCH_ENVIRONMENT_EMPTY);
            }
            String code = value.trim().toUpperCase(Locale.ROOT);
            if (!ALLOWED_ENVIRONMENT_TYPES.contains(code)) {
                throw new ApiException(
                        ErrorCode.INVALID_SEARCH_COURSE_NORMALIZE_ENVIRONMENT_TYPES,
                        String.valueOf(value));
            }
            normalized.add(code);
        }
        return List.copyOf(normalized);
    }

    private static int resolveRecommendLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_RECOMMEND_LIMIT;
        }
        if (limit < 1 || limit > MAX_RECOMMEND_LIMIT) {
            throw new ApiException(
                    ErrorCode.INVALID_SEARCH_COURSE_RESOLVE_RECOMMEND_LIMIT,
                    String.valueOf(MAX_RECOMMEND_LIMIT));
        }
        return limit;
    }

    private static double requireFinite(Double value, String field) {
        if (value == null || value.isNaN() || value.isInfinite()) {
            throw new ApiException(
                    ErrorCode.INVALID_SEARCH_COURSE_REQUIRE_FINITE, String.valueOf(field));
        }
        return value;
    }

    private static double requirePositive(Double value, String field) {
        double finite = requireFinite(value, field);
        if (!(finite > 0)) {
            throw new ApiException(
                    ErrorCode.INVALID_SEARCH_COURSE_REQUIRE_POSITIVE, String.valueOf(field));
        }
        return finite;
    }

    private static Integer estimateDurationSec(BigDecimal distanceM, Double targetPaceSecPerKm) {
        if (targetPaceSecPerKm == null || targetPaceSecPerKm <= 0 || distanceM == null) {
            return null;
        }
        double seconds = distanceM.doubleValue() / 1000.0 * targetPaceSecPerKm;
        return (int) Math.round(seconds);
    }

    private static int estimateDurationSecRequired(BigDecimal distanceM, double paceSecPerKm) {
        Integer estimated = estimateDurationSec(distanceM, paceSecPerKm);
        if (estimated == null || estimated <= 0) {
            throw new ApiException(ErrorCode.INVALID_SEARCH);
        }
        return estimated;
    }

    private record ValidatedRecommendSearch(
            String startEwkt,
            double radiusM,
            BigDecimal minDistanceM,
            BigDecimal maxDistanceM,
            List<String> environmentTypes,
            int limit,
            double paceSecPerKm) {}

    private GeoJsonLineString parseLineString(String geoJson) {
        try {
            return jsonMapper.readValue(geoJson, GeoJsonLineString.class);
        } catch (Exception ex) {
            throw new IllegalStateException("failed to parse course route GeoJSON", ex);
        }
    }

    private GeoJsonPoint parsePoint(String geoJson) {
        try {
            return jsonMapper.readValue(geoJson, GeoJsonPoint.class);
        } catch (Exception ex) {
            throw new IllegalStateException("failed to parse course startPosition GeoJSON", ex);
        }
    }

    private JsonNode parseElevationProfile(String json) {
        if (json == null || json.isBlank()) {
            return null;
        }
        try {
            return jsonMapper.readTree(json);
        } catch (Exception ex) {
            throw new IllegalStateException("failed to parse elevationProfile JSON", ex);
        }
    }

    private static ApiException courseNotFound() {
        return new ApiException(ErrorCode.COURSE_NOT_FOUND);
    }

    private static ApiException invalidCursor() {
        return new ApiException(ErrorCode.VALIDATION_ERROR_CURSOR_FORMAT);
    }
}
