package com.runway.backend.domain.session.dto;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.session.dto.request.SessionControlRequest;
import com.runway.backend.domain.session.dto.request.SessionControlRequest.Phase;
import com.runway.backend.domain.session.entity.ControlAction;
import com.runway.backend.domain.session.entity.ControlResult;
import com.runway.backend.global.exception.ApiException;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** S03~S06 본문 단계별 검증 — 작업 계획 AC-A4의 400 VALIDATION_ERROR. */
class SessionControlRequestTest {

    private static final String RESULT_APPLIED =
            "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\","
                    + "\"appliedAt\":\"2026-10-28T01:00:01Z\",\"reasonCode\":null}";

    @Test
    void REQUEST_정상() {
        SessionControlRequest request =
                SessionControlRequest.fromJson(
                        "{\"phase\":\"REQUEST\",\"deviceId\":101,\"expectedVersion\":1}",
                        ControlAction.START);

        assertThat(request.phase()).isEqualTo(Phase.REQUEST);
        assertThat(request.deviceId()).isEqualTo(101L);
        assertThat(request.expectedVersion()).isEqualTo(1L);
        assertThat(request.commandId()).isNull();
        assertThat(request.result()).isNull();
    }

    @Test
    void RESULT_APPLIED_정상() {
        SessionControlRequest request = SessionControlRequest.fromJson(RESULT_APPLIED, ControlAction.START);

        assertThat(request.phase()).isEqualTo(Phase.RESULT);
        assertThat(request.commandId()).isEqualTo(501L);
        assertThat(request.result()).isEqualTo(ControlResult.APPLIED);
        assertThat(request.appliedAt()).isEqualTo(Instant.parse("2026-10-28T01:00:01Z"));
        assertThat(request.reasonCode()).isNull();
        assertThat(request.expectedVersion()).isNull();
    }

    @Test
    void RESULT_REJECTED는_사유를_받는다() {
        SessionControlRequest request =
                SessionControlRequest.fromJson(
                        "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"REJECTED\","
                                + "\"appliedAt\":null,\"reasonCode\":\"VERSION_MISMATCH\"}",
                        ControlAction.PAUSE);

        assertThat(request.result()).isEqualTo(ControlResult.REJECTED);
        assertThat(request.appliedAt()).isNull();
        assertThat(request.reasonCode()).isEqualTo("VERSION_MISMATCH");
    }

    @Test
    void appliedAt_나노초는_마이크로초로_자른다() {
        SessionControlRequest request =
                SessionControlRequest.fromJson(
                        RESULT_APPLIED.replace("01:00:01Z", "01:00:01.1234567Z"), ControlAction.START);

        assertThat(request.appliedAt()).isEqualTo(Instant.parse("2026-10-28T01:00:01.123456Z"));
    }

    @Test
    void END_RESULT는_uploadComplete를_받는다() {
        String body = RESULT_APPLIED.replace("}", ",\"uploadComplete\":true}");

        assertThat(SessionControlRequest.fromJson(body, ControlAction.END).uploadComplete()).isTrue();
        assertThat(SessionControlRequest.fromJson(RESULT_APPLIED, ControlAction.END).uploadComplete())
                .isNull();
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                // REQUEST에 RESULT 전용 필드
                "{\"phase\":\"REQUEST\",\"deviceId\":101,\"expectedVersion\":1,\"commandId\":5}",
                // REQUEST에 expectedVersion 누락
                "{\"phase\":\"REQUEST\",\"deviceId\":101}",
                // 문자열 버전
                "{\"phase\":\"REQUEST\",\"deviceId\":101,\"expectedVersion\":\"1\"}",
                // deviceId 0
                "{\"phase\":\"REQUEST\",\"deviceId\":0,\"expectedVersion\":1}",
                // phase 누락·잘못된 값
                "{\"deviceId\":101,\"expectedVersion\":1}",
                "{\"phase\":\"APPLY\",\"deviceId\":101,\"expectedVersion\":1}",
                // RESULT의 appliedAt 키 누락
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\",\"reasonCode\":null}",
                // RESULT의 reasonCode 키 누락
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\",\"appliedAt\":\"2026-10-28T01:00:01Z\"}",
                // APPLIED인데 appliedAt null
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\",\"appliedAt\":null,\"reasonCode\":null}",
                // REJECTED인데 appliedAt 값
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"REJECTED\",\"appliedAt\":\"2026-10-28T01:00:01Z\",\"reasonCode\":null}",
                // 보고하지 않는 결과
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"PENDING\",\"appliedAt\":null,\"reasonCode\":null}",
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"IGNORED\",\"appliedAt\":null,\"reasonCode\":null}",
                // UTC가 아닌 오프셋
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\",\"appliedAt\":\"2026-10-28T10:00:01+09:00\",\"reasonCode\":null}",
                // 형식이 아닌 시각
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"APPLIED\",\"appliedAt\":\"yesterday\",\"reasonCode\":null}",
                // RESULT에 expectedVersion
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"expectedVersion\":1,\"result\":\"UNKNOWN\",\"appliedAt\":null,\"reasonCode\":null}",
                // RESULT에 commandId 누락
                "{\"phase\":\"RESULT\",\"deviceId\":101,\"result\":\"UNKNOWN\",\"appliedAt\":null,\"reasonCode\":null}",
                // 빈 사유
                "{\"phase\":\"RESULT\",\"commandId\":501,\"deviceId\":101,\"result\":\"UNKNOWN\",\"appliedAt\":null,\"reasonCode\":\"\"}",
                // 객체가 아닌 본문
                "[]",
                "not json"
            })
    void 단계별_필드_오류는_VALIDATION_ERROR(String body) {
        assertThatThrownBy(() -> SessionControlRequest.fromJson(body, ControlAction.START))
                .isInstanceOf(ApiException.class)
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    /** B-2: DB가 저장할 수 없는 연도는 500이 아니라 400이어야 한다. */
    @ParameterizedTest
    @ValueSource(strings = {"+999999-01-01T00:00:00Z", "-5000-01-01T00:00:00Z", "1999-12-31T23:59:59Z"})
    void 허용_범위_밖의_적용시각은_VALIDATION_ERROR(String appliedAt) {
        String body = RESULT_APPLIED.replace("2026-10-28T01:00:01Z", appliedAt);

        assertThatThrownBy(() -> SessionControlRequest.fromJson(body, ControlAction.START))
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void END가_아닌_RESULT의_uploadComplete는_거절() {
        String body = RESULT_APPLIED.replace("}", ",\"uploadComplete\":true}");

        assertThatThrownBy(() -> SessionControlRequest.fromJson(body, ControlAction.PAUSE))
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void REQUEST의_uploadComplete는_END여도_거절() {
        assertThatThrownBy(
                        () ->
                                SessionControlRequest.fromJson(
                                        "{\"phase\":\"REQUEST\",\"deviceId\":101,\"expectedVersion\":1,"
                                                + "\"uploadComplete\":true}",
                                        ControlAction.END))
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("VALIDATION_ERROR");
    }

    @Test
    void uploadComplete가_boolean이_아니면_거절() {
        String body = RESULT_APPLIED.replace("}", ",\"uploadComplete\":\"true\"}");

        assertThatThrownBy(() -> SessionControlRequest.fromJson(body, ControlAction.END))
                .extracting(e -> ((ApiException) e).code())
                .isEqualTo("VALIDATION_ERROR");
    }
}
