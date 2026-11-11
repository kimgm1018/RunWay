package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import java.util.List;
import org.junit.jupiter.api.Test;

/** S15P31E105-612 썸네일 평면 시점(코스 맞춤·역투영)과 Route 요청 범위(보이는 지면 + 여유, 축 상한). 모든 좌표는 합성 값이다. */
class BasemapBboxTest {

    private static final double MPD = ThumbnailCamera.METERS_PER_DEGREE;

    /** 중심 (lon, lat)에서 동서 widthM, 남북 heightM인 코스(대각선 두 점). */
    private static List<double[]> course(double lon, double lat, double widthM, double heightM) {
        double dLon = widthM / (MPD * Math.cos(Math.toRadians(lat))) / 2;
        double dLat = heightM / MPD / 2;
        return List.of(new double[] {lon - dLon, lat - dLat}, new double[] {lon + dLon, lat + dLat});
    }

    @Test
    void 코스_긴_쪽이_이미지_너비의_042이고_중심이_가로_가운데_세로_30퍼센트다() {
        List<double[]> path = course(129.0, 35.0, 1_000, 600);
        ThumbnailCamera camera = ThumbnailCamera.fit(path);

        double x0 = camera.screenX(path.get(0)[0]);
        double x1 = camera.screenX(path.get(1)[0]);
        assertThat(x1 - x0).isCloseTo(0.42 * ThumbnailCamera.WIDTH, within(1e-6));
        assertThat(camera.screenX(129.0)).isCloseTo(300, within(1e-6));
        assertThat(camera.screenY(35.0)).isCloseTo(270, within(1e-6));
        // 북쪽이 위(작은 y)이고 남북도 같은 배율(평면)이다.
        double y0 = camera.screenY(path.get(0)[1]);
        double y1 = camera.screenY(path.get(1)[1]);
        assertThat(y1).isLessThan(y0);
        assertThat(y0 - y1).isCloseTo(600 * camera.pxPerMeter(), within(1e-6));
    }

    @Test
    void 남북이_긴_코스도_긴_쪽으로_맞추고_점_하나는_최소_길이로_맞춘다() {
        ThumbnailCamera tall = ThumbnailCamera.fit(course(129.0, 35.0, 200, 2_000));
        assertThat(tall.pxPerMeter()).isCloseTo(0.42 * 600 / 2_000, within(1e-9));

        ThumbnailCamera point = ThumbnailCamera.fit(List.of(new double[] {129.0, 35.0}));
        assertThat(point.pxPerMeter())
                .isCloseTo(0.42 * 600 / ThumbnailCamera.MIN_COURSE_SPAN_M, within(1e-9));
    }

    @Test
    void 역투영은_지면_투영의_역이다() {
        ThumbnailCamera camera = ThumbnailCamera.fit(course(127.5, 37.5, 1_500, 900));
        assertThat(camera.screenX(camera.lonAt(17))).isCloseTo(17, within(1e-6));
        assertThat(camera.screenY(camera.latAt(812))).isCloseTo(812, within(1e-6));
    }

    @Test
    void 범위는_이미지_네_모서리의_지면에_각_변_8퍼센트_여유를_더한다() {
        ThumbnailCamera camera = ThumbnailCamera.fit(course(129.0, 35.0, 800, 500));

        BasemapBbox bbox = BasemapBbox.visibleFootprint(camera);

        double west = camera.lonAt(0);
        double east = camera.lonAt(600);
        double north = camera.latAt(0);
        double south = camera.latAt(900);
        double marginLon = (east - west) * 0.08;
        double marginLat = (north - south) * 0.08;
        assertThat(bbox.west()).isCloseTo(west - marginLon, within(2e-6));
        assertThat(bbox.east()).isCloseTo(east + marginLon, within(2e-6));
        assertThat(bbox.south()).isCloseTo(south - marginLat, within(2e-6));
        assertThat(bbox.north()).isCloseTo(north + marginLat, within(2e-6));
        // 코스 중심이 이미지 위쪽 30%라 남쪽(아래)이 북쪽보다 더 넓다.
        assertThat(35.0 - bbox.south()).isGreaterThan(bbox.north() - 35.0);
        assertThat(bbox.widthMeters()).isLessThan(BasemapBbox.MAX_SIDE_M);
        assertThat(bbox.heightMeters()).isLessThan(BasemapBbox.MAX_SIDE_M);
    }

    @Test
    void 상한을_넘는_축은_7900m로_줄이고_카드에_보이는_부분_가운데에_두되_코스를_담는다() {
        // 긴 쪽 2.5km: 보이는 남북 지면은 여유 포함 약 10.4km(코스 중심 북쪽 약 3.4km, 남쪽 약 7.0km), 동서 약 6.9km.
        ThumbnailCamera camera = ThumbnailCamera.fit(course(129.0, 35.0, 2_500, 1_000));

        BasemapBbox bbox = BasemapBbox.visibleFootprint(camera);

        assertThat(bbox.heightMeters()).isCloseTo(7_900, within(1.0));
        // 카드는 이미지 위 끝부터 0.83H까지 보여 준다. 상한 구간은 그 가운데에 둔다(코스 중심 기준 대칭이 아님).
        double cardCenter = (camera.latAt(0) + camera.latAt(900 * BasemapBbox.CARD_VISIBLE_BOTTOM_RATIO)) / 2;
        assertThat((bbox.south() + bbox.north()) / 2).isCloseTo(cardCenter, within(2e-6));
        assertThat(cardCenter).isLessThan(35.0);
        // 예전(코스 중심 ±3,950m)보다 아래(카드가 더 보여 주는 쪽)를 더 받는다.
        assertThat(bbox.south()).isLessThan(35.0 - 3_950 / MPD);
        // 코스 범위(긴 쪽 절반 1,250m)는 모두 담는다.
        assertThat(bbox.north()).isGreaterThan(35.0 + 1_250 / MPD);
        assertThat(bbox.south()).isLessThan(35.0 - 1_250 / MPD);
        // 동서는 상한 안이라 그대로(보이는 범위 + 여유).
        assertThat(bbox.widthMeters()).isLessThan(7_900);
        assertThat(bbox.widthMeters())
                .isCloseTo(600 / camera.pxPerMeter() * 1.16, within(5.0));
    }

