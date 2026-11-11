package com.runway.backend.domain.course.service;

import com.runway.backend.domain.community.repository.RunningSessionLookupRepository;
import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.domain.session.repository.SessionControlEventRepository;
import com.runway.backend.domain.session.repository.SessionRouteRepository;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseResumeEvent;
import com.runway.backend.domain.session.service.PostRunAnalysisCalculator.PauseInterval;
import com.runway.backend.domain.session.service.RunningRouteSelector;
import com.runway.backend.domain.session.service.RunningRouteSelector.RoutePoint;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonGeographyMapper;
import com.runway.backend.global.geo.GeoJsonLineString;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.databind.json.JsonMapper;

/** 완료된 자유 러닝의 GPS를 요청 시 한 번만 개인 코스로 변환한다. */
@Service
@RequiredArgsConstructor
public class RunCourseService {
    private static final double EARTH_RADIUS_M = 6_371_008.8;
    private static final int MAX_POINTS = 3_000;

    private final JdbcTemplate jdbc;
    private final JsonMapper jsonMapper;
    private final RunningSessionLookupRepository sessions;
    private final SessionRouteRepository routes;
    private final SessionControlEventRepository controls;
    private final PreparedCourseGrade preparedGrade;
    private final CourseJdbcRepository courseRepository;

    @Transactional
    public long save(long userId, long sessionId) {
        Long courseId = saveInternal(userId, sessionId, false);
        courseRepository.upsertBookmark(userId, courseId, false, null);
        return courseId;
    }

    public record PostSaveResult(Long courseId, String failureReason) {}

    @Transactional
    public PostSaveResult trySaveForPost(long userId, long sessionId) {
        try {
            Long id = saveInternal(userId, sessionId, true);
            return new PostSaveResult(id, id == null ? "INSUFFICIENT_GPS" : null);
        } catch (ApiException ex) {
            if (ex.errorCode() == ErrorCode.COURSE_GRADE_NOT_READY
                    || ex.errorCode() == ErrorCode.COURSE_GRADE_UNAVAILABLE) {
                return new PostSaveResult(null, "GRADE_UNAVAILABLE");
            }
            throw ex;
        }
    }

