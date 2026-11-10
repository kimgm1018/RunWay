package com.runway.backend.domain.readiness.controller;

import com.runway.backend.domain.readiness.dto.response.ReadinessLatestResponse;
import com.runway.backend.domain.readiness.service.ReadinessQueryService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 운동 준비도(readiness.md). 평가는 W06 이후 서버가 자동으로 하며 공개 평가 요청 API는 없다. */
@RestController
@RequestMapping("/api/v1/readiness-assessments")
@RequiredArgsConstructor
public class ReadinessController {

    private final ReadinessQueryService readinessQueryService;

    /** R02 본인의 최신 준비도 조회. */
    @GetMapping("/latest")
    public ReadinessLatestResponse latest(@AuthenticationPrincipal AuthenticatedUser user) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return readinessQueryService.getLatest(userId);
    }

    /**
     * R03 본인의 지정 기준 날짜(YYYY-MM-DD) 준비도 조회(S15P31E105-660). 부호 없는 4자리 연도의 날짜만 받는다. ISO 날짜 변환은 시간대
     * 접미사(`2026-10-27+09:00`)와 부호 붙은 큰 연도(`+584556076-01-28`)도 받아들여, 후자는 DB 날짜 변환에서 넘쳐 다른 날짜를
     * 조회하거나 500이 되므로 직접 검사해 400 VALIDATION_ERROR로 거절한다(리뷰 A-1·A-2·B-1·B-2).
     */
    @GetMapping("/dates/{readinessDate}")
    public ReadinessLatestResponse byDate(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable String readinessDate) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return readinessQueryService.getByDate(userId, parseDate(readinessDate));
    }

    private static final Pattern DATE = Pattern.compile("\\d{4}-\\d{2}-\\d{2}");

    /** 형식(YYYY-MM-DD)과 달력(2월 30일 등)을 모두 검사한다. 거절 값은 응답에 넣지 않는다. */
    private static LocalDate parseDate(String value) {
        if (DATE.matcher(value).matches()) {
            try {
                return LocalDate.parse(value, DateTimeFormatter.ISO_LOCAL_DATE);
            } catch (DateTimeParseException ignored) {
                // 아래에서 형식 오류로 응답한다.
            }
        }
        throw new ApiException(
                ErrorCode.VALIDATION_ERROR,
                Map.of(
                        "fields",
                        List.of(Map.of("name", "readinessDate", "reason", "형식이 올바르지 않습니다."))));
    }
}
