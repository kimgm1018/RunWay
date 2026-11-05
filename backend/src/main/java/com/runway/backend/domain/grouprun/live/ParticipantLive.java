package com.runway.backend.domain.grouprun.live;

import java.time.Instant;

/** 순위 계산 결과. 순위 대상이 아니면 rank·gap·progress는 null. */
public record ParticipantLive(
    long userId,
    Integer rank,
    Integer aheadCount,
    Integer behindCount,
    Double gapToAheadM,
    Double gapToBehindM,
    Double progressM,
    Instant measuredAt,
    boolean stale) {}

