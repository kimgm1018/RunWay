package com.runway.backend.domain.grouprun.live;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;

class GroupRunLiveRankingTest {

  private static final Instant NOW = Instant.parse("2026-11-05T03:00:00Z");

  private static ParticipantSample sample(long userId, Double d, long ageSeconds) {
    return new ParticipantSample(userId, true, d, NOW.minusSeconds(ageSeconds), List.of());
  }

  private static ParticipantLive byUser(List<ParticipantLive> result, long userId) {
    return result.stream().filter(p -> p.userId() == userId).findFirst().orElseThrow();
  }

  @Test
  void 빈_목록은_빈_결과() {
    assertThat(GroupRunLiveRanking.compute(NOW, true, 5000.0, List.of())).isEmpty();
    assertThat(GroupRunLiveRanking.compute(NOW, false, null, List.of())).isEmpty();
  }

  @Test
  void 코스_모드는_누적거리로_순위를_매긴다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            5000.0,
            List.of(sample(1, 1000.0, 5), sample(2, 1500.0, 5), sample(3, 500.0, 5)));

    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).rank()).isEqualTo(2);
    assertThat(byUser(result, 3).rank()).isEqualTo(3);
    assertThat(byUser(result, 1).aheadCount()).isEqualTo(1);
    assertThat(byUser(result, 1).behindCount()).isEqualTo(1);
    assertThat(byUser(result, 1).progressM()).isEqualTo(1000.0);
    assertThat(byUser(result, 1).gapToAheadM()).isCloseTo(500.0, within(1e-9));
    assertThat(byUser(result, 1).gapToBehindM()).isCloseTo(500.0, within(1e-9));
    assertThat(byUser(result, 2).gapToAheadM()).isNull();
    assertThat(byUser(result, 3).gapToBehindM()).isNull();
  }

  @Test
  void 코스_모드는_GPS_위치와_무관하게_누적거리만_쓴다() {
    // 사용자 1은 코스상 앞쪽 좌표에 있지만 누적거리가 작다
    var far = List.of(new GeoPoint(127.0000, 37.0000), new GeoPoint(127.0100, 37.0000));
    var near = List.of(new GeoPoint(127.0000, 37.0000));
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            5000.0,
            List.of(
                new ParticipantSample(1, true, 800.0, NOW.minusSeconds(1), far),
                new ParticipantSample(2, true, 900.0, NOW.minusSeconds(1), near)));

    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).rank()).isEqualTo(2);
  }

  @Test
  void 자유_모드는_리더_궤적이_부족하면_누적거리로_순위를_매긴다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW, false, null, List.of(sample(1, 300.0, 3), sample(2, 700.0, 3), sample(3, 100.0, 3)));

    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).rank()).isEqualTo(2);
    assertThat(byUser(result, 3).rank()).isEqualTo(3);
    assertThat(byUser(result, 1).gapToAheadM()).isCloseTo(400.0, within(1e-9));
  }

  @Test
  void 자유_모드는_리더_궤적_위_투영으로_진행도를_구한다() {
    // 위도 0, 경도 0~0.01 직선 (약 1112m). 리더 d = 1000m
    var leaderTrack = List.of(new GeoPoint(0.0, 0.0), new GeoPoint(0.005, 0.0), new GeoPoint(0.01, 0.0));
    // 사용자 2는 궤적 중간 근처, d는 리더보다 작다
    var midTrack = List.of(new GeoPoint(0.005, 0.0001));
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            false,
            null,
            List.of(
                new ParticipantSample(1, true, 1000.0, NOW.minusSeconds(1), leaderTrack),
                new ParticipantSample(2, true, 900.0, NOW.minusSeconds(1), midTrack)));

    assertThat(byUser(result, 1).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).progressM()).isEqualTo(1000.0);
    assertThat(byUser(result, 2).rank()).isEqualTo(2);
    // 중간 지점 ≈ 리더 d의 절반
    assertThat(byUser(result, 2).progressM()).isCloseTo(500.0, within(5.0));
    assertThat(byUser(result, 2).gapToAheadM()).isCloseTo(500.0, within(5.0));
  }

  @Test
  void 동일_진행도는_동순위이고_앞뒤_인원에서_제외된다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            null,
            List.of(
                sample(1, 1000.0, 2),
                sample(2, 1000.5, 2), // 1.0m 이내 → 동순위
                sample(3, 1500.0, 2),
                sample(4, 400.0, 2)));

    ParticipantLive u1 = byUser(result, 1);
    ParticipantLive u2 = byUser(result, 2);
    assertThat(u1.rank()).isEqualTo(2);
    assertThat(u2.rank()).isEqualTo(2);
    assertThat(u1.aheadCount()).isEqualTo(1);
    assertThat(u1.behindCount()).isEqualTo(1);
    assertThat(u2.aheadCount()).isEqualTo(1);
    assertThat(u2.behindCount()).isEqualTo(1);
    // 격차는 인접 다른 군집의 최근접 진행도까지
    assertThat(u1.gapToAheadM()).isCloseTo(500.0, within(1e-9));
    assertThat(u1.gapToBehindM()).isCloseTo(600.0, within(1e-9));
    assertThat(byUser(result, 4).rank()).isEqualTo(4);
  }

  @Test
  void 인접_1m_이내_사슬은_같은_동률_군집이다() {
    // 쌍별로는 100과 101.6이 1.6m지만, 인접 사슬(0.8+0.8)로 한 군집
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            null,
            List.of(sample(1, 100.0, 2), sample(2, 100.8, 2), sample(3, 101.6, 2)));

    assertThat(byUser(result, 1).rank()).isEqualTo(1);
    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 3).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).aheadCount()).isZero();
    assertThat(byUser(result, 1).behindCount()).isZero();
    assertThat(byUser(result, 1).gapToAheadM()).isNull();
    assertThat(byUser(result, 1).gapToBehindM()).isNull();
  }

  @Test
  void 정확히_1m_차이는_동률이고_1m_초과는_앞뒤다() {
    var tied =
        GroupRunLiveRanking.compute(
            NOW, true, null, List.of(sample(1, 100.0, 2), sample(2, 101.0, 2)));
    assertThat(byUser(tied, 1).rank()).isEqualTo(1);
    assertThat(byUser(tied, 2).rank()).isEqualTo(1);

    var split =
        GroupRunLiveRanking.compute(
            NOW, true, null, List.of(sample(1, 100.0, 2), sample(2, 101.0001, 2)));
    assertThat(byUser(split, 2).rank()).isEqualTo(1);
    assertThat(byUser(split, 1).rank()).isEqualTo(2);
  }

  @Test
  void 미래_시각_표본은_순위에서_제외되고_stale이다() {
    var future =
        new ParticipantSample(
            1, true, 99999.0, NOW.plusSeconds(300), List.of());
    var normal = sample(2, 500.0, 2);
    var result = GroupRunLiveRanking.compute(NOW, true, null, List.of(future, normal));

    assertThat(byUser(result, 1).rank()).isNull();
    assertThat(byUser(result, 1).stale()).isTrue();
    assertThat(byUser(result, 1).measuredAt()).isEqualTo(NOW.plusSeconds(300));
    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 2).stale()).isFalse();
  }

  @Test
  void 허용_오차_이내_미래_시각은_유효하다() {
    var skewOk =
        new ParticipantSample(
            1,
            true,
            100.0,
            NOW.plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS),
            List.of());
    var result = GroupRunLiveRanking.compute(NOW, true, null, List.of(skewOk));
    assertThat(byUser(result, 1).rank()).isEqualTo(1);
    assertThat(byUser(result, 1).stale()).isFalse();
  }

  @Test
  void 허용_오차_직후_미래_시각은_제외된다() {
    var justOver =
        new ParticipantSample(
            1,
            true,
            100.0,
            NOW.plusSeconds(GroupRunLiveRanking.MEASURED_AT_FUTURE_SKEW_SECONDS + 1),
            List.of());
    var result = GroupRunLiveRanking.compute(NOW, true, null, List.of(justOver));
    assertThat(byUser(result, 1).rank()).isNull();
    assertThat(byUser(result, 1).stale()).isTrue();
  }

  @Test
  void TTL을_넘긴_참가자는_순위에서_제외되고_stale이다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            null,
            List.of(sample(1, 500.0, 10), sample(2, 9000.0, 61), sample(3, 300.0, 60)));

    ParticipantLive stale = byUser(result, 2);
    assertThat(stale.stale()).isTrue();
    assertThat(stale.rank()).isNull();
    assertThat(stale.aheadCount()).isNull();
    assertThat(stale.behindCount()).isNull();
    assertThat(stale.gapToAheadM()).isNull();
    assertThat(stale.gapToBehindM()).isNull();
    assertThat(stale.progressM()).isNull();
    assertThat(stale.measuredAt()).isEqualTo(NOW.minusSeconds(61));

    // 정확히 60초는 유효
    assertThat(byUser(result, 3).stale()).isFalse();
    assertThat(byUser(result, 1).rank()).isEqualTo(1);
    assertThat(byUser(result, 3).rank()).isEqualTo(2);
    assertThat(byUser(result, 1).aheadCount()).isZero();
  }

  @Test
  void 세션이_RUNNING이_아니면_순위가_없다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            true,
            null,
            List.of(
                new ParticipantSample(1, false, 800.0, NOW.minusSeconds(1), List.of()),
                sample(2, 100.0, 1)));

    assertThat(byUser(result, 1).rank()).isNull();
    assertThat(byUser(result, 1).stale()).isTrue();
    assertThat(byUser(result, 2).rank()).isEqualTo(1);
    assertThat(byUser(result, 2).aheadCount()).isZero();
    assertThat(byUser(result, 2).behindCount()).isZero();
  }

  @Test
  void GPS가_없으면_0을_만들지_않고_순위가_없다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW,
            false,
            null,
            List.of(
                new ParticipantSample(1, true, null, null, List.of()),
                new ParticipantSample(2, true, 100.0, null, List.of()),
                sample(3, 50.0, 1)));

    assertThat(byUser(result, 1).rank()).isNull();
    assertThat(byUser(result, 1).progressM()).isNull();
    assertThat(byUser(result, 2).rank()).isNull();
    assertThat(byUser(result, 3).rank()).isEqualTo(1);
  }

  @Test
  void 결과는_입력_순서를_유지한다() {
    var result =
        GroupRunLiveRanking.compute(
            NOW, true, null, List.of(sample(9, 1.0, 1), sample(3, 2.0, 1), sample(5, 3.0, 1)));

    assertThat(result).extracting(ParticipantLive::userId).containsExactly(9L, 3L, 5L);
  }
}
