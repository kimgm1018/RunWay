package com.runway.backend.global.exception;

import org.springframework.http.HttpStatus;

/** 공개 오류 정의. 상수 이름과 응답 code는 다를 수 있으며 기존 메시지 변형도 보존한다. */
public enum ErrorCode {
    FOLLOW_USER_NOT_FOUND(HttpStatus.NOT_FOUND, "USER_NOT_FOUND", "사용자를 찾을 수 없습니다."),
    CANNOT_FOLLOW_SELF(HttpStatus.UNPROCESSABLE_CONTENT, "CANNOT_FOLLOW_SELF", "본인을 팔로우할 수 없습니다."),
    REQUEST_NOT_FOUND(HttpStatus.NOT_FOUND, "REQUEST_NOT_FOUND", "팔로우 요청을 찾을 수 없습니다."),
    REQUEST_STATE_CONFLICT(HttpStatus.CONFLICT, "REQUEST_STATE_CONFLICT", "팔로우 요청 상태가 변경되었습니다."),
    FOLLOW_INVALID_DECISION(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_DECISION", "APPROVE 또는 REJECT를 지정해 주세요."),
    FOLLOW_INVALID_FILTER(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "요청 목록 조회 조건이 올바르지 않습니다."),
    FOLLOW_LIST_INVALID_FILTER(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "팔로우 목록 조회 조건이 올바르지 않습니다."),
    FOLLOW_LIST_ACCESS_DENIED(
            HttpStatus.FORBIDDEN, "ACCOUNT_ACCESS_DENIED", "비공개 계정의 팔로우 목록은 볼 수 없습니다."),
    NOTIFICATION_INVALID_FILTER(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "알림 목록 조회 조건이 올바르지 않습니다."),

    INVALID_PASSWORD(HttpStatus.UNAUTHORIZED, "INVALID_PASSWORD", "비밀번호가 올바르지 않습니다."),
    AGREEMENT_REQUIRED(HttpStatus.UNPROCESSABLE_CONTENT, "AGREEMENT_REQUIRED", "탈퇴 안내에 동의해 주세요."),
    WITHDRAWAL_CONFLICT(HttpStatus.CONFLICT, "WITHDRAWAL_CONFLICT", "탈퇴 전에 정리할 항목이 있습니다."),
    IMAGE_CLEANUP_PENDING(HttpStatus.SERVICE_UNAVAILABLE, "IMAGE_CLEANUP_PENDING", "탈퇴는 완료되었으나 이미지 정리가 지연되고 있습니다."),
    WITHDRAWN_POST(HttpStatus.GONE, "WITHDRAWN_POST", "탈퇴한 회원의 게시물입니다."),
    INVALID_SHAPE(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SHAPE", "지원하지 않는 코스 형태입니다."),
    INVALID_REFRESH_TOKEN(HttpStatus.UNAUTHORIZED, "INVALID_REFRESH_TOKEN", "다시 로그인해 주세요."),
    NOT_AUTHOR(HttpStatus.FORBIDDEN, "NOT_AUTHOR", "작성자만 {0}할 수 있습니다."),
    SESSION_INVALID_STATE(HttpStatus.CONFLICT, "INVALID_STATE", "현재 상태에서는 {0}할 수 없습니다."),
    VALIDATION_REQUIRED_FIELD(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "{0}은 필수입니다."),
    INVALID_CREDENTIALS(HttpStatus.UNAUTHORIZED, "INVALID_CREDENTIALS", "아이디 또는 비밀번호가 올바르지 않습니다."),
    IMAGE_PURPOSE_INVALID(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "purpose는 PROFILE, CREW, POST 중 하나여야 합니다."),
    IMAGE_PURPOSE_REQUIRED(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "purpose는 필수입니다."),
    VALIDATION_ERROR_IMAGE_PARSE_IMAGE_ID(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "imageId가 올바르지 않습니다."),
    IMAGE_NOT_FOUND(HttpStatus.NOT_FOUND, "IMAGE_NOT_FOUND", "이미지를 찾을 수 없습니다."),
    IMAGE_MEDIA_MISMATCH(
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_MEDIA_TYPE",
            "선언한 형식과 실제 파일 내용이 일치하지 않습니다."),
    IMAGE_DECODE_FAILED(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지로 해석할 수 없습니다."),
    FILE_TOO_LARGE(HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다."),
    IMAGE_FILE_EMPTY(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지 파일이 비어 있습니다."),
    IMAGE_READ_FAILED(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지를 읽을 수 없습니다."),
    UNSUPPORTED_MEDIA_TYPE_IMAGE_MEDIA_TYPE(
            HttpStatus.UNSUPPORTED_MEDIA_TYPE,
            "UNSUPPORTED_MEDIA_TYPE",
            "jpeg 또는 png만 업로드할 수 있습니다."),
    VALIDATION_ERROR_IMAGE_RESOLVE(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "저장 경로가 올바르지 않습니다."),
    UPLOAD_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE, "UPLOAD_UNAVAILABLE", "이미지 저장소에 접근할 수 없습니다."),
    VALIDATION_ERROR(HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "요청 값이 유효하지 않습니다."),
    SERVICE_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "SERVICE_UNAVAILABLE", "일시적으로 처리할 수 없습니다."),
    LOGIN_LOCKED(HttpStatus.TOO_MANY_REQUESTS, "LOGIN_LOCKED", "로그인 시도가 제한되었습니다. 잠시 후 다시 시도해 주세요."),
    TOO_MANY_REQUESTS(
            HttpStatus.TOO_MANY_REQUESTS, "TOO_MANY_REQUESTS", "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요."),
    NICKNAME_DUPLICATED(HttpStatus.CONFLICT, "NICKNAME_DUPLICATED", "이미 사용 중인 닉네임입니다."),
    LOGIN_ID_DUPLICATED(HttpStatus.CONFLICT, "LOGIN_ID_DUPLICATED", "이미 사용 중인 아이디입니다."),
    INVALID_CONSENT(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_CONSENT", "요청 값이 유효하지 않습니다."),
    INVALID_SETTING(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SETTING", "요청한 설정이 유효하지 않습니다."),
    INVALID_VISIBILITY(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_VISIBILITY", "공개 설정 값이 유효하지 않습니다."),
    INVALID_PROFILE(HttpStatus.BAD_REQUEST, "INVALID_PROFILE", "요청 값이 유효하지 않습니다."),
    INVALID_PASSWORD_POLICY(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_PASSWORD_POLICY", "요청 값이 유효하지 않습니다."),
    // 휴대전화 인증·비밀번호 재설정(users.md U15·U28~U30, S15P31E105-560). 전화번호·인증번호를 메시지에 넣지 않는다.
    PHONE_ALREADY_REGISTERED(HttpStatus.CONFLICT, "PHONE_ALREADY_REGISTERED", "이미 가입된 전화번호입니다."),
    PHONE_NOT_REGISTERED(HttpStatus.NOT_FOUND, "PHONE_NOT_REGISTERED", "가입되지 않은 전화번호입니다."),
    PHONE_ACCOUNT_AMBIGUOUS(
            HttpStatus.CONFLICT, "PHONE_ACCOUNT_AMBIGUOUS", "이 전화번호로 가입한 계정을 하나로 정할 수 없습니다."),
    VERIFICATION_RESEND_TOO_SOON(
            HttpStatus.TOO_MANY_REQUESTS, "VERIFICATION_RESEND_TOO_SOON", "잠시 후 다시 요청해 주세요."),
    VERIFICATION_SEND_LIMIT_EXCEEDED(
            HttpStatus.TOO_MANY_REQUESTS,
            "VERIFICATION_SEND_LIMIT_EXCEEDED",
            "인증번호 요청 횟수를 초과했습니다. 나중에 다시 시도해 주세요."),
    VERIFICATION_CODE_MISMATCH(HttpStatus.BAD_REQUEST, "VERIFICATION_CODE_MISMATCH", "인증번호가 맞지 않습니다."),
    VERIFICATION_ATTEMPTS_EXCEEDED(
            HttpStatus.TOO_MANY_REQUESTS,
            "VERIFICATION_ATTEMPTS_EXCEEDED",
            "인증번호 입력 횟수를 초과했습니다. 인증번호를 다시 받아 주세요."),
    VERIFICATION_EXPIRED(HttpStatus.GONE, "VERIFICATION_EXPIRED", "인증이 만료되었습니다. 다시 인증해 주세요."),
    SMS_UNAVAILABLE(HttpStatus.SERVICE_UNAVAILABLE, "SMS_UNAVAILABLE", "인증번호를 보낼 수 없습니다. 잠시 후 다시 시도해 주세요."),
    COMMENT_NOT_FOUND(HttpStatus.NOT_FOUND, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다."),
    INVALID_PARENT_COMMENT(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_PARENT_COMMENT", "유효하지 않은 부모 댓글입니다."),
    EMPTY_COMMENT(HttpStatus.UNPROCESSABLE_CONTENT, "EMPTY_COMMENT", "댓글 본문이 비어 있습니다."),
    UNAUTHORIZED(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다."),
    VALIDATION_ERROR_COMMUNITY_REQUIRE_LIKE_TYPE(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "reactionType은 LIKE만 지원합니다."),
    INVALID_POST(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_POST", "공유할 수 있는 완료 러닝 기록이 아닙니다."),
    POST_NOT_FOUND(HttpStatus.NOT_FOUND, "POST_NOT_FOUND", "게시물을 찾을 수 없습니다."),
    POST_SCOPE_INVALID(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "scope는 ALL 또는 FOLLOWING만 허용됩니다."),
    ACCOUNT_ACCESS_DENIED(HttpStatus.FORBIDDEN, "ACCOUNT_ACCESS_DENIED", "비공개 계정 게시물에 접근할 수 없습니다."),
    RESOURCE_NOT_OWNED(HttpStatus.FORBIDDEN, "RESOURCE_NOT_OWNED", "본인 소유 자원이 아닙니다."),
    VALIDATION_ERROR_CURSOR_FORMAT(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "cursor 형식이 올바르지 않습니다."),
    VALIDATION_LIMIT_OUT_OF_RANGE(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "limit은 1 이상 {0} 이하여야 합니다."),
    VALIDATION_ERROR_COMMUNITY_PARSE_TYPE(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "type은 USER 또는 CREW여야 합니다."),
    QUERY_TOO_SHORT(HttpStatus.BAD_REQUEST, "QUERY_TOO_SHORT", "검색어가 너무 짧습니다."),
    COURSE_NOT_FOUND(HttpStatus.NOT_FOUND, "COURSE_NOT_FOUND", "코스를 찾을 수 없습니다."),
    INVALID_SEARCH(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "예상 시간을 계산할 수 없습니다."),
    INVALID_SEARCH_COURSE_REQUIRE_POSITIVE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "{0}은(는) 양수여야 합니다."),
    INVALID_SEARCH_COURSE_REQUIRE_FINITE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "{0}이(가) 올바르지 않습니다."),
    INVALID_SEARCH_COURSE_RESOLVE_RECOMMEND_LIMIT(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "limit은 1 이상 {0} 이하여야 합니다."),
    INVALID_SEARCH_COURSE_NORMALIZE_ENVIRONMENT_TYPES(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "허용되지 않은 environmentTypes 코드입니다: {0}"),
    SEARCH_ENVIRONMENT_EMPTY(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "environmentTypes에 빈 값이 있습니다."),
    SEARCH_GOAL_TYPE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "goalInputType은 TIME 또는 PACE여야 합니다."),
    SEARCH_PACE_DURATION_CONFLICT(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "PACE 목표에는 targetDurationSec을 함께 보낼 수 없습니다."),
    SEARCH_CALCULATED_PACE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "계산된 목표 페이스가 유효하지 않습니다."),
    SEARCH_TIME_PACE_CONFLICT(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "TIME 목표에는 targetPaceSecPerKm을 함께 보낼 수 없습니다."),
    SEARCH_LONGITUDE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "longitude는 -180~180이어야 합니다."),
    SEARCH_LATITUDE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "latitude는 -90~90이어야 합니다."),
    SEARCH_CONDITIONS_REQUIRED(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "추천 조건이 필요합니다."),
    SEARCH_DISTANCE_KM_RANGE(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "distanceKm는 1.0 이상 21.1 이하여야 합니다."),
    SEARCH_SHAPE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "shape는 loop, out_and_back, point_to_point 중 하나여야 합니다."),
    SEARCH_DESTINATION_REQUIRED(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "point_to_point에는 endLatitude와 endLongitude가 필요합니다."),
    SEARCH_SEED_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "seed는 1 이상 10000000 이하여야 합니다."),
    SEARCH_OUT_OF_AREA(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "출발 위치가 서비스 지역 밖입니다."),
    SEARCH_OUT_OF_APP_RANGE(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "출발-도착 직선거리가 서비스 상한을 초과했습니다."),
    // C01 Route 실연동(S15P31E105-423). 사유는 details.reason으로 구분한다(courses.md 실패와 시간 예산).
    SEARCH_NO_ROAD_NEARBY(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "출발 위치 주변에서 달릴 수 있는 길을 찾지 못했습니다."),
    SEARCH_DESTINATION_NO_ROAD_NEARBY(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "도착 위치 주변에서 달릴 수 있는 길을 찾지 못했습니다."),
    SEARCH_DESTINATION_TOO_FAR(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_SEARCH",
            "목표 거리로 도착 위치까지 가는 코스를 만들 수 없습니다."),
    SEARCH_NO_ROUTE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SEARCH", "조건에 맞는 코스를 찾지 못했습니다."),
    COURSE_ROUTE_NOT_READY(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "코스 추천 서비스를 준비하고 있습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_ROUTE_BUSY(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "코스 추천 요청이 많습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_ROUTE_TIMEOUT(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "코스 추천 응답이 늦어지고 있습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_ROUTE_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "코스 추천 서비스를 사용할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_GRADE_NOT_READY(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "경사 정보를 준비하고 있습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_GRADE_UNAVAILABLE(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "경사 정보를 계산할 수 없습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_GENERATION_TIMEOUT(
            HttpStatus.SERVICE_UNAVAILABLE,
            "SERVICE_UNAVAILABLE",
            "코스 생성 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요."),
    COURSE_CANDIDATE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "COURSE_CANDIDATE_INVALID",
            "코스 후보가 만료되었거나 유효하지 않습니다. 코스를 다시 추천받아 주세요."),
    VALIDATION_ERROR_COURSE_VALIDATE_ALIAS_LENGTH(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "별명은 최대 {0}자까지 가능합니다."),
    INVALID_FILTER_CREW_INVALID_MEMBERSHIP_FILTER(
            HttpStatus.BAD_REQUEST,
            "INVALID_FILTER",
            "membershipStatus는 APPROVED 또는 PENDING만 허용됩니다."),
    INVALID_DECISION(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_DECISION",
            "status는 APPROVED 또는 REJECTED만 허용됩니다."),
    NOT_PENDING(HttpStatus.CONFLICT, "NOT_PENDING", "대기 중인 가입 신청이 없습니다."),
    CREW_NOT_FOUND(HttpStatus.NOT_FOUND, "CREW_NOT_FOUND", "크루를 찾을 수 없습니다."),
    INVALID_FILTER_CREW_RESOLVE_JOIN_REQUEST_STATUS(
            HttpStatus.BAD_REQUEST,
            "INVALID_FILTER",
            "status는 PENDING, APPROVED, REJECTED, LEFT만 허용됩니다."),
    NOT_ADMIN(HttpStatus.FORBIDDEN, "NOT_ADMIN", "크루 관리 권한이 없습니다."),
    MEMBER_NOT_FOUND(HttpStatus.NOT_FOUND, "MEMBER_NOT_FOUND", "멤버를 찾을 수 없습니다."),
    CANNOT_REMOVE_OWNER(HttpStatus.CONFLICT, "CANNOT_REMOVE_OWNER", "크루장은 내보낼 수 없습니다."),
    INVALID_SUCCESSOR(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_SUCCESSOR", "후임은 본인이 될 수 없습니다."),
    OWNER_CANNOT_LEAVE(
            HttpStatus.CONFLICT, "OWNER_CANNOT_LEAVE", "크루장은 후임(successorUserId)을 지정한 뒤 탈퇴해야 합니다."),
    OWNER_CANNOT_LEAVE_SOLE_OWNER_LEAVE(
            HttpStatus.CONFLICT, "OWNER_CANNOT_LEAVE", "혼자인 크루장은 탈퇴할 수 없습니다. 크루 해산 API를 사용하세요."),
    VALIDATION_ERROR_CREW_LEAVE(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "후임 지정은 크루장 탈퇴에만 사용할 수 있습니다."),
    CREW_CAPACITY_EXCEEDED(HttpStatus.CONFLICT, "CREW_CAPACITY_EXCEEDED", "크루 정원이 가득 찼습니다."),
    CREW_CAPACITY_BELOW_MEMBERS(
            HttpStatus.CONFLICT, "CREW_CAPACITY_BELOW_MEMBERS", "정원은 현재 멤버 수보다 작게 정할 수 없습니다."),
    ALREADY_MEMBER_OR_PENDING(
            HttpStatus.CONFLICT, "ALREADY_MEMBER_OR_PENDING", "이미 멤버이거나 가입 신청 대기 중입니다."),
    INVALID_CREW(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_CREW", "유효하지 않은 지역 코드입니다."),
    INVALID_CREW_SETTINGS(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_CREW",
            "정원은 1~200명, 가입 방식은 APPROVAL 또는 INSTANT로 지정해 주세요."),
    INVALID_BATCH(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_BATCH", "배치 내용이 유효하지 않습니다."),
    INVALID_CONSENT_CONSENT_CHANGE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_CONSENT", "변경할 수 없는 동의 유형입니다."),
    VALIDATION_ERROR_DEVICE_PARSE_INCLUDE_UNLINKED(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "includeUnlinked는 true 또는 false만 허용됩니다."),
    VALIDATION_ERROR_DEVICE_PARSE_DEVICE_TYPE_FILTER(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "deviceType은 PHONE 또는 WATCH만 허용됩니다."),
    DEVICE_NOT_FOUND(HttpStatus.NOT_FOUND, "DEVICE_NOT_FOUND", "기기를 찾을 수 없습니다."),
    CONSENT_REQUIRED(HttpStatus.FORBIDDEN, "CONSENT_REQUIRED", "건강정보 수집 동의가 필요합니다."),
    BATCH_HASH_CONFLICT(HttpStatus.CONFLICT, "BATCH_HASH_CONFLICT", "같은 배치 ID로 다른 내용이 이미 저장되었습니다."),
    INVALID_SESSION_STATE(HttpStatus.CONFLICT, "INVALID_SESSION_STATE", "현재 세션 상태에서 처리할 수 없습니다."),
    BATCH_SESSION_FORBIDDEN(HttpStatus.FORBIDDEN, "SESSION_FORBIDDEN", "본인 러닝 세션과 기기 관계가 맞지 않습니다."),
    BATCH_CONTROL_DEVICE_CHANGED(
            HttpStatus.CONFLICT, "CONTROL_DEVICE_CHANGED", "기록 제어 기기가 변경되었습니다."),
    DEVICE_FORBIDDEN(HttpStatus.FORBIDDEN, "DEVICE_FORBIDDEN", "본인 등록 기기가 아닙니다."),
    UNSUPPORTED_RECORD_TYPE(
            HttpStatus.UNPROCESSABLE_CONTENT, "UNSUPPORTED_RECORD_TYPE", "지원하지 않는 건강 데이터 출처입니다."),
    GOAL_CALCULATED_DURATION_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "계산된 목표 시간이 유효하지 않습니다."),
    GOAL_PACE_DURATION_CONFLICT(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_GOAL",
            "PACE 목표에는 targetDurationSec을 함께 보낼 수 없습니다."),
    GOAL_PACE_REQUIRED(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_GOAL",
            "PACE 목표는 양수 targetPaceSecPerKm이 필요합니다."),
    GOAL_CALCULATED_PACE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "계산된 목표 페이스가 유효하지 않습니다."),
    GOAL_TIME_PACE_CONFLICT(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_GOAL",
            "TIME 목표에는 targetPaceSecPerKm을 함께 보낼 수 없습니다."),
    GOAL_DURATION_REQUIRED(
            HttpStatus.UNPROCESSABLE_CONTENT,
            "INVALID_GOAL",
            "TIME 목표는 양수 targetDurationSec이 필요합니다."),
    GOAL_DISTANCE_INVALID(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "목표 거리는 양수여야 합니다."),
    GOAL_INPUT_TYPE_INVALID(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "goalInputType은 TIME 또는 PACE여야 합니다."),
    GOAL_INPUT_TYPE_REQUIRED(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "목표 필드가 있으면 goalInputType이 필요합니다."),
    INVALID_FILTER_GROUPRUN_INVALID_CURSOR(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "cursor가 올바르지 않습니다."),
    INVALID_FILTER_GROUPRUN_RESOLVE_LIMIT(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "limit은 1 이상 {0} 이하여야 합니다."),
    GROUP_GEO_COORDINATES_INVALID(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "위도·경도 값이 올바르지 않습니다."),
    GROUP_GEO_RADIUS_INVALID(HttpStatus.BAD_REQUEST, "INVALID_FILTER", "radiusM은 양수여야 합니다."),
    GROUP_GEO_FILTER_INCOMPLETE(
            HttpStatus.BAD_REQUEST,
            "INVALID_FILTER",
            "근처 검색은 latitude, longitude, radiusM을 모두 지정해야 합니다."),
    INVALID_FILTER_GROUPRUN_NORMALIZE_PARTICIPATION(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "participation은 ME 또는 NONE만 허용됩니다."),
    INVALID_FILTER_GROUPRUN_NORMALIZE_STATUS_FILTER(
            HttpStatus.BAD_REQUEST,
            "INVALID_FILTER",
            "status는 SCHEDULED, RUNNING, COMPLETED, CANCELLED만 허용됩니다."),
    INVALID_GOAL_GROUPRUN_REJECT_PARTIAL_GOAL_NULL_RELEASE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "부분 목표 해제는 지원하지 않습니다."),
    GROUP_MEETING_POSITION_ERROR(
            HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "모임 위치를 읽을 수 없습니다."),
    GROUP_NOT_FOUND(HttpStatus.NOT_FOUND, "GROUP_NOT_FOUND", "그룹런을 찾을 수 없습니다."),
    COURSE_INACCESSIBLE(HttpStatus.FORBIDDEN, "COURSE_INACCESSIBLE", "사용할 수 없는 코스입니다."),
    CREW_FORBIDDEN(HttpStatus.FORBIDDEN, "CREW_FORBIDDEN", "크루 멤버만 이용할 수 있습니다."),
    CREW_FORBIDDEN_GROUPRUN_REQUIRE_APPROVED_ACTIVE_CREW_MEMBER(
            HttpStatus.FORBIDDEN, "CREW_FORBIDDEN", "활성 크루의 멤버만 이용할 수 있습니다."),
    NOT_PARTICIPANT(HttpStatus.FORBIDDEN, "NOT_PARTICIPANT", "참가하지 않은 그룹런입니다."),
    INVALID_GROUP_STATE(HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "출발 전 대기방에서만 준비를 변경할 수 있습니다."),
    INVALID_GROUP_STATE_GROUPRUN_LEAVE(
            HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "그룹장은 참가 취소 대신 그룹런 취소를 사용해야 합니다."),
    RUN_ALREADY_STARTED(HttpStatus.CONFLICT, "RUN_ALREADY_STARTED", "출발 전에만 참가를 취소할 수 있습니다."),
    FULL_OR_ALREADY_JOINED(HttpStatus.CONFLICT, "FULL_OR_ALREADY_JOINED", "이미 참가한 그룹런입니다."),
    INVALID_GROUP_STATE_GROUPRUN_JOIN(
            HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "모집 중인 그룹런에만 참가할 수 있습니다."),
    EDIT_NOT_ALLOWED(HttpStatus.CONFLICT, "EDIT_NOT_ALLOWED", "출발 전 그룹런만 수정할 수 있습니다."),
    NOT_HOST(HttpStatus.FORBIDDEN, "NOT_HOST", "그룹장만 수정할 수 있습니다."),
    NOT_HOST_GROUPRUN_START(HttpStatus.FORBIDDEN, "NOT_HOST", "그룹장만 그룹런을 시작할 수 있습니다."),
    NOT_HOST_GROUPRUN_CANCEL(HttpStatus.FORBIDDEN, "NOT_HOST", "그룹장만 그룹런을 취소할 수 있습니다."),
    INVALID_GROUP_STATE_GROUPRUN_START(
            HttpStatus.CONFLICT,
            "INVALID_GROUP_STATE",
            "출발 전 대기방이며 시작할 준비 세션이 있는 그룹런만 시작할 수 있습니다."),
    NOT_HOST_GROUPRUN_FORCE_FINISH(
            HttpStatus.FORBIDDEN, "NOT_HOST", "그룹장만 그룹런을 강제 종료할 수 있습니다."),
    INVALID_GROUP_STATE_GROUPRUN_FORCE_FINISH(
            HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "진행 중인 그룹런만 강제 종료할 수 있습니다."),
    INVALID_GROUP_STATE_GROUPRUN_CANCEL(
            HttpStatus.CONFLICT, "INVALID_GROUP_STATE", "출발 전 그룹런만 취소할 수 있습니다."),
    VALIDATION_ERROR_GROUPRUN_CANCEL_REASON(
            HttpStatus.BAD_REQUEST,
            "VALIDATION_ERROR",
            "cancelReason은 WEATHER, PERSONAL, LACK_OF_PARTICIPANTS, LOCATION_ISSUE, OTHER 중 하나여야 합니다."),
    ASSESSMENT_NOT_FOUND(HttpStatus.NOT_FOUND, "ASSESSMENT_NOT_FOUND", "준비도 결과가 없습니다."),
    RECORD_NOT_FOUND(HttpStatus.NOT_FOUND, "RECORD_NOT_FOUND", "러닝 기록을 찾을 수 없습니다."),
    RECORD_NOT_OWNER(HttpStatus.FORBIDDEN, "NOT_OWNER", "본인 러닝 기록만 조회할 수 있습니다."),
    INVALID_FILTER_RUNNINGRECORD_PARSE_SORT(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "sort는 LATEST, DISTANCE, PACE만 허용됩니다."),
    INVALID_FILTER_RUNNINGRECORD_PARSE_RUN_TYPE(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "runType은 ALL, SOLO, GROUP만 허용됩니다."),
    VALIDATION_ERROR_RUNNINGRECORD_PARSE_INSTANT_PARAM(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "{0}은 ISO-8601 Instant 형식이어야 합니다."),
    VALIDATION_ERROR_RUNNINGRECORD_RESOLVE_PACE_TREND_MONTHS(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "months는 1 이상 {0} 이하여야 합니다."),
    INVALID_PERIOD(HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "baseDate는 YYYY-MM-DD 형식이어야 합니다."),
    INVALID_PERIOD_RUNNINGRECORD_PARSE_PERIOD(
            HttpStatus.BAD_REQUEST, "INVALID_PERIOD", "period는 WEEK, MONTH, YEAR만 허용됩니다."),
    INVALID_FILTER_RUNNINGRECORD_LIST(
            HttpStatus.BAD_REQUEST, "INVALID_FILTER", "from은 to보다 이전이어야 합니다."),
    INVALID_GOAL(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_GOAL", "러닝 목표가 유효하지 않습니다."),
    COMMAND_PENDING(HttpStatus.CONFLICT, "COMMAND_PENDING", "처리 중인 제어 명령이 있습니다."),
    STALE_STATE(HttpStatus.CONFLICT, "STALE_STATE", "세션 상태가 변경되었습니다. 다시 조회해 주세요."),
    COMMAND_CONFLICT(HttpStatus.CONFLICT, "COMMAND_CONFLICT", "같은 제어 요청에 다른 내용이 이미 처리되었습니다."),
    UPLOAD_PENDING(HttpStatus.CONFLICT, "UPLOAD_PENDING", "수신한 워치 기록의 저장을 확인하지 못했습니다."),
    VALIDATION_ERROR_SESSION_REPORT(
            HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "실제 종료시각은 실제 시작시각보다 늦어야 합니다."),
    CONTROL_DEVICE_CHANGED(
            HttpStatus.CONFLICT, "CONTROL_DEVICE_CHANGED", "현재 제어 기기가 바뀌어 결과를 저장할 수 없습니다."),
    COMMAND_NOT_FOUND(HttpStatus.NOT_FOUND, "COMMAND_NOT_FOUND", "제어 명령을 찾을 수 없습니다."),
    COACHING_UNAVAILABLE(
            HttpStatus.CONFLICT, "COACHING_UNAVAILABLE", "폰으로 기록을 전환한 운동은 BPM을 바꿀 수 없습니다."),
    INVALID_COMPARISON_SESSION(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_COMPARISON_SESSION", "비교할 수 없는 러닝 기록입니다."),
    INTERNAL_ERROR(HttpStatus.INTERNAL_SERVER_ERROR, "INTERNAL_ERROR", "서버 오류가 발생했습니다."),
    SESSION_FORBIDDEN(HttpStatus.FORBIDDEN, "SESSION_FORBIDDEN", "본인 러닝 세션이 아닙니다."),
    SESSION_NOT_FOUND(HttpStatus.NOT_FOUND, "SESSION_NOT_FOUND", "러닝 세션을 찾을 수 없습니다."),
    ACTIVE_SESSION_EXISTS(HttpStatus.CONFLICT, "ACTIVE_SESSION_EXISTS", "진행 중인 러닝 세션이 있습니다."),
    SESSION_CANCEL_FORBIDDEN(HttpStatus.FORBIDDEN, "FORBIDDEN", "본인 러닝 세션이 아닙니다."),
    SESSION_DELETE_NOT_OWNER(HttpStatus.FORBIDDEN, "NOT_OWNER", "본인 러닝 기록이 아닙니다."),
    INVALID_RUNNING_BASELINE(
            HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_RUNNING_BASELINE", "평소 러닝 정보를 확인해 주세요."),
    PROFILE_NOT_SET(HttpStatus.NOT_FOUND, "PROFILE_NOT_SET", "러닝 초기 설정이 필요합니다."),
    INVALID_LEVEL(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_LEVEL", "러닝 수준을 확인해 주세요."),
    INVALID_IMAGE(HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_IMAGE", "프로필 이미지로 사용할 수 없습니다."),
    UNSUPPORTED_MEDIA_TYPE(
            HttpStatus.UNSUPPORTED_MEDIA_TYPE, "UNSUPPORTED_MEDIA_TYPE", "지원하지 않는 콘텐츠 형식입니다."),
    METHOD_NOT_ALLOWED(HttpStatus.METHOD_NOT_ALLOWED, "METHOD_NOT_ALLOWED", "허용되지 않는 메서드입니다."),
    NOT_FOUND(HttpStatus.NOT_FOUND, "NOT_FOUND", "요청한 리소스를 찾을 수 없습니다."),
    FORBIDDEN(HttpStatus.FORBIDDEN, "FORBIDDEN", "접근 권한이 없습니다.");

    private final HttpStatus status;
    private final String code;
    private final String message;

    ErrorCode(HttpStatus status, String code, String message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }

    public HttpStatus status() {
        return status;
    }

    public String code() {
        return code;
    }

    public String message() {
        return message(new String[0]);
    }

    /** 인자는 정해진 메시지의 자리만 채운다. 내부 작업명·필드명·상한과 기존 응답의 비민감 코드값만 허용한다. 개인정보·인증정보·예외 원문을 넣지 않는다. */
    public String message(String... arguments) {
        int expected = 0;
        while (message.contains("{" + expected + "}")) expected++;
        if (arguments.length != expected)
            throw new IllegalArgumentException("오류 메시지 인자 수가 맞지 않습니다.");
        return java.util.regex.Pattern.compile("\\{(\\d+)\\}")
                .matcher(message)
                .replaceAll(
                        match ->
                                java.util.regex.Matcher.quoteReplacement(
                                        java.util.Objects.requireNonNull(
                                                arguments[Integer.parseInt(match.group(1))])));
    }
}
