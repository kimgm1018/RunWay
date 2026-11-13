package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/**
 * 그룹런 출발 시각 범위(S15P31E105-779). 앱 그룹런 만들기(6.8)와 같다: 지금 이후, 한국 날짜로 오늘부터 13일 뒤까지, 한국 시간
 * 05:00~22:00. 앱은 30분 단위로만 고르게 하지만 서버는 분 단위를 강제하지 않는다.
 */
public final class GroupRunSchedulePolicy {

    public static final ZoneId KST = ZoneId.of("Asia/Seoul");
    public static final int MAX_DAYS_AHEAD = 13;
    public static final LocalTime EARLIEST = LocalTime.of(5, 0);
    public static final LocalTime LATEST = LocalTime.of(22, 0);

    private GroupRunSchedulePolicy() {}

    public static Instant requireWithinWindow(Instant scheduledAt, Clock clock) {
        Instant now = clock.instant();
        ZonedDateTime local = scheduledAt.atZone(KST);
        LocalDate lastDay = now.atZone(KST).toLocalDate().plusDays(MAX_DAYS_AHEAD);
        LocalTime time = local.toLocalTime();
        if (!scheduledAt.isAfter(now)
                || local.toLocalDate().isAfter(lastDay)
                || time.isBefore(EARLIEST)
                || time.isAfter(LATEST)) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_GROUPRUN_SCHEDULE);
        }
        return scheduledAt;
    }
}
