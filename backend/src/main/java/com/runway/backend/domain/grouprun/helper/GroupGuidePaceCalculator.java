package com.runway.backend.domain.grouprun.helper;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/** 그룹 공동 추천 페이스(sec/km) 중앙값. 목표 페이스와 분리한다. */
public final class GroupGuidePaceCalculator {

    private GroupGuidePaceCalculator() {}

    /**
     * 양수 페이스만 모아 중앙값을 반환한다. 짝수 개면 두 중앙값 평균을 반올림. 유효 값이 없으면 null.
     */
    public static Integer medianSecPerKm(List<? extends Number> paces) {
        if (paces == null || paces.isEmpty()) {
            return null;
        }
        List<Double> values = new ArrayList<>();
        for (Number pace : paces) {
            if (pace == null) {
                continue;
            }
            double v = pace.doubleValue();
            if (Double.isFinite(v) && v > 0d) {
                values.add(v);
            }
        }
        if (values.isEmpty()) {
            return null;
        }
        Collections.sort(values);
        int n = values.size();
        if (n % 2 == 1) {
            return (int) Math.round(values.get(n / 2));
        }
        double mid = (values.get(n / 2 - 1) + values.get(n / 2)) / 2.0d;
        return (int) Math.round(mid);
    }

    public static Integer medianSecPerKmFromBigDecimals(List<BigDecimal> paces) {
        if (paces == null || paces.isEmpty()) {
            return null;
        }
        return medianSecPerKm(paces);
    }
}
