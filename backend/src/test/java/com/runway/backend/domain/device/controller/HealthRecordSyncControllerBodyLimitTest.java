package com.runway.backend.domain.device.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.global.exception.ApiException;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;

/** W06 AC-11. Content-Length가 없거나 거짓이어도 실제로 읽은 바이트로 32 KiB 상한을 판정한다. */
class HealthRecordSyncControllerBodyLimitTest {

    private static MockHttpServletRequest unknownLength(int bytes) {
        MockHttpServletRequest request =
                new MockHttpServletRequest() {
                    @Override
                    public long getContentLengthLong() {
                        return -1;
                    }

                    @Override
                    public int getContentLength() {
                        return -1;
                    }
                };
        request.setContent(new byte[bytes]);
        return request;
    }

    @Test
    void 길이를_모르는_요청도_32KiB를_넘으면_413() {
        assertThatThrownBy(
                        () ->
                                HealthRecordSyncController.readBody(
                                        unknownLength(HealthRecordSyncController.MAX_BODY_BYTES + 1)))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.code()).isEqualTo("FILE_TOO_LARGE"));
    }

    @Test
    void 길이를_모르는_요청의_32KiB_본문은_그대로_읽는다() throws Exception {
        assertThat(
                        HealthRecordSyncController.readBody(
                                unknownLength(HealthRecordSyncController.MAX_BODY_BYTES)))
                .hasSize(HealthRecordSyncController.MAX_BODY_BYTES);
    }

    @Test
    void Content_Length가_상한을_넘으면_읽기_전에_413() {
        MockHttpServletRequest declared =
                new MockHttpServletRequest() {
                    @Override
                    public long getContentLengthLong() {
                        return 40_000;
                    }
                };
        assertThatThrownBy(() -> HealthRecordSyncController.readBody(declared))
                .isInstanceOfSatisfying(
                        ApiException.class, e -> assertThat(e.code()).isEqualTo("FILE_TOO_LARGE"));
    }
}
