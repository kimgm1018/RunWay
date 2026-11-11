package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.candidate.CourseCandidateSigner;
import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.dto.request.RecommendCoursesRequest;
import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;
import com.runway.backend.domain.course.dto.response.RecommendedCourseItemResponse;
import com.runway.backend.domain.course.dto.response.RecommendedCourseItemResponse.ScoreTermResponse;
import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.recommend.CourseRecommendCommand;
import com.runway.backend.domain.course.recommend.CourseRecommendFilters;
import com.runway.backend.domain.course.recommend.CourseRecommendPort;
import com.runway.backend.domain.course.recommend.CourseRecommendShape;
import com.runway.backend.domain.course.recommend.GeneratedCourseCandidate;
import com.runway.backend.domain.course.recommend.GeneratedCourses;
import com.runway.backend.domain.course.repository.CourseJdbcRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;

/**
 * C01 코스 추천. 입력 검증 → 생성기(Route) 호출 → 후보별 DEM 경사 계산 → 공개 응답 조합.
 *
 * <p>외부 호출이 최대 15초 걸리므로 DB 트랜잭션을 열지 않는다(사용자 확인은 단건 조회). 전체 예산(기본 20초)이 먼저 끝나면
 * 단계와 관계없이 {@code GENERATION_TIMEOUT}이며 부분 후보를 반환하지 않는다. 자동 재시도·스텁 전환은 하지 않는다.
 */
@Service
public class CourseRecommendService {

    private static final double MIN_DISTANCE_KM = 1.0d;
    /** 하프 마라톤(S15P31E105-608). Route MAX_KM과 같다. */
    private static final double MAX_DISTANCE_KM = 21.1d;
    private static final int MIN_SEED = 1;
    private static final int MAX_SEED = 10_000_000;

    /**
     * point_to_point 출발–도착 직선거리 상한(m). Route 사전 거절과 같은 1.1 × 21.1 km + 2 × 250 m(끝점 snap 여유).
     */
    private static final double MAX_P2P_STRAIGHT_M = 23_710d;

    private static final double METERS_PER_DEG_LAT = 111_320d;

    private final CourseJdbcRepository courseJdbcRepository;
    private final CourseRecommendPort courseRecommendPort;
    private final PreparedCourseGrade preparedCourseGrade;
    private final CourseCandidateSigner candidateSigner;
    private final Clock clock;
    private final Duration generationTimeout;

    public CourseRecommendService(
            CourseJdbcRepository courseJdbcRepository,
            CourseRecommendPort courseRecommendPort,
            PreparedCourseGrade preparedCourseGrade,
            CourseCandidateSigner candidateSigner,
            Clock clock,
            @Value("${runway.course.generation-timeout:PT20S}") Duration generationTimeout) {
        this.courseJdbcRepository = courseJdbcRepository;
        this.courseRecommendPort = courseRecommendPort;
        this.preparedCourseGrade = preparedCourseGrade;
        this.candidateSigner = candidateSigner;
        this.clock = clock;
        this.generationTimeout = generationTimeout;
    }

