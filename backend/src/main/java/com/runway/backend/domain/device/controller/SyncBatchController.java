package com.runway.backend.domain.device.controller;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import com.runway.backend.domain.device.dto.response.SyncBatchAckResponse;
import com.runway.backend.domain.device.service.BatchPayloadHasher;
import com.runway.backend.domain.device.service.SyncBatchErrors;
import com.runway.backend.domain.device.service.SyncBatchService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.io.InputStream;
import lombok.RequiredArgsConstructor;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** W07 워치 운동 배치 동기화. 폰이 본인 로그인으로 워치·폰 batch를 그대로 중계한다. */
@RestController
@RequestMapping("/api/v1/sync/batches")
@RequiredArgsConstructor
public class SyncBatchController {

    /** W07 본문 상한 32 KiB. Content-Length만 믿지 않고 실제로 읽은 바이트로 판정한다. */
    static final int MAX_BODY_BYTES = 32 * 1024;

    private final SyncBatchService syncBatchService;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public SyncBatchAckResponse sync(
            @AuthenticationPrincipal AuthenticatedUser user, HttpServletRequest request)
            throws IOException {
        long userId = CurrentUserIdResolver.requireUserId(user);
        SyncBatchRequest batch = SyncBatchRequest.parse(readBody(request));
        String hash = BatchPayloadHasher.verify(batch);
        return syncBatchService.commit(userId, batch, hash);
    }

    static byte[] readBody(HttpServletRequest request) throws IOException {
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            throw SyncBatchErrors.tooLarge();
        }
        try (InputStream in = request.getInputStream()) {
            byte[] body = in.readNBytes(MAX_BODY_BYTES + 1);
            if (body.length > MAX_BODY_BYTES) {
                throw SyncBatchErrors.tooLarge();
            }
            return body;
        }
    }
}
