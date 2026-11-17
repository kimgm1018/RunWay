package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.domain.grouprun.dto.response.GroupRunDetailResponse.ComfortRange;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;

/**
 * 그룹런 적합도(myFit)·참가자 편한 범위(comfortRange) 파생 계산. 저장 값 없이 최근 유효 완료 세션 페이스를 쓰고, 유효 기록이 없으면 가입 때 입력한 초기 설정
 * 페이스(user_profiles.average_pace)를 쓴다(S15P31E105-886).
 */
public final class GroupRunFitCalculator {

    /** 최근 페이스에 쓰는 완료 세션 최대 개수. */
    public static final int RECENT_SESSION_LIMIT = 5;

    /** 최근 페이스에 넣는 세션의 최소 거리(m). AI09 기준 속도와 같은 하한(S15P31E105-785 SPEED_REF_MIN_DISTANCE_M). */
    public static final int MIN_SESSION_DISTANCE_M = 1000;

    /** 최근 페이스에 넣는 세션의 최소 이동 시간(초). AI09 기준 속도와 같은 하한(S15P31E105-785 SPEED_REF_MIN_MOVING_SEC). */
    public static final int MIN_SESSION_MOVING_SEC = 600;

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
     * 그 사람의 페이스(sec/km): 최근 유효 기록 평균이 있으면 그것, 없으면 초기 설정 페이스(반올림, 양수만). 둘 다 없으면 null(S15P31E105-886).
     */
    public static Integer participantPaceSecPerKm(List<BigDecimal> latestFirstPaces, BigDecimal profilePace) {
        Integer recent = recentPaceSecPerKm(latestFirstPaces);
        if (recent != null) {
            return recent;
        }
        if (profilePace == null || profilePace.signum() <= 0) {
            return null;
        }
        int rounded = profilePace.setScale(0, RoundingMode.HALF_UP).intValue();
        return rounded > 0 ? rounded : null;
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
