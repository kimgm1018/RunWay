package com.runway.backend.domain.grouprun.entity;

/** G13 취소 사유. {@code group_runs.cancel_reason}에 이름 그대로 저장한다. */
public enum GroupRunCancelReason {
    WEATHER,
    PERSONAL,
    LACK_OF_PARTICIPANTS,
    LOCATION_ISSUE,
    OTHER
}
