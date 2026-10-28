package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.BookmarkCourseRequest;
import com.runway.backend.domain.course.dto.response.BookmarkCourseResponse;
import com.runway.backend.domain.course.dto.response.BookmarkedCourseItemResponse;
import com.runway.backend.domain.course.dto.response.BookmarkedCourseListResponse;
import com.runway.backend.domain.course.dto.response.CourseDetailResponse;
import com.runway.backend.domain.course.dto.response.UnbookmarkCourseResponse;
import com.runway.backend.domain.course.entity.CourseBookmark;
import com.runway.backend.domain.course.repository.CourseBookmarkRepository;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.BookmarkUpsertRow;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.BookmarkedCourseRow;
import com.runway.backend.domain.course.repository.CourseJdbcRepository.CourseRow;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.math.BigDecimal;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

@Service
@RequiredArgsConstructor
public class CourseService {

    private static final int ALIAS_MAX_LENGTH = 50;
    private static final int DEFAULT_BOOKMARK_LIMIT = 20;
    private static final int MAX_BOOKMARK_LIMIT = 50;

    private final CourseJdbcRepository courseJdbcRepository;
    private final CourseBookmarkRepository courseBookmarkRepository;
    private final JsonMapper jsonMapper;

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
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
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
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "별명은 최대 " + ALIAS_MAX_LENGTH + "자까지 가능합니다.");
        }
    }

    private static int resolveLimit(Integer limit) {
        if (limit == null) {
            return DEFAULT_BOOKMARK_LIMIT;
        }
        if (limit < 1 || limit > MAX_BOOKMARK_LIMIT) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "limit은 1 이상 " + MAX_BOOKMARK_LIMIT + " 이하여야 합니다.");
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

    private static Integer estimateDurationSec(BigDecimal distanceM, Double targetPaceSecPerKm) {
        if (targetPaceSecPerKm == null || targetPaceSecPerKm <= 0 || distanceM == null) {
            return null;
        }
        double seconds = distanceM.doubleValue() / 1000.0 * targetPaceSecPerKm;
        return (int) Math.round(seconds);
    }

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
        return new ApiException(HttpStatus.NOT_FOUND, "COURSE_NOT_FOUND", "코스를 찾을 수 없습니다.");
    }

    private static ApiException invalidCursor() {
        return new ApiException(
                HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "cursor 형식이 올바르지 않습니다.");
    }
}
