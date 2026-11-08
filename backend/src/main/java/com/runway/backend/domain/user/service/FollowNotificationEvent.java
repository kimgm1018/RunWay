package com.runway.backend.domain.user.service;

/** 458 integration contract. Consume in the originating transaction and persist before delivery. */
public record FollowNotificationEvent(
        long requestId, long actorId, long recipientId, Kind kind) {
    public enum Kind { NEW_FOLLOWER, FOLLOW_REQUEST, FOLLOW_APPROVED }
}
