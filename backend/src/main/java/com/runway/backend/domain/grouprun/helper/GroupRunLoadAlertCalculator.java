package com.runway.backend.domain.grouprun.helper;

import com.runway.backend.domain.grouprun.dto.response.GroupRunLiveResponse.LoadAlert;
import java.math.BigDecimal;
import java.util.List;

/** G10 부담 알림(MVP 규칙). 순수 계산이며 저장·알림 같은 부수 효과가 없다. */
public final class GroupRunLoadAlertCalculator {

    /** 안내 페이스보다 이 값(초/km) 이상 빠르면 부담 참가자로 본다. */
    public static final int STRAIN_MARGIN_SEC_PER_KM = 30;

    /** 부담 알림이 제안하는 다음 페이스 = 안내 페이스 + 이 값(초/km). */
    public static final int SLOWDOWN_SEC_PER_KM = 15;

    private GroupRunLoadAlertCalculator() {}

    /** 세션 평균 페이스를 정수 sec/km로 변환한다. null·비양수·비유한 값은 null. */
    public static Integer toPaceSecPerKm(BigDecimal averagePace) {
        if (averagePace == null || averagePace.signum() <= 0) {
            return null;
        }
        double v = averagePace.doubleValue();
        if (!Double.isFinite(v)) {
            return null;
        }
        return (int) Math.round(v);
    }

    /**
     * @param guidePaceSecPerKm 그룹 안내 페이스. null이면 알림 없음
     * @param paces 순위 집합(비stale) 참가자의 페이스. null 원소는 무시한다
     * @return 부담 참가자가 1명 이상이면 알림, 아니면 null
     */
    public static LoadAlert evaluate(Integer guidePaceSecPerKm, List<Integer> paces) {
        if (guidePaceSecPerKm == null || paces == null) {
            return null;
        }
        int strained = 0;
        for (Integer pace : paces) {
            if (pace != null && pace <= guidePaceSecPerKm - STRAIN_MARGIN_SEC_PER_KM) {
                strained++;
            }
        }
        if (strained == 0) {
            return null;
        }
        return new LoadAlert(strained, guidePaceSecPerKm + SLOWDOWN_SEC_PER_KM);
    }
}
