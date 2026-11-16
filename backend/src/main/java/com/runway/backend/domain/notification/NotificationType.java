package com.runway.backend.domain.notification;

/** Inbox kind codes stored in notifications.notification_type (S15P31E105-458). */
public enum NotificationType {
    NEW_FOLLOWER,
    FOLLOW_REQUEST,
    FOLLOW_APPROVED,
    CREW_JOIN_APPROVED,
    CREW_JOIN_REJECTED,
    CREW_JOIN_REQUESTED,
    POST_COMMENT,
    GROUP_RUN_PARTICIPATION_CANCELLED,
    GROUP_RUN_START_REMINDER,
    /** 오늘 준비도 점수와 러닝 권유(S15P31E105-847). target_id는 daily_readiness.id. */
    READINESS_TODAY;

    /** follow/crew/comment → community; group-run cancel/reminder·오늘 준비도 → groupRun(설정 화면 이름 '러닝 알림'). */
    public boolean usesCommunitySetting() {
        return switch (this) {
            case NEW_FOLLOWER, FOLLOW_REQUEST, FOLLOW_APPROVED, CREW_JOIN_APPROVED,
                    CREW_JOIN_REJECTED, CREW_JOIN_REQUESTED, POST_COMMENT -> true;
            case GROUP_RUN_PARTICIPATION_CANCELLED, GROUP_RUN_START_REMINDER, READINESS_TODAY -> false;
        };
    }
}
