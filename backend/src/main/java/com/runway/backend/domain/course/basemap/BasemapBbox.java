package com.runway.backend.domain.course.basemap;

/**
 * Route 바탕 지도 요청 범위(WGS84 경위도, [west, south, east, north]).
 *
 * <p>{@link #visibleFootprint}는 썸네일 시점({@link ThumbnailCamera})에서 이미지에 보이는 지면 범위다. 이미지 직사각형을 지면
 * 경위도로 옮긴 범위를 각 변 쪽으로 축 길이의 {@value #MARGIN_RATIO}배씩 넓힌다(가장자리 밖 굵은 선·도형이 이미지 안으로 들어오는 몫).
 * 축마다 길이가 {@value #MAX_SIDE_M}m(그리고 1°)를 넘으면 그 길이로 줄인다. 줄인 구간은 카드가 실제로 보여 주는 이미지 부분(가로 전체,
 * 세로 위쪽부터 {@value #CARD_VISIBLE_BOTTOM_RATIO}H까지: 코스 중심이 0.30H에 있고 카드는 코스 위보다 아래를 더 보여 준다)의 가운데에
 * 두되, 코스 범위가 상한 안이면 코스를 모두 담도록 옮기고, 보이는 범위(여유 포함) 밖으로 나가지 않게 민다(B-2). 잘린 곳은 바탕색만
 * 그린다.
 */
public record BasemapBbox(double west, double south, double east, double north) {

    /** 보이는 범위의 각 변 쪽 여유(축 길이 대비). */
    static final double MARGIN_RATIO = 0.08;

    /**
     * 한 변 상한(m). Route 계약 상한은 8,000m이지만 Route가 다른 방식으로 길이를 재도 400 VALIDATION_ERROR가 나지 않도록 작게
     * 둔다. 400은 저장하지 않으므로 큰 코스가 기동 때마다 다시 실패하는 일을 막는다.
     */
    static final double MAX_SIDE_M = 7_900;

    /**
     * 카드가 보여 주는 이미지 아래 끝(이미지 높이 대비). 앱 {@code basemapImageFrame}은 코스 중심(0.30H) 아래로 코스 긴 쪽의 약 1.9배를
     * 보여 준다: 0.30 + 1.9 × 0.42 × 600 / 900 ≈ 0.83. 위쪽은 이미지 위 끝(0)까지 보인다.
     */
    static final double CARD_VISIBLE_BOTTOM_RATIO = 0.83;

    /** 한 변 상한(도). Route 계약 상한 1°. */
    static final double MAX_SIDE_DEGREES = 1.0;

    /** 위도 1도의 길이(m). */
    static final double METERS_PER_DEGREE = ThumbnailCamera.METERS_PER_DEGREE;

    /** 요청 좌표 소수 자릿수(약 0.1m). */
    private static final double SCALE = 1e6;

    public BasemapBbox {
        if (!(Double.isFinite(west)
                && Double.isFinite(south)
                && Double.isFinite(east)
                && Double.isFinite(north)
                && west < east
                && south < north)) {
            throw new IllegalArgumentException("invalid bbox");
        }
    }

    /** 시점에서 보이는 지면 범위(여유 포함, 축마다 상한 적용). */
    public static BasemapBbox visibleFootprint(ThumbnailCamera camera) {
        double mpdLon = camera.metersPerDegreeLon();
        double courseHalf = camera.courseHalfSpanMeters();
        // 코스 중심 기준 m 좌표. 가로는 카드가 이미지 너비 전체를 보여 주므로 이미지 가운데(코스 중심)가 초점이다.
        double west = (camera.lonAt(0) - camera.centerLon()) * mpdLon;
        double east = (camera.lonAt(ThumbnailCamera.WIDTH) - camera.centerLon()) * mpdLon;
        double[] x =
                axis(
                        west,
                        east,
                        Math.min(MAX_SIDE_M, MAX_SIDE_DEGREES * mpdLon),
                        (west + east) / 2,
                        courseHalf);
        double north = (camera.latAt(0) - camera.centerLat()) * METERS_PER_DEGREE;
        double cardSouth =
                (camera.latAt(ThumbnailCamera.HEIGHT * CARD_VISIBLE_BOTTOM_RATIO) - camera.centerLat())
                        * METERS_PER_DEGREE;
        double[] y =
                axis(
                        (camera.latAt(ThumbnailCamera.HEIGHT) - camera.centerLat()) * METERS_PER_DEGREE,
                        north,
                        Math.min(MAX_SIDE_M, MAX_SIDE_DEGREES * METERS_PER_DEGREE),
                        (cardSouth + north) / 2,
                        courseHalf);
        return new BasemapBbox(
                round(Math.max(-180, camera.centerLon() + x[0] / mpdLon)),
                round(Math.max(-90, camera.centerLat() + y[0] / METERS_PER_DEGREE)),
                round(Math.min(180, camera.centerLon() + x[1] / mpdLon)),
                round(Math.min(90, camera.centerLat() + y[1] / METERS_PER_DEGREE)));
    }

    /**
     * 한 축의 범위(코스 중심 = 0, m). 여유를 더하고 상한을 넘으면 상한 길이 구간을 정한다: {@code focus}를 가운데에 두고, 코스 범위
     * {@code [-courseHalf, courseHalf]}가 상한 안이면 코스를 모두 담도록(아니면 코스 중심을 가운데로) 옮긴 뒤, 보이는 범위(여유 포함)
     * 안으로 민다.
     *
     * @param low 보이는 범위 아래 끝(여유 전)
     * @param high 보이는 범위 위 끝(여유 전)
     * @param cap 상한 길이
     * @param focus 상한 구간의 가운데로 둘 지점(카드에 보이는 부분의 가운데)
     * @param courseHalf 코스 범위의 절반
     */
    static double[] axis(double low, double high, double cap, double focus, double courseHalf) {
        double margin = (high - low) * MARGIN_RATIO;
        low -= margin;
        high += margin;
        if (high - low <= cap) {
            return new double[] {low, high};
        }
        double start;
        if (2 * courseHalf <= cap) {
            start = clamp(focus - cap / 2, courseHalf - cap, -courseHalf);
        } else {
            start = -cap / 2;
        }
        start = clamp(start, low, high - cap);
        return new double[] {start, start + cap};
    }

    private static double clamp(double value, double min, double max) {
        return Math.min(Math.max(value, min), max);
    }

    /** 동서 길이(m). 범위 중심 위도 기준 근사. */
    public double widthMeters() {
        double centerLat = (south + north) / 2;
        return (east - west) * METERS_PER_DEGREE * Math.cos(Math.toRadians(centerLat));
    }

    /** 남북 길이(m). */
    public double heightMeters() {
        return (north - south) * METERS_PER_DEGREE;
    }

    private static double round(double value) {
        return Math.round(value * SCALE) / SCALE;
    }
}
