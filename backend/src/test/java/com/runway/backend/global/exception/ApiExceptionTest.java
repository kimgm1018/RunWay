package com.runway.backend.global.exception;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

class ApiExceptionTest {
    @Test
    void detailsAreCopiedAndNullEntriesAreOmitted() {
        Map<String, Object> details = new HashMap<>();
        details.put("sessionId", 17L);
        details.put("missing", null);
        details.put(null, "omitted");
        ApiException exception = new ApiException(ErrorCode.ACTIVE_SESSION_EXISTS, details);
        details.put("sessionId", 99L);
        assertThat(exception.details()).containsExactlyEntriesOf(Map.of("sessionId", 17L));
        assertThatThrownBy(() -> exception.details().put("other", 1))
                .isInstanceOf(UnsupportedOperationException.class);
        ApiErrorResponse response = ApiErrorResponse.of(exception);
        assertThat(response.code()).isEqualTo("ACTIVE_SESSION_EXISTS");
        assertThat(response.message()).isEqualTo("진행 중인 러닝 세션이 있습니다.");
        assertThat(response.details()).containsExactlyEntriesOf(Map.of("sessionId", 17L));
    }

    @Test
    void fieldDetailsAndEmptyAuthenticationDetailsKeepTheirShape() {
        Map<String, Object> fields =
                Map.of("fields", List.of(Map.of("name", "provider", "reason", "지원하지 않는 값입니다.")));
        assertThat(
                        ApiErrorResponse.of(
                                        new ApiException(ErrorCode.UNSUPPORTED_RECORD_TYPE, fields))
                                .details())
                .isEqualTo(fields);
        assertThat(ApiErrorResponse.of(ErrorCode.UNAUTHORIZED, null).details()).isEmpty();
        assertThat(new ApiException(ErrorCode.UNAUTHORIZED).details()).isEmpty();
        assertThat(new ApiErrorResponse("SESSION_NOT_FOUND", null, null).message())
                .isEqualTo("요청을 처리할 수 없습니다.");
    }

    @Test
    void exceptionResponseKeepsTheResolvedTemplateMessage() {
        ApiException exception = new ApiException(ErrorCode.VALIDATION_LIMIT_OUT_OF_RANGE, "100");
        assertThat(ApiErrorResponse.of(exception).message()).isEqualTo("limit은 1 이상 100 이하여야 합니다.");
    }
}
