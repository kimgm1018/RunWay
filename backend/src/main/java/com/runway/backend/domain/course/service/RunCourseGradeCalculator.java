package com.runway.backend.domain.course.service;

import com.runway.backend.domain.course.dto.request.GradeSegment;
import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.session.service.RunningRouteSelector.RoutePoint;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.ArrayList;
import java.util.List;

/** GPS의 측정된 변만 경사와 누적 상승에 반영한다. 일시정지 연결부에서는 고도 차를 계산하지 않는다. */
public final class RunCourseGradeCalculator {
    private static final double R = 6_371_008.8;

    public record Result(BigDecimal elevationGainM, List<GradeSegment> profile) {}

    private RunCourseGradeCalculator() {}

    public static Result calculate(List<RoutePoint> points, List<Integer> gaps,
                                   BigDecimal storedDistance, ElevationSource elevation) {
        double distance = storedDistance.doubleValue();
        double step = GradeProfileValidator.stepFor(storedDistance).doubleValue();
        int count = (int) Math.ceil(distance / step);
        double[] rises = new double[count];
        double gain = 0;
        double travelled = 0;
        for (int i = 1; i < points.size(); i++) {
            if (gaps.contains(i - 1)) continue;
            RoutePoint a = points.get(i - 1);
            RoutePoint b = points.get(i);
            double edge = distance(a, b);
            if (edge <= 0) continue;
            double z0 = elevation.elevationAt(a.longitude(), a.latitude());
            double z1 = elevation.elevationAt(b.longitude(), b.latitude());
            if (!Double.isFinite(z0) || !Double.isFinite(z1))
                throw new ApiException(ErrorCode.COURSE_GRADE_UNAVAILABLE);
            gain += Math.max(0, z1 - z0);
            double end = travelled + edge;
            int firstBucket = Math.min(count - 1, (int) (travelled / step));
            int lastBucket = Math.min(count - 1, (int) (Math.nextDown(end) / step));
            for (int bucket = firstBucket; bucket <= lastBucket; bucket++) {
                double from = Math.max(travelled, bucket * step);
                double to = Math.min(end, (bucket + 1) * step);
                if (to > from) rises[bucket] += (z1 - z0) * (to - from) / edge;
            }
            travelled = end;
        }
        List<GradeSegment> segments = new ArrayList<>(count);
        for (int i = 0; i < count; i++) {
            BigDecimal start = BigDecimal.valueOf(i).multiply(BigDecimal.valueOf(step));
            BigDecimal end = start.add(BigDecimal.valueOf(step)).min(storedDistance);
            double grade = rises[i] / end.subtract(start).doubleValue() * 100;
            if (!Double.isFinite(grade)) throw new ApiException(ErrorCode.COURSE_GRADE_UNAVAILABLE);
            grade = Math.clamp(grade, -100, 100);
            segments.add(new GradeSegment(start, end,
                    BigDecimal.valueOf(grade).setScale(4, RoundingMode.HALF_EVEN)));
        }
        return new Result(BigDecimal.valueOf(gain).setScale(2, RoundingMode.HALF_UP),
                GradeProfileValidator.validate(segments, storedDistance));
    }

    private static double distance(RoutePoint a, RoutePoint b) {
        double dLat = Math.toRadians(b.latitude() - a.latitude());
        double dLon = Math.toRadians(b.longitude() - a.longitude());
        double h = Math.pow(Math.sin(dLat / 2), 2) + Math.cos(Math.toRadians(a.latitude()))
                * Math.cos(Math.toRadians(b.latitude())) * Math.pow(Math.sin(dLon / 2), 2);
        return 2 * R * Math.asin(Math.sqrt(Math.min(1, h)));
    }
}
