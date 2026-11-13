package com.runway.backend.domain.grouprun;

import java.time.LocalTime;
import java.time.ZoneId;
import java.time.ZonedDateTime;

/** 그룹런 출발 시각은 지금 이후 13일 안, 한국 시간 05:00~22:00만 받는다(S15P31E105-779). 테스트는 내일 10:00(KST)을 쓴다. */
final class GroupRunTestTimes {

    static final ZoneId KST = ZoneId.of("Asia/Seoul");

    private GroupRunTestTimes() {}

    static String validScheduledAt() {
        return atKst(1, LocalTime.of(10, 0));
    }

    static String atKst(int daysFromToday, LocalTime time) {
        return ZonedDateTime.now(KST)
                .toLocalDate()
                .plusDays(daysFromToday)
                .atTime(time)
                .atZone(KST)
                .toInstant()
                .toString();
    }
}
