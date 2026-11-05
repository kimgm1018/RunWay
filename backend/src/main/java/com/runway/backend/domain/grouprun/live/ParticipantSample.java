package com.runway.backend.domain.grouprun.live;

import java.time.Instant;
import java.util.List;

/** 순위 계산 입력. DB 접근 없이 호출자가 채운다. */
public record ParticipantSample(
    long userId,
    boolean eligibleSession, // started && sessionStatus RUNNING
    Double totalDistanceM,
    Instant measuredAt,
    List<GeoPoint> track // 비어 있을 수 있음. 시간순, lon/lat
    ) {}

