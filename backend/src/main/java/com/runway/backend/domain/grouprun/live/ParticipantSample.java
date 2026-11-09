package com.runway.backend.domain.grouprun.live;

import java.time.Instant;
import java.util.List;

/**
 * 순위 계산 입력. DB 접근 없이 호출자가 채운다.
 *
 * <p>{@code measuredAt}은 누적 거리 표본의 시각, {@code lastSampleAt}은 종류와 무관한 세션의 최신 측정 표본 시각이다. 워치는
 * 거리가 바뀔 때만 누적 거리를 보내므로 멈춰 있으면 거리 표본은 끊기고 심박 등 다른 표본만 이어진다. 신선도는 {@code lastSampleAt}으로
 * 판단한다.
 */
public record ParticipantSample(
    long userId,
    boolean eligibleSession, // started && sessionStatus RUNNING
    Double totalDistanceM,
    Instant measuredAt,
    List<GeoPoint> track, // 비어 있을 수 있음. 시간순, lon/lat
    Instant lastSampleAt // 종류 무관 최신 측정 표본 시각. 신선도는 measuredAt과 둘 중 늦은 시각으로 판단
    ) {

  /** 거리 표본 시각을 신선도 기준으로도 쓰는 입력. */
  public ParticipantSample(
      long userId,
      boolean eligibleSession,
      Double totalDistanceM,
      Instant measuredAt,
      List<GeoPoint> track) {
    this(userId, eligibleSession, totalDistanceM, measuredAt, track, measuredAt);
  }

  /** 신선도 판단과 응답 measuredAt에 쓰는 시각. 최신 측정 표본 시각이 없으면 거리 표본 시각. */
  public Instant freshnessAt() {
    if (lastSampleAt == null) {
      return measuredAt;
    }
    if (measuredAt == null) {
      return lastSampleAt;
    }
    return lastSampleAt.isAfter(measuredAt) ? lastSampleAt : measuredAt;
  }
}
