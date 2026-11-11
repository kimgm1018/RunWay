package com.runway.backend.global.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class ErrorCodeTest {
    @Test
    void authenticationAndCommonErrorsKeepTheirPublicContract() {
        assertContract(
                ErrorCode.INVALID_REFRESH_TOKEN, 401, "INVALID_REFRESH_TOKEN", "다시 로그인해 주세요.");
        assertContract(
                ErrorCode.INVALID_CREDENTIALS,
                401,
                "INVALID_CREDENTIALS",
                "아이디 또는 비밀번호가 올바르지 않습니다.");
        assertContract(
                ErrorCode.LOGIN_LOCKED, 429, "LOGIN_LOCKED", "로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(ErrorCode.PROFILE_NOT_SET, 404, "PROFILE_NOT_SET", "러닝 초기 설정이 필요합니다.");
        assertContract(ErrorCode.VALIDATION_ERROR, 400, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다.");
        assertContract(ErrorCode.INTERNAL_ERROR, 500, "INTERNAL_ERROR", "서버 오류가 발생했습니다.");
        assertContract(
                ErrorCode.SERVICE_UNAVAILABLE, 503, "SERVICE_UNAVAILABLE", "일시적으로 처리할 수 없습니다.");
        assertContract(ErrorCode.FORBIDDEN, 403, "FORBIDDEN", "접근 권한이 없습니다.");
    }

    @Test
    void distinctOperationsKeepTheirMessagesWithoutChangingThePublicCode() {
        assertContract(
                ErrorCode.SESSION_INVALID_STATE,
                409,
                "INVALID_STATE",
                "현재 상태에서는 취소할 수 없습니다.",
                "취소");
        assertContract(
                ErrorCode.SESSION_INVALID_STATE,
                409,
                "INVALID_STATE",
                "현재 상태에서는 삭제할 수 없습니다.",
                "삭제");
        assertContract(ErrorCode.NOT_AUTHOR, 403, "NOT_AUTHOR", "작성자만 수정할 수 있습니다.", "수정");
        assertContract(ErrorCode.NOT_AUTHOR, 403, "NOT_AUTHOR", "작성자만 삭제할 수 있습니다.", "삭제");
        assertContract(ErrorCode.NOT_AUTHOR, 403, "NOT_AUTHOR", "작성자만 수정·삭제할 수 있습니다.", "수정·삭제");
        assertContract(
                ErrorCode.VALIDATION_REQUIRED_FIELD,
                400,
                "VALIDATION_ERROR",
                "title은 필수입니다.",
                "title");
        assertContract(
                ErrorCode.VALIDATION_REQUIRED_FIELD,
                400,
                "VALIDATION_ERROR",
                "meetingPlaceName은 필수입니다.",
                "meetingPlaceName");
        assertContract(
                ErrorCode.VALIDATION_REQUIRED_FIELD,
                400,
                "VALIDATION_ERROR",
                "scheduledAt은 필수입니다.",
                "scheduledAt");
        assertContract(
                ErrorCode.VALIDATION_REQUIRED_FIELD,
                400,
                "VALIDATION_ERROR",
                "meetingPosition은 필수입니다.",
                "meetingPosition");
        assertContract(ErrorCode.SESSION_FORBIDDEN, 403, "SESSION_FORBIDDEN", "본인 러닝 세션이 아닙니다.");
        assertContract(
                ErrorCode.BATCH_SESSION_FORBIDDEN,
                403,
                "SESSION_FORBIDDEN",
                "본인 러닝 세션과 기기 관계가 맞지 않습니다.");
    }

    @Test
    void templatesKeepBoundsAndDoNotInterpretArgumentsAsTemplates() {
        ErrorCode limit = ErrorCode.VALIDATION_LIMIT_OUT_OF_RANGE;
        assertThat(new ApiException(limit, "50").getMessage())
                .isEqualTo("limit은 1 이상 50 이하여야 합니다.");
        assertThatThrownBy(() -> new ApiException(limit))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new ApiException(limit, "50", "extra"))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(ErrorCode.INVALID_SEARCH_COURSE_REQUIRE_FINITE.message("field{0}$\\"))
                .isEqualTo("field{0}$\\이(가) 올바르지 않습니다.");
        assertContract(
                ErrorCode.SEARCH_DISTANCE_KM_RANGE,
                422,
                "INVALID_SEARCH",
                "distanceKm는 1.0 이상 21.1 이하여야 합니다.");
        assertContract(
                ErrorCode.SEARCH_SHAPE_INVALID,
                422,
                "INVALID_SEARCH",
                "shape는 loop, out_and_back, point_to_point 중 하나여야 합니다.");
        assertContract(
                ErrorCode.SEARCH_DESTINATION_REQUIRED,
                422,
                "INVALID_SEARCH",
                "point_to_point에는 endLatitude와 endLongitude가 필요합니다.");
        assertContract(
                ErrorCode.SEARCH_SEED_INVALID,
                422,
                "INVALID_SEARCH",
                "seed는 1 이상 10000000 이하여야 합니다.");
        assertContract(
                ErrorCode.SEARCH_OUT_OF_AREA,
                422,
                "INVALID_SEARCH",
                "출발 위치가 서비스 지역 밖입니다.");
        assertContract(
                ErrorCode.SEARCH_OUT_OF_APP_RANGE,
                422,
                "INVALID_SEARCH",
                "출발-도착 직선거리가 서비스 상한을 초과했습니다.");
    }

    @Test
    void courseGenerationErrorsUseCommonPublicCodes() {
        assertContract(
                ErrorCode.SEARCH_NO_ROAD_NEARBY,
                422,
                "INVALID_SEARCH",
                "출발 위치 주변에서 달릴 수 있는 길을 찾지 못했습니다.");
        assertContract(
                ErrorCode.SEARCH_DESTINATION_NO_ROAD_NEARBY,
                422,
                "INVALID_SEARCH",
                "도착 위치 주변에서 달릴 수 있는 길을 찾지 못했습니다.");
        assertContract(
                ErrorCode.SEARCH_DESTINATION_TOO_FAR,
                422,
                "INVALID_SEARCH",
                "목표 거리로 도착 위치까지 가는 코스를 만들 수 없습니다.");
        assertContract(ErrorCode.SEARCH_NO_ROUTE, 422, "INVALID_SEARCH", "조건에 맞는 코스를 찾지 못했습니다.");
        assertContract(
                ErrorCode.COURSE_ROUTE_NOT_READY,
                503,
                "SERVICE_UNAVAILABLE",
                "코스 추천 서비스를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_ROUTE_BUSY,
                503,
                "SERVICE_UNAVAILABLE",
                "코스 추천 요청이 많습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_ROUTE_TIMEOUT,
                503,
                "SERVICE_UNAVAILABLE",
                "코스 추천 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_ROUTE_UNAVAILABLE,
                503,
                "SERVICE_UNAVAILABLE",
                "코스 추천 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_GRADE_NOT_READY,
                503,
                "SERVICE_UNAVAILABLE",
                "경사 정보를 준비하고 있습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_GRADE_UNAVAILABLE,
                503,
                "SERVICE_UNAVAILABLE",
                "경사 정보를 계산할 수 없습니다. 잠시 후 다시 시도해 주세요.");
        assertContract(
                ErrorCode.COURSE_GENERATION_TIMEOUT,
                503,
                "SERVICE_UNAVAILABLE",
                "코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.");
    }

    private static void assertContract(
            ErrorCode error, int status, String code, String message, String... arguments) {
        ApiException exception = new ApiException(error, arguments);
        assertThat(exception.status().value()).isEqualTo(status);
        assertThat(exception.code()).isEqualTo(code);
        assertThat(exception.getMessage()).isEqualTo(message);
    }
}
