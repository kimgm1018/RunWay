package com.runway.backend.domain.course.basemap;

import java.util.List;

/**
 * 코스 썸네일(세로 {@value #WIDTH}×{@value #HEIGHT} PNG)의 시점(S15P31E105-612, 평면 시안).
 *
 * <p>코스 경로 범위 중심을 원점으로 하는 국지 등장방형 좌표(m, 동쪽 x·북쪽 y)를 쓴다. 코스 경로의 동서·남북 폭 중 긴 쪽이 이미지
 * 너비의 {@value #COURSE_SPAN_RATIO}배가 되도록 배율(px/m)을 정하고, 코스 중심을 이미지 (0.5W, {@value #CENTER_Y_RATIO}H)에
 * 둔다. 위에서 내려다본 평면(북쪽이 위)이다: 화면 x = cx + x·s, 화면 y = cy − y·s(s = px/m). 그래서 이미지에 보이는 지면은
 * 경위도 직사각형이다.
 *
 * @param centerLon 코스 경로 범위 중심 경도
 * @param centerLat 코스 경로 범위 중심 위도
 * @param pxPerMeter 지면 1m의 화면 길이(px)
 */
public record ThumbnailCamera(double centerLon, double centerLat, double pxPerMeter) {

    public static final int WIDTH = 600;
    public static final int HEIGHT = 900;

    /** 코스 긴 쪽 길이 = 이미지 너비 × 이 비율. */
    static final double COURSE_SPAN_RATIO = 0.42;

    static final double CENTER_X_RATIO = 0.5;
    static final double CENTER_Y_RATIO = 0.30;

    /** 아주 짧은 코스(점 하나 등)도 이 길이(m)를 긴 쪽으로 보고 맞춰 과도하게 확대하지 않는다. */
    static final double MIN_COURSE_SPAN_M = 300;

    /** 위도 1도의 길이(m). 평균 지구 반지름 기준. */
    public static final double METERS_PER_DEGREE = 6_371_008.8 * Math.PI / 180;

    public ThumbnailCamera {
        if (!(Double.isFinite(centerLon)
                && Double.isFinite(centerLat)
                && Double.isFinite(pxPerMeter)
                && pxPerMeter > 0
                && Math.abs(centerLat) < 89)) {
            throw new IllegalArgumentException("invalid camera");
        }
    }

    /**
     * 코스 경로 좌표([lon, lat])에 맞춘 시점.
     *
     * @throws IllegalArgumentException 좌표가 없거나 유한하지 않거나 범위를 벗어나면
     */
    public static ThumbnailCamera fit(List<double[]> course) {
        if (course == null || course.isEmpty()) {
            throw new IllegalArgumentException("empty course");
        }
        double minLon = Double.POSITIVE_INFINITY;
        double minLat = Double.POSITIVE_INFINITY;
        double maxLon = Double.NEGATIVE_INFINITY;
        double maxLat = Double.NEGATIVE_INFINITY;
        for (double[] point : course) {
            if (point == null
                    || point.length < 2
                    || !(point[0] >= -180 && point[0] <= 180 && point[1] >= -90 && point[1] <= 90)) {
                throw new IllegalArgumentException("invalid course point");
            }
            minLon = Math.min(minLon, point[0]);
            maxLon = Math.max(maxLon, point[0]);
            minLat = Math.min(minLat, point[1]);
            maxLat = Math.max(maxLat, point[1]);
        }
        double centerLat = (minLat + maxLat) / 2;
        double widthM = (maxLon - minLon) * METERS_PER_DEGREE * Math.cos(Math.toRadians(centerLat));
        double heightM = (maxLat - minLat) * METERS_PER_DEGREE;
        double span = Math.max(MIN_COURSE_SPAN_M, Math.max(widthM, heightM));
        return new ThumbnailCamera(
                (minLon + maxLon) / 2, centerLat, WIDTH * COURSE_SPAN_RATIO / span);
    }

    /** 화면 1px의 지면 길이(m). 선 굵기·그릴 도로 등급을 고르는 축척이다. */
    public double metersPerPixel() {
        return 1 / pxPerMeter;
    }

    /** 코스 경로 범위 긴 쪽의 절반(m). 짧은 코스는 최소 길이의 절반이다. 요청 범위가 코스를 담는지 판단할 때 축마다 이 값을 쓴다. */
    double courseHalfSpanMeters() {
        return WIDTH * COURSE_SPAN_RATIO / 2 / pxPerMeter;
    }

    /** 경도 1도의 길이(m). 중심 위도 기준. */
    public double metersPerDegreeLon() {
        return METERS_PER_DEGREE * Math.cos(Math.toRadians(centerLat));
    }

    public double screenX(double lon) {
        return WIDTH * CENTER_X_RATIO + (lon - centerLon) * metersPerDegreeLon() * pxPerMeter;
    }

    /** 화면 y. 북쪽이 위(작은 y)다. */
    public double screenY(double lat) {
        return HEIGHT * CENTER_Y_RATIO - (lat - centerLat) * METERS_PER_DEGREE * pxPerMeter;
    }

    /** 화면 x의 지면 경도(역투영). */
    public double lonAt(double screenX) {
        return centerLon + (screenX - WIDTH * CENTER_X_RATIO) / pxPerMeter / metersPerDegreeLon();
    }

    /** 화면 y의 위도(역투영). */
    public double latAt(double screenY) {
        return centerLat + (HEIGHT * CENTER_Y_RATIO - screenY) / pxPerMeter / METERS_PER_DEGREE;
    }
}