    private Long saveInternal(long userId, long sessionId, boolean allowInsufficientGps) {
        var session = sessions.findByIdForUpdate(sessionId)
                .orElseThrow(() -> new ApiException(ErrorCode.SESSION_NOT_FOUND));
        if (session.userId() != userId) throw new ApiException(ErrorCode.SESSION_FORBIDDEN);
        if (session.isDeleted() || !session.isCompleted())
            throw new ApiException(ErrorCode.SESSION_INVALID_STATE, "코스 저장");
        if (session.courseId() != null) return session.courseId();
        Long existing = jdbc.query("SELECT id FROM courses WHERE source_session_id=?",
                (rs, n) -> rs.getLong(1), sessionId).stream().findFirst().orElse(null);
        if (existing != null) return existing;

        var bounds = jdbc.query("SELECT started_at,ended_at FROM running_sessions WHERE id=?",
                (rs, n) -> new Bounds(rs.getTimestamp(1) == null ? null : rs.getTimestamp(1).toInstant(),
                        rs.getTimestamp(2) == null ? null : rs.getTimestamp(2).toInstant()),
                sessionId).getFirst();
        if (bounds.start() == null || bounds.end() == null || !bounds.end().isAfter(bounds.start()))
            return insufficient(allowInsufficientGps);
        List<PauseResumeEvent> events = controls
                .findBySessionIdAndActionInAndResultOrderByAppliedAtAscIdAsc(
                        sessionId, List.of(ControlAction.PAUSE, ControlAction.RESUME), ControlResult.APPLIED)
                .stream().map(e -> new PauseResumeEvent(e.getAction(), e.getAppliedAt())).toList();
        List<PauseInterval> pauses = PostRunAnalysisCalculator.pauseIntervals(
                events, bounds.start(), bounds.end());
        List<List<RoutePoint>> parts = RunningRouteSelector.selectTimed(
                routes.findPoints(sessionId, bounds.start(), bounds.end()));
        List<RoutePoint> chosen = new ArrayList<>();
        List<Integer> gaps = new ArrayList<>();
        for (var part : parts) {
            boolean firstInPart = true;
            for (var point : part) {
                if (insidePause(point.measuredAt(), pauses)) continue;
                if (!chosen.isEmpty() && (firstInPart || crossesPause(
                        chosen.getLast().measuredAt(), point.measuredAt(), pauses))) {
                    gaps.add(chosen.size() - 1);
                }
                chosen.add(point);
                firstInPart = false;
            }
        }
        if (chosen.size() < 2) return insufficient(allowInsufficientGps);
        // 원본의 측정된 변 길이를 먼저 합산한다. 표시 좌표 축소가 코스 거리를 바꾸지 않는다.
        double measured = 0;
        for (int i = 1; i < chosen.size(); i++) {
            if (!gaps.contains(i - 1)) measured += distance(chosen.get(i - 1), chosen.get(i));
        }
        if (measured < 1 || measured > 9_999_999_999.99)
            return insufficient(allowInsufficientGps);
        BigDecimal storedDistance = BigDecimal.valueOf(measured).setScale(2, RoundingMode.HALF_UP);
        var elevation = preparedGrade.elevationSource()
                .orElseThrow(() -> new ApiException(ErrorCode.COURSE_GRADE_NOT_READY));
        var grade = RunCourseGradeCalculator.calculate(chosen, gaps, storedDistance, elevation);
        if (chosen.size() > MAX_POINTS) {
            var kept = new ArrayList<RoutePoint>();
            var newGaps = new ArrayList<Integer>();
            int originalSize = chosen.size();
            for (int i = 0; i < MAX_POINTS; i++) {
                int index = (int) Math.round(i * (originalSize - 1.0) / (MAX_POINTS - 1));
                if (!kept.isEmpty()) {
                    int previous = (int) Math.round((i - 1) * (originalSize - 1.0) / (MAX_POINTS - 1));
                    for (int gap : gaps) {
                        if (gap >= previous && gap < index) {
                            newGaps.add(kept.size() - 1);
                            break;
                        }
                    }
                }
                kept.add(chosen.get(index));
            }
            chosen = kept;
            gaps = newGaps;
        }
        var coords = chosen.stream().map(p -> List.of(p.longitude(), p.latitude())).toList();
        GeoJsonLineString route = GeoJsonLineString.of(coords);
        String routeEwkt = GeoJsonGeographyMapper.toEwkt(route);
        var first = chosen.getFirst();
        String startEwkt = GeoJsonGeographyMapper.toEwkt(
                GeoJsonPoint.of(first.longitude(), first.latitude()));
        Long id = jdbc.queryForObject("""
                INSERT INTO courses(creator_id,source_session_id,route,start_position,distance,
                                    elevation_gain,elevation_profile,is_private,unmeasured_edges)
                VALUES (?,?,ST_GeogFromText(?),ST_GeogFromText(?),?, ?,CAST(? AS jsonb),true,CAST(? AS jsonb))
                RETURNING id
                """, Long.class, userId, sessionId, routeEwkt, startEwkt,
                storedDistance, grade.elevationGainM(),
                jsonMapper.writeValueAsString(grade.profile()), jsonMapper.writeValueAsString(gaps));
        jdbc.update("UPDATE running_sessions SET course_id=? WHERE id=?", id, sessionId);
        return id;
    }

    private static Long insufficient(boolean allowInsufficientGps) {
        if (allowInsufficientGps) return null;
        throw new ApiException(ErrorCode.VALIDATION_ERROR);
    }

    private static boolean insidePause(Instant at, List<PauseInterval> pauses) {
        return pauses.stream().anyMatch(p -> !at.isBefore(p.start()) && at.isBefore(p.end()));
    }

    private static boolean crossesPause(Instant from, Instant to, List<PauseInterval> pauses) {
        return pauses.stream().anyMatch(p -> from.isBefore(p.end()) && to.isAfter(p.start()));
    }

    private static double distance(RoutePoint a, RoutePoint b) {
        double dLat = Math.toRadians(b.latitude() - a.latitude());
        double dLon = Math.toRadians(b.longitude() - a.longitude());
        double h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(a.latitude()))
                * Math.cos(Math.toRadians(b.latitude())) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
    }

    private record Bounds(Instant start, Instant end) {}
}
