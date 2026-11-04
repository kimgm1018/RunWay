package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * {@code courses.elevation_profile} 경사 목록 검증·정규화. 형식과 규칙은 AI 개인 계획의 {@code PlanGradeSegment}·저장
 * 경사 검사(ai/service/app/db_lookup.py {@code _stored_grade}, course_grade.py)와 일치시키며 courses.md C03
 * elevationProfile 절에 정의한다.
 *
 * <p>허용 오차는 AI보다 엄격하다(시작·연속·폭은 정확히 일치, 총거리 ±0.99m). 서버를 통과한 값은 AI의 float 검사도
 * 통과한다.
 *
 * <p>모든 숫자는 검증 전에 정규화한다(0은 {@code 0}, 그 밖은 끝자리 0 제거, 지수 표기 정수는 일반 정수). 검증한 값과
 * 저장하는 값이 같도록 호출부는 반환된 목록을 저장한다.
 */
public final class GradeProfileValidator {

    /** AI MAX_STORED_GRADE_SEGMENTS. */
    public static final int MAX_SEGMENTS = 450;
    public static final int BASE_STEP_M = 100;
    /** 숫자의 최대 소수 자릿수. */
    public static final int MAX_DECIMAL_PLACES = 6;

    private static final BigDecimal BASE_STEP = BigDecimal.valueOf(BASE_STEP_M);
    private static final String FIELD = "elevationProfile";
    /**
     * 총거리 허용 오차. AI는 float로 |끝 − 거리| ≤ 1.0을 검사하므로 정확히 1m 차이는 float 오차로 거절될 수 있다. 서버가
     * 받은 값은 AI도 받도록 0.01m 여유를 둔다(거리 상한 1e10 근처에서도 float 오차는 1e-5 미만).
     */
    private static final BigDecimal TOTAL_DISTANCE_TOLERANCE_M = new BigDecimal("0.99");
    private static final BigDecimal MAX_ABS_GRADE_PERCENT = new BigDecimal("100");
    /** courses.distance NUMERIC(12,2) 상한. 조각 거리도 이 값을 넘을 수 없다. */
    static final BigDecimal MAX_DISTANCE_M = new BigDecimal("9999999999.99");
    /** 정규화 전 크기 상한(10^12). 모든 허용 범위보다 크며, 이를 넘는 지수는 계산 없이 거절한다. */
    private static final long MAX_ADJUSTED_EXPONENT = 12;

    private GradeProfileValidator() {}

    /**
     * 검증하고 정규화한 목록을 돌려준다.
     *
     * @param courseDistanceM 저장될 코스 거리(소수 2자리로 맞춘 값)
     */
    public static List<GradeSegment> validate(
            List<GradeSegment> segments, BigDecimal courseDistanceM) {
        if (courseDistanceM == null
                || courseDistanceM.signum() <= 0
                || courseDistanceM.compareTo(MAX_DISTANCE_M) > 0) {
            throw invalid("distanceM", "0 초과 " + MAX_DISTANCE_M + " 이하여야 합니다.");
        }
        if (segments == null || segments.isEmpty()) {
            throw invalid(FIELD, "필수입니다.");
        }
        if (segments.size() > MAX_SEGMENTS) {
            throw invalid(FIELD, MAX_SEGMENTS + "개 이하여야 합니다.");
        }
        BigDecimal step = stepFor(courseDistanceM);

        int last = segments.size() - 1;
        List<GradeSegment> normalized = new ArrayList<>(segments.size());
        for (int i = 0; i <= last; i++) {
            GradeSegment segment = segments.get(i);
            if (segment == null) {
                throw invalid(at(i), "null일 수 없습니다.");
            }
            GradeSegment current = validateSegment(segment, i, i == last, step);
            // 연속성은 정확히 일치해야 한다. AI는 float로 1e-6 이내를 검사하므로 경계 값이 float 오차로 거절될 수 있다.
            if (i > 0
                    && normalized.get(i - 1).endDistanceM().compareTo(current.startDistanceM())
                            != 0) {
                throw invalid(at(i, "startDistanceM"), "이전 조각의 endDistanceM과 같아야 합니다.");
            }
            normalized.add(current);
        }

        BigDecimal lastEnd = normalized.get(last).endDistanceM();
        if (!within(lastEnd, courseDistanceM, TOTAL_DISTANCE_TOLERANCE_M)) {
            throw invalid(at(last, "endDistanceM"), "코스 총거리와 일치해야 합니다.");
        }
        return List.copyOf(normalized);
    }

