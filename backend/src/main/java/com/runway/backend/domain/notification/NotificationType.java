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
    GROUP_RUN_START_REMINDER;

    /** follow/crew/comment → community; group-run cancel/reminder → groupRun. */
    public boolean usesCommunitySetting() {
        return switch (this) {
            case NEW_FOLLOWER, FOLLOW_REQUEST, FOLLOW_APPROVED, CREW_JOIN_APPROVED,
                    CREW_JOIN_REJECTED, CREW_JOIN_REQUESTED, POST_COMMENT -> true;
            case GROUP_RUN_PARTICIPATION_CANCELLED, GROUP_RUN_START_REMINDER -> false;
        };
    }
}