    public RecommendCoursesResponse recommend(long userId, RecommendCoursesRequest request) {
        if (!courseJdbcRepository.existsUserById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
        CourseRecommendCommand command = validateRecommendCommand(request);
        // DEM이 없으면 Route 계산을 시작하기 전에 거절해 생성기 자원을 쓰지 않는다.
        CourseGradeService gradeService =
                preparedCourseGrade
                        .gradeService()
                        .orElseThrow(() -> failure(ErrorCode.COURSE_GRADE_NOT_READY, "GRADE_NOT_READY"));

        Instant deadline = clock.instant().plus(generationTimeout);
        GeneratedCourses generated = courseRecommendPort.recommend(command, deadline);

        List<RecommendedCourseItemResponse> courses = new ArrayList<>(generated.courses().size());
        for (GeneratedCourseCandidate candidate : generated.courses()) {
            requireBudget(deadline);
            courses.add(toResponse(userId, candidate, grade(gradeService, candidate)));
        }
        // 마지막 계산이 예산을 넘겼으면 정상 응답을 시작하지 않는다.
        requireBudget(deadline);
        return new RecommendCoursesResponse(courses, generated.notices(), generated.nextSeed());
    }

    private static List<GradeSegment> grade(
            CourseGradeService gradeService, GeneratedCourseCandidate candidate) {
        try {
            return gradeService.calculate(candidate.route(), candidate.distanceM());
        } catch (ApiException ex) {
            // DEM 범위 밖·유효 고도 부족 등 의존 데이터 문제. 원인은 공개 응답에 넣지 않는다.
            throw failure(ErrorCode.COURSE_GRADE_UNAVAILABLE, "GRADE_UNAVAILABLE");
        }
    }

    private void requireBudget(Instant deadline) {
        if (!clock.instant().isBefore(deadline)) {
            throw failure(ErrorCode.COURSE_GENERATION_TIMEOUT, "GENERATION_TIMEOUT");
        }
    }

    private RecommendedCourseItemResponse toResponse(
            long userId, GeneratedCourseCandidate candidate, List<GradeSegment> elevationProfile) {
        return new RecommendedCourseItemResponse(
                candidate.index(),
                candidate.distanceM(),
                candidate.route(),
                elevationProfile,
                candidate.summary(),
                candidate.reasons(),
                candidate.caveats(),
                candidate.score(),
                candidate.scoreTerms().stream()
                        .map(
                                term ->
                                        new ScoreTermResponse(
                                                term.term(),
                                                term.label(),
                                                term.group(),
                                                term.featureValue(),
                                                term.weight(),
                                                term.contribution()))
                        .toList(),
                candidateSigner.issue(
                        userId, candidate.route(), candidate.distanceM(), elevationProfile));
    }

    private static ApiException failure(ErrorCode errorCode, String reason) {
        return new ApiException(errorCode, Map.of("reason", reason));
    }

    private static CourseRecommendCommand validateRecommendCommand(RecommendCoursesRequest request) {
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
        // 서비스 지역은 Route의 OUT_OF_AREA로 판정한다(2026-11-05 AI 팀 협의). 형식·범위만 여기서 검증한다.

        double distanceKm = requireFinite(request.distanceKm(), "distanceKm");
        if (distanceKm < MIN_DISTANCE_KM || distanceKm > MAX_DISTANCE_KM) {
            throw new ApiException(ErrorCode.SEARCH_DISTANCE_KM_RANGE);
        }

        CourseRecommendShape shape = parseShape(request.shape());
        Double endLat = request.endLatitude();
        Double endLon = request.endLongitude();
        if (shape == CourseRecommendShape.POINT_TO_POINT) {
            if (endLat == null || endLon == null) {
                throw new ApiException(ErrorCode.SEARCH_DESTINATION_REQUIRED);
            }
            double endLatitude = requireFinite(endLat, "endLatitude");
            double endLongitude = requireFinite(endLon, "endLongitude");
            if (endLatitude < -90 || endLatitude > 90) {
                throw new ApiException(ErrorCode.SEARCH_LATITUDE_INVALID);
            }
            if (endLongitude < -180 || endLongitude > 180) {
                throw new ApiException(ErrorCode.SEARCH_LONGITUDE_INVALID);
            }
            if (straightDistanceM(latitude, longitude, endLatitude, endLongitude)
                    > MAX_P2P_STRAIGHT_M) {
                throw new ApiException(ErrorCode.SEARCH_OUT_OF_APP_RANGE);
            }
            endLat = endLatitude;
            endLon = endLongitude;
        } else if (endLat != null || endLon != null) {
            // 편도가 아니면 도착 좌표 한쪽만 오면 형식 오류로 본다.
            if (endLat == null || endLon == null) {
                throw new ApiException(ErrorCode.SEARCH_DESTINATION_REQUIRED);
            }
            endLat = requireFinite(endLat, "endLatitude");
            endLon = requireFinite(endLon, "endLongitude");
            // 도착 좌표 자체의 위경도 범위는 모든 shape에서 검증한다(C01 point_to_point 규칙). 값은 Route에 보내지 않는다.
            if (endLat < -90 || endLat > 90) {
                throw new ApiException(ErrorCode.SEARCH_LATITUDE_INVALID);
            }
            if (endLon < -180 || endLon > 180) {
                throw new ApiException(ErrorCode.SEARCH_LONGITUDE_INVALID);
            }
        }

        int seed = request.seed() == null ? MIN_SEED : request.seed();
        if (seed < MIN_SEED || seed > MAX_SEED) {
            throw new ApiException(ErrorCode.SEARCH_SEED_INVALID);
        }

        return new CourseRecommendCommand(
                latitude,
                longitude,
                distanceKm,
                shape,
                endLat,
                endLon,
                normalizeFilters(request.filters()),
                seed);
    }

    private static CourseRecommendShape parseShape(String raw) {
        if (raw == null || raw.isBlank()) {
            return CourseRecommendShape.LOOP;
        }
        String normalized = raw.trim().toLowerCase(Locale.ROOT);
        return switch (normalized) {
            case "loop" -> CourseRecommendShape.LOOP;
            case "out_and_back" -> CourseRecommendShape.OUT_AND_BACK;
            case "point_to_point" -> CourseRecommendShape.POINT_TO_POINT;
            default -> throw new ApiException(ErrorCode.SEARCH_SHAPE_INVALID);
        };
    }

    private static CourseRecommendFilters normalizeFilters(
            RecommendCoursesRequest.RecommendCourseFilters raw) {
        if (raw == null) {
            return CourseRecommendFilters.allOff();
        }
        return new CourseRecommendFilters(
                Boolean.TRUE.equals(raw.river()),
                Boolean.TRUE.equals(raw.beach()),
                Boolean.TRUE.equals(raw.park()),
                Boolean.TRUE.equals(raw.trail()),
                Boolean.TRUE.equals(raw.pedestrian()),
                Boolean.TRUE.equals(raw.avoidMajorRoad()),
                Boolean.TRUE.equals(raw.avoidSteps()),
                Boolean.TRUE.equals(raw.avoidTunnel()),
                Boolean.TRUE.equals(raw.flat()));
    }

    private static double straightDistanceM(
            double lat1, double lon1, double lat2, double lon2) {
        double meanLat = Math.toRadians((lat1 + lat2) / 2d);
        double dLatM = (lat2 - lat1) * METERS_PER_DEG_LAT;
        double dLonM = (lon2 - lon1) * METERS_PER_DEG_LAT * Math.cos(meanLat);
        return Math.hypot(dLatM, dLonM);
    }

    private static double requireFinite(Double value, String field) {
        if (value == null || value.isNaN() || value.isInfinite()) {
            throw new ApiException(
                    ErrorCode.INVALID_SEARCH_COURSE_REQUIRE_FINITE, String.valueOf(field));
        }
        return value;
    }
}