    /** 조각 폭. 100m이며, 100m로 450개를 넘으면 AI와 같이 100 × ceil(거리 / 45000)m로 넓힌다. */
    static BigDecimal stepFor(BigDecimal courseDistanceM) {
        BigDecimal count = courseDistanceM.divide(BASE_STEP, 0, RoundingMode.CEILING);
        if (count.compareTo(BigDecimal.valueOf(MAX_SEGMENTS)) <= 0) {
            return BASE_STEP;
        }
        BigDecimal multiplier =
                courseDistanceM.divide(
                        BASE_STEP.multiply(BigDecimal.valueOf(MAX_SEGMENTS)),
                        0,
                        RoundingMode.CEILING);
        return BASE_STEP.multiply(multiplier);
    }

    private static GradeSegment validateSegment(
            GradeSegment segment, int position, boolean last, BigDecimal step) {
        if (segment.startDistanceM() == null
                || segment.endDistanceM() == null
                || segment.gradePercent() == null) {
            throw invalid(at(position), "startDistanceM·endDistanceM·gradePercent는 필수입니다.");
        }
        BigDecimal start =
                normalizeInRange(
                        segment.startDistanceM(),
                        BigDecimal.ZERO,
                        MAX_DISTANCE_M,
                        position,
                        "startDistanceM");
        BigDecimal end =
                normalizeInRange(
                        segment.endDistanceM(),
                        BigDecimal.ZERO,
                        MAX_DISTANCE_M,
                        position,
                        "endDistanceM");
        BigDecimal grade =
                normalizeInRange(
                        segment.gradePercent(),
                        MAX_ABS_GRADE_PERCENT.negate(),
                        MAX_ABS_GRADE_PERCENT,
                        position,
                        "gradePercent");

        BigDecimal expectedStart = step.multiply(BigDecimal.valueOf(position));
        if (start.compareTo(expectedStart) != 0) {
            throw invalid(at(position, "startDistanceM"), "순서 × " + step + "m여야 합니다.");
        }
        BigDecimal width = end.subtract(start);
        if (last) {
            if (width.signum() <= 0 || width.compareTo(step) > 0) {
                throw invalid(at(position, "endDistanceM"), "마지막 조각 길이는 0 초과 " + step + "m 이하여야 합니다.");
            }
        } else if (width.compareTo(step) != 0) {
            throw invalid(at(position, "endDistanceM"), "조각 길이는 " + step + "m여야 합니다.");
        }
        return new GradeSegment(start, end, grade);
    }

    /**
     * 숫자를 정규화하고 소수 자릿수·범위를 검사한다. 크기는 정밀도·스케일만으로(long 연산) 먼저 제한해, 거대한 지수가
     * 산술 연산에 들어가거나 {@link ArithmeticException}을 내지 않게 한다.
     */
    static BigDecimal normalizeInRange(
            BigDecimal value, BigDecimal min, BigDecimal max, int position, String field) {
        if (value.signum() == 0) {
            // 0E-2000 등 표기와 무관하게 0으로 저장한다.
            return requireInRange(BigDecimal.ZERO, min, max, position, field);
        }
        long adjustedExponent = (long) value.precision() - value.scale() - 1;
        if (adjustedExponent > MAX_ADJUSTED_EXPONENT) {
            throw invalid(at(position, field), min + "~" + max + " 범위여야 합니다.");
        }
        BigDecimal stripped = value.stripTrailingZeros();
        if (stripped.scale() > MAX_DECIMAL_PLACES) {
            throw invalid(at(position, field), "소수 " + MAX_DECIMAL_PLACES + "자리까지 허용합니다.");
        }
        if (stripped.scale() < 0) {
            // 1E+3 → 1000. 위 크기 제한으로 자릿수가 작다.
            stripped = stripped.setScale(0);
        }
        return requireInRange(stripped, min, max, position, field);
    }

    private static BigDecimal requireInRange(
            BigDecimal value, BigDecimal min, BigDecimal max, int position, String field) {
        if (value.compareTo(min) < 0 || value.compareTo(max) > 0) {
            throw invalid(at(position, field), min + "~" + max + " 범위여야 합니다.");
        }
        return value;
    }

    private static boolean within(BigDecimal actual, BigDecimal expected, BigDecimal tolerance) {
        return actual.subtract(expected).abs().compareTo(tolerance) <= 0;
    }

    private static String at(int position) {
        return FIELD + "[" + position + "]";
    }

    private static String at(int position, String field) {
        return at(position) + "." + field;
    }

    /**
     * 공통 {@code VALIDATION_ERROR}(400)로 거절한다. {@code details.fields}에 필드 이름과 사유만 담고 입력값은 넣지
     * 않는다.
     */
    static ApiException invalid(String name, String reason) {
        return new ApiException(
                ErrorCode.VALIDATION_ERROR,
                Map.of("fields", List.of(Map.of("name", name, "reason", reason))));
    }
}
