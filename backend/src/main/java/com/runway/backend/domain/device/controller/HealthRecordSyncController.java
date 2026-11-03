package com.runway.backend.domain.device.controller;

import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse;
import com.runway.backend.domain.device.service.HealthRecordSyncService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.AuthenticatedUser;

import jakarta.servlet.http.HttpServletRequest;

import lombok.RequiredArgsConstructor;

import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

import java.io.IOException;
import java.io.InputStream;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;

/** W06 Samsung Health 데이터 동기화. 폰이 본인 로그인으로 워치 일상 심박 하루 추정값을 올린다. */
@RestController
@RequestMapping("/api/v1/health-records/sync")
@RequiredArgsConstructor
public class HealthRecordSyncController {

    /** W06 본문 상한 32 KiB. Content-Length만 믿지 않고 실제로 읽은 바이트로 판정한다. */
    static final int MAX_BODY_BYTES = 32 * 1024;

    private final HealthRecordSyncService healthRecordSyncService;
    private final Clock clock;

    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    public HealthRecordSyncResponse sync(
            @AuthenticationPrincipal AuthenticatedUser user, HttpServletRequest request)
            throws IOException {
        long userId = CurrentUserIdResolver.requireUserId(user);
        LocalDate today = LocalDate.now(clock.withZone(ZoneOffset.UTC));
        HealthRecordSyncRequest records = HealthRecordSyncRequest.parse(readBody(request), today);
        return healthRecordSyncService.sync(userId, records);
    }

    static byte[] readBody(HttpServletRequest request) throws IOException {
        if (request.getContentLengthLong() > MAX_BODY_BYTES) {
            throw new ApiException(ErrorCode.FILE_TOO_LARGE);
        }
        try (InputStream in = request.getInputStream()) {
            byte[] body = in.readNBytes(MAX_BODY_BYTES + 1);
            if (body.length > MAX_BODY_BYTES) {
                throw new ApiException(ErrorCode.FILE_TOO_LARGE);
            }
            return body;
        }
    }
}