    @Test
    void 두_축_모두_상한이면_가로는_코스_가운데_세로는_카드_부분_가운데다() {
        // 긴 쪽 3.5km(B-2 재현 크기): 보이는 지면 동서 약 9.7km, 남북 약 14.5km.
        ThumbnailCamera camera = ThumbnailCamera.fit(course(127.03, 37.5, 3_500, 2_800));

        BasemapBbox bbox = BasemapBbox.visibleFootprint(camera);

        // 동서 길이는 범위 중심 위도로 재므로(코스 위도보다 남쪽) 상한과 몇 m 다르다.
        assertThat(bbox.widthMeters()).isCloseTo(7_900, within(5.0));
        assertThat(bbox.heightMeters()).isCloseTo(7_900, within(1.0));
        assertThat((bbox.west() + bbox.east()) / 2).isCloseTo(127.03, within(1e-6));
        double cardCenter = (camera.latAt(0) + camera.latAt(900 * BasemapBbox.CARD_VISIBLE_BOTTOM_RATIO)) / 2;
        assertThat((bbox.south() + bbox.north()) / 2).isCloseTo(cardCenter, within(2e-6));
        // 상한 구간은 이미지 위 끝보다 아래에서 시작하고(카드 위쪽 일부는 바탕색) 이미지 아래 끝보다 위에서 끝난다.
        assertThat(bbox.north()).isLessThan(camera.latAt(0));
        assertThat(bbox.south()).isGreaterThan(camera.latAt(900));
        assertThat(bbox.north()).isGreaterThan(37.5 + 1_750 / MPD);
        assertThat(bbox.south()).isLessThan(37.5 - 1_750 / MPD);
    }

    @Test
    void 아주_긴_코스는_두_축_모두_상한이고_Route_계약_8000m_1도_안이다() {
        ThumbnailCamera camera = ThumbnailCamera.fit(course(129.0, 35.0, 20_000, 15_000));

        BasemapBbox bbox = BasemapBbox.visibleFootprint(camera);

        assertThat(bbox.widthMeters()).isCloseTo(7_900, within(1.0)).isLessThan(8_000);
        assertThat(bbox.heightMeters()).isCloseTo(7_900, within(1.0)).isLessThan(8_000);
        assertThat(bbox.east() - bbox.west()).isLessThanOrEqualTo(1.0);
        assertThat(bbox.north() - bbox.south()).isLessThanOrEqualTo(1.0);
        assertThat((bbox.west() + bbox.east()) / 2).isCloseTo(129.0, within(1e-6));
    }

    @Test
    void 축_상한_구간은_초점을_가운데로_코스를_담고_보이는_범위_밖으로_나가지_않게_민다() {
        // 상한 안이면 보이는 범위 + 여유 그대로.
        double[] inside = BasemapBbox.axis(-1_000, 2_000, 7_900, 0, 100);
        assertThat(inside[0]).isCloseTo(-1_240, within(1e-9));
        assertThat(inside[1]).isCloseTo(2_240, within(1e-9));

        // 초점(5,000)을 가운데로 두면 코스(±50)가 빠지므로 코스 아래 끝에서 시작한다.
        double[] keepsCourse = BasemapBbox.axis(-100, 10_000, 7_900, 5_000, 50);
        assertThat(keepsCourse).containsExactly(-50, 7_850);

        // 초점이 코스 아래쪽 멀리 있으면 코스 위 끝에서 끝난다.
        double[] below = BasemapBbox.axis(-10_000, 2_000, 7_900, -9_000, 500);
        assertThat(below[0]).isCloseTo(-7_400, within(1e-9));
        assertThat(below[1]).isCloseTo(500, within(1e-9));

        // 보이는 범위(여유 포함, 아래 끝 -3,720)를 넘으면 그 안으로 민다.
        double[] clamped = BasemapBbox.axis(-3_000, 6_000, 7_900, -5_000, 100);
        assertThat(clamped[0]).isCloseTo(-3_720, within(1e-9));
        assertThat(clamped[1]).isCloseTo(4_180, within(1e-9));

        // 코스가 상한보다 길면 코스 중심을 가운데로 둔다.
        double[] longCourse = BasemapBbox.axis(-20_000, 20_000, 7_900, -5_000, 10_000);
        assertThat(longCourse).containsExactly(-3_950, 3_950);
    }

    @Test
    void 잘못된_코스와_범위는_거부한다() {
        assertThatThrownBy(() -> ThumbnailCamera.fit(List.of()))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ThumbnailCamera.fit(List.<double[]>of(new double[] {Double.NaN, 35})))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> ThumbnailCamera.fit(List.<double[]>of(new double[] {200, 35})))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> new BasemapBbox(129.1, 35.0, 129.0, 35.1))
                .isInstanceOf(IllegalArgumentException.class);
    }
}
