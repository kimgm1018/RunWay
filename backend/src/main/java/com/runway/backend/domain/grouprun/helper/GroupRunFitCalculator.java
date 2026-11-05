package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse.ComfortRange;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/** 그룹런 적합도(myFit)·참가자 편한 범위(comfortRange) 파생 계산. 저장 값 없이 최근 완료 세션 페이스만 쓴다. */
public final class GroupRunFitCalculator {

    /** 최근 페이스에 쓰는 완료 세션 최대 개수. */
    public static final int RECENT_SESSION_LIMIT = 5;

    /** 참가자 값이 2명 미만일 때 추천 공동 페이스 앞뒤로 두는 폭(sec/km). */
    public static final int FALLBACK_SPREAD_SEC = 20;

    private GroupRunFitCalculator() {}

    /**
     * 최근 완료 세션 평균 페이스의 산술평균(sec/km)을 반올림한다. 양수·유한 값만 쓰며 최근 {@link #RECENT_SESSION_LIMIT}개까지만 반영한다. 호출자는 최신순
     * 목록을 넘긴다. 유효 값이 없으면 null.
     */
    public static Integer recentPaceSecPerKm(List<BigDecimal> latestFirstPaces) {
        if (latestFirstPaces == null || latestFirstPaces.isEmpty()) {
            return null;
        }
        BigDecimal sum = BigDecimal.ZERO;
        int count = 0;
        for (BigDecimal pace : latestFirstPaces) {
            if (count >= RECENT_SESSION_LIMIT) {
                break;
            }
            if (pace == null || pace.signum() <= 0) {
                continue;
            }
            sum = sum.add(pace);
            count++;
        }
        if (count == 0) {
            return null;
        }
        return sum.divide(BigDecimal.valueOf(count), 0, RoundingMode.HALF_UP).intValueExact();
    }

    /**
     * 참가자별 최근 페이스가 2개 이상이면 [최솟값, 최댓값]. 2개 미만이면 추천 공동 페이스±{@value #FALLBACK_SPREAD_SEC}초(빠른 쪽은 1 미만으로 내려가지 않는다).
     * 추천 페이스도 없으면 null.
     */
    public static ComfortRange comfortRange(List<Integer> participantPaces, Integer guidePace) {
        List<Integer> paces =
                participantPaces == null
                        ? List.of()
                        : participantPaces.stream().filter(p -> p != null && p > 0).toList();
        if (paces.size() >= 2) {
            int min = paces.stream().mapToInt(Integer::intValue).min().getAsInt();
            int max = paces.stream().mapToInt(Integer::intValue).max().getAsInt();
            return new ComfortRange(min, max);
        }
        if (guidePace == null || guidePace <= 0) {
            return null;
        }
        return new ComfortRange(
                Math.max(1, guidePace - FALLBACK_SPREAD_SEC), guidePace + FALLBACK_SPREAD_SEC);
    }
}
