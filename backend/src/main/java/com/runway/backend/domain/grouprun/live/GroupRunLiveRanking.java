package com.runway.backend.domain.grouprun.live;

import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * 그룹런 실시간 순위 계산기(G10). DB 접근 없이 입력 샘플만으로 계산한다.
 *
 * <ul>
 *   <li>코스 모드: 누적 거리 d가 순위 키다. GPS 최근접 투영은 사용하지 않는다.
 *   <li>자유 모드: d가 가장 큰 참가자를 리더로 삼고, 리더 궤적이 2점 이상이면 다른 참가자의 진행도를 리더 궤적 위 투영으로
 *       구한다. 궤적이 부족하면 d만으로 순위를 매긴다.
 *   <li>진행도를 내림차순 정렬한 뒤 인접 차이가 TIE_EPSILON_M 이하면 같은 동률 군집·같은 rank다.
 *   <li>누적 거리 표본이 없거나, 종류와 무관한 최신 측정 표본 시각({@link ParticipantSample#freshnessAt()})이 TTL을
 *       넘기거나 허용 오차를 넘어 미래이면 0 등을 만들지 않고 순위 없이 반환한다. 최신 측정 표본이 신선하면 거리 표본이
 *       오래됐어도(멈춰 서 있는 참가자) 마지막 누적 거리로 순위를 낸다.
 * </ul>
 */
public final class GroupRunLiveRanking {
  public static final long GPS_TTL_SECONDS = 60L;
  /** 기기 시계 오차를 허용하는 미래 상한. 이보다 더 미래인 measuredAt은 순위 후보에서 제외한다. */
  public static final long MEASURED_AT_FUTURE_SKEW_SECONDS = 5L;
  public static final double TIE_EPSILON_M = 1.0;

  private static final double EARTH_RADIUS_M = 6_371_000.0;

  private GroupRunLiveRanking() {}

  /**
   * @param now 평가 기준 시각
   * @param courseMode courseId != null 이면 true
   * @param courseDistanceM 코스 길이(없을 수 있음). 현재 순위 키에는 쓰지 않는다.
   * @param samples 참가자별 샘플
   * @return 입력 순서와 같은 결과 목록
   */
  public static List<ParticipantLive> compute(
      Instant now, boolean courseMode, Double courseDistanceM, List<ParticipantSample> samples) {
    if (samples == null || samples.isEmpty()) {
      return List.of();
    }

    int n = samples.size();
    boolean[] ranked = new boolean[n];
    double[] progress = new double[n];

    List<Integer> eligible = new ArrayList<>();
    for (int i = 0; i < n; i++) {
      ParticipantSample s = samples.get(i);
      if (s.eligibleSession()
          && s.totalDistanceM() != null
          && isFinite(s.totalDistanceM())
          && s.measuredAt() != null
          && !isUnusableMeasurement(now, s.freshnessAt())) {
        eligible.add(i);
      }
    }

    if (courseMode) {
      for (int i : eligible) {
        progress[i] = samples.get(i).totalDistanceM();
        ranked[i] = true;
      }
    } else {
      assignFreeProgress(samples, eligible, progress, ranked);
    }

    int[] rank = new int[n];
    int[] ahead = new int[n];
    int[] behind = new int[n];
    Double[] gapAhead = new Double[n];
    Double[] gapBehind = new Double[n];
    assignClusterRanks(ranked, progress, rank, ahead, behind, gapAhead, gapBehind);

    List<ParticipantLive> result = new ArrayList<>(n);
    for (int i = 0; i < n; i++) {
      ParticipantSample s = samples.get(i);
      if (!ranked[i]) {
        // 순위 집합 밖이어도 마지막 표본 시각은 참고용으로 남긴다. stale=순위 제외.
        result.add(
            new ParticipantLive(
                s.userId(), null, null, null, null, null, null, s.freshnessAt(), true));
        continue;
      }
      result.add(
          new ParticipantLive(
              s.userId(),
              rank[i],
              ahead[i],
              behind[i],
              gapAhead[i],
              gapBehind[i],
              progress[i],
              s.freshnessAt(),
              false));
    }
    return result;
  }

  /**
   * 표본이 순위에 쓰일 수 없는지. TTL 초과이거나 허용 오차를 넘는 미래 시각이면 true.
   * measuredAt이 null이면 호출하지 않는다.
   */
  static boolean isUnusableMeasurement(Instant now, Instant measuredAt) {
    if (now == null || measuredAt == null) {
      return true;
    }
    if (measuredAt.isAfter(now.plusSeconds(MEASURED_AT_FUTURE_SKEW_SECONDS))) {
      return true;
    }
    // TTL 경계(정확히 60초)는 유효
    return now.isAfter(measuredAt.plus(Duration.ofSeconds(GPS_TTL_SECONDS)));
  }

  /**
   * 진행도 내림차순으로 묶되, 인접 참가자 차이가 TIE_EPSILON_M 이하면 같은 군집으로 본다(사슬 동률).
   * 경쟁 순위(1,1,3)를 쓴다.
   */
  private static void assignClusterRanks(
      boolean[] ranked,
      double[] progress,
      int[] rank,
      int[] ahead,
      int[] behind,
      Double[] gapAhead,
      Double[] gapBehind) {
    List<Integer> order = new ArrayList<>();
    for (int i = 0; i < ranked.length; i++) {
      if (ranked[i]) {
        order.add(i);
      }
    }
    order.sort(
        Comparator.comparingDouble((Integer i) -> progress[i])
            .reversed()
            .thenComparingInt(i -> i));

    List<List<Integer>> clusters = new ArrayList<>();
    for (int idx : order) {
      if (clusters.isEmpty()) {
        clusters.add(new ArrayList<>(List.of(idx)));
        continue;
      }
      List<Integer> current = clusters.get(clusters.size() - 1);
      int adjacent = current.get(current.size() - 1);
      if (Math.abs(progress[idx] - progress[adjacent]) <= TIE_EPSILON_M) {
        current.add(idx);
      } else {
        clusters.add(new ArrayList<>(List.of(idx)));
      }
    }

    int peopleBefore = 0;
    for (int c = 0; c < clusters.size(); c++) {
      List<Integer> cluster = clusters.get(c);
      int clusterRank = peopleBefore + 1;
      int clusterAhead = peopleBefore;
      int clusterBehind = order.size() - peopleBefore - cluster.size();
      Double nearestPrev =
          c > 0 ? progress[clusters.get(c - 1).get(clusters.get(c - 1).size() - 1)] : null;
      Double nearestNext = c + 1 < clusters.size() ? progress[clusters.get(c + 1).get(0)] : null;

      for (int idx : cluster) {
        rank[idx] = clusterRank;
        ahead[idx] = clusterAhead;
        behind[idx] = clusterBehind;
        gapAhead[idx] = nearestPrev == null ? null : nearestPrev - progress[idx];
        gapBehind[idx] = nearestNext == null ? null : progress[idx] - nearestNext;
      }
      peopleBefore += cluster.size();
    }
  }

  private static void assignFreeProgress(
      List<ParticipantSample> samples, List<Integer> eligible, double[] progress, boolean[] ranked) {
    if (eligible.isEmpty()) {
      return;
    }
    int leader = eligible.get(0);
    for (int i : eligible) {
      double d = samples.get(i).totalDistanceM();
      double ld = samples.get(leader).totalDistanceM();
      if (d > ld || (d == ld && samples.get(i).userId() < samples.get(leader).userId())) {
        leader = i;
      }
    }
    double leaderD = samples.get(leader).totalDistanceM();
    List<GeoPoint> track = samples.get(leader).track();
    double[] cumulative = track == null || track.size() < 2 ? null : cumulativeLengths(track);
    double trackLength = cumulative == null ? 0.0 : cumulative[cumulative.length - 1];
    boolean useProjection = cumulative != null && trackLength > 0.0;

    for (int i : eligible) {
      ParticipantSample s = samples.get(i);
      ranked[i] = true;
      if (i == leader || !useProjection) {
        progress[i] = s.totalDistanceM();
        continue;
      }
      List<GeoPoint> own = s.track();
      if (own == null || own.isEmpty()) {
        progress[i] = s.totalDistanceM(); // MVP·확장: 위치 없으면 d로 대체
        continue;
      }
      GeoPoint last = own.get(own.size() - 1);
      double along = projectAlong(track, cumulative, last);
      // 리더 궤적 길이를 리더 누적 거리 척도로 환산하고 리더를 넘지 않게 한다
      progress[i] = Math.min(leaderD, along * (leaderD / trackLength));
    }
  }

  private static boolean isFinite(double v) {
    return !Double.isNaN(v) && !Double.isInfinite(v);
  }

  private static double[] cumulativeLengths(List<GeoPoint> track) {
    double[] cum = new double[track.size()];
    for (int i = 1; i < track.size(); i++) {
      cum[i] = cum[i - 1] + haversine(track.get(i - 1), track.get(i));
    }
    return cum;
  }

  /** 점을 궤적에 투영했을 때 시작점부터의 호 길이(m). */
  private static double projectAlong(List<GeoPoint> track, double[] cumulative, GeoPoint p) {
    double bestDist = Double.POSITIVE_INFINITY;
    double bestAlong = 0.0;
    for (int i = 0; i + 1 < track.size(); i++) {
      GeoPoint a = track.get(i);
      GeoPoint b = track.get(i + 1);
      double cosLat = Math.cos(Math.toRadians(a.latitude()));
      double bx = toMeters(b.longitude() - a.longitude()) * cosLat;
      double by = toMeters(b.latitude() - a.latitude());
      double px = toMeters(p.longitude() - a.longitude()) * cosLat;
      double py = toMeters(p.latitude() - a.latitude());
      double len2 = bx * bx + by * by;
      double t = len2 == 0.0 ? 0.0 : Math.max(0.0, Math.min(1.0, (px * bx + py * by) / len2));
      double dx = px - t * bx;
      double dy = py - t * by;
      double dist = Math.sqrt(dx * dx + dy * dy);
      if (dist < bestDist) {
        bestDist = dist;
        bestAlong = cumulative[i] + t * (cumulative[i + 1] - cumulative[i]);
      }
    }
    return bestAlong;
  }

  private static double toMeters(double degrees) {
    return Math.toRadians(degrees) * EARTH_RADIUS_M;
  }

  private static double haversine(GeoPoint a, GeoPoint b) {
    double lat1 = Math.toRadians(a.latitude());
    double lat2 = Math.toRadians(b.latitude());
    double dLat = lat2 - lat1;
    double dLon = Math.toRadians(b.longitude() - a.longitude());
    double h =
        Math.sin(dLat / 2) * Math.sin(dLat / 2)
            + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1.0, Math.sqrt(h)));
  }
}
