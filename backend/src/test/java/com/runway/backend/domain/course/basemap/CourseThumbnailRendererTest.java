package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.HexFormat;
import java.util.List;
import java.util.Set;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.Test;

/** S15P31E105-612 평면 썸네일 그리기: 크기·형식, 같은 입력 같은 결과, 건물 평면·그리기 순서, 빈 지형지물. 모든 좌표는 합성 값이다. */
class CourseThumbnailRendererTest {

    private static final double LON = 129.0;
    private static final double LAT = 35.0;
    private static final double MPD = ThumbnailCamera.METERS_PER_DEGREE;
    private static final double MPD_LON = MPD * Math.cos(Math.toRadians(LAT));

    private final CourseThumbnailRenderer renderer = new CourseThumbnailRenderer();

    /** 중심에서 동쪽 xM, 북쪽 yM 지점. */
    private static double[] at(double xM, double yM) {
        return new double[] {LON + xM / MPD_LON, LAT + yM / MPD};
    }

    /** 약 1km × 600m 사각 루프. */
    private static List<double[]> loop() {
        return List.of(at(-500, -300), at(500, -300), at(500, 300), at(-500, 300), at(-500, -300));
    }

    private static double[] flat(double[]... points) {
        double[] out = new double[points.length * 2];
        for (int i = 0; i < points.length; i++) {
            out[2 * i] = points[i][0];
            out[2 * i + 1] = points[i][1];
        }
        return out;
    }

    /** 중심 (xM, yM), 한 변 sizeM 정사각 고리. */
    private static double[] square(double xM, double yM, double sizeM) {
        double h = sizeM / 2;
        return flat(at(xM - h, yM - h), at(xM + h, yM - h), at(xM + h, yM + h), at(xM - h, yM + h), at(xM - h, yM - h));
    }

    private static BasemapFeature area(Kind kind, double[] ring) {
        return new BasemapFeature(kind, null, true, List.of(ring), 0);
    }

    private static BasemapFeature road(RoadClass roadClass, double[]... points) {
        return new BasemapFeature(Kind.ROAD, roadClass, false, List.<double[]>of(flat(points)), 0);
    }

    private static BasemapFeature building(double xM, double yM, double sizeM, double heightM) {
        return new BasemapFeature(Kind.BUILDING, null, true, List.of(square(xM, yM, sizeM)), heightM);
    }

    private static List<BasemapFeature> scene() {
        List<BasemapFeature> features = new ArrayList<>();
        features.add(area(Kind.SEA, square(0, -1_400, 2_000)));
        features.add(area(Kind.PARK, square(-200, 100, 300)));
        features.add(area(Kind.WATER, square(-200, 100, 80)));
        features.add(area(Kind.GREEN, square(400, 600, 300)));
        features.add(area(Kind.BEACH, flat(at(-800, -420), at(800, -420), at(800, -380), at(-800, -380), at(-800, -420))));
        features.add(new BasemapFeature(Kind.RIVER, null, false, List.<double[]>of(flat(at(-900, 900), at(900, 700))), 0));
        features.add(new BasemapFeature(Kind.COAST, null, false, List.<double[]>of(flat(at(-1_000, -400), at(1_000, -400))), 0));
        features.add(road(RoadClass.MOTORWAY, at(-1_200, 0), at(1_200, 50)));
        features.add(road(RoadClass.SECONDARY, at(0, -900), at(0, 1_200)));
        features.add(road(RoadClass.RESIDENTIAL, at(-600, 400), at(600, 400)));
        features.add(road(RoadClass.FOOTWAY, at(-300, -200), at(300, 200)));
        features.add(road(null, at(-700, -100), at(-700, 700)));
        features.add(building(150, 150, 40, 30));
        features.add(building(250, 250, 30, 60));
        features.add(building(-400, -150, 50, 9));
        return features;
    }

    private static BufferedImage decode(byte[] png) throws Exception {
        return ImageIO.read(new ByteArrayInputStream(png));
    }

    private static String sha256(byte[] bytes) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
    }

    @Test
    void 세로_600x900_PNG를_만든다() throws Exception {
        List<double[]> course = loop();

        byte[] png = renderer.render(scene(), course, ThumbnailCamera.fit(course));

        assertThat(png).startsWith(0x89, 'P', 'N', 'G', 0x0D, 0x0A, 0x1A, 0x0A);
        BufferedImage image = decode(png);
        assertThat(image.getWidth()).isEqualTo(600);
        assertThat(image.getHeight()).isEqualTo(900);
    }

    @Test
    void 같은_입력은_같은_바이트다() throws Exception {
        List<double[]> course = loop();
        ThumbnailCamera camera = ThumbnailCamera.fit(course);

        String first = sha256(renderer.render(scene(), course, camera));
        String second = sha256(new CourseThumbnailRenderer().render(scene(), course, camera));

        assertThat(second).isEqualTo(first);
    }

    @Test
    void 지형지물이_없으면_바탕과_코스만_그린다() throws Exception {
        List<double[]> course = loop();
        ThumbnailCamera camera = ThumbnailCamera.fit(course);

        BufferedImage image = decode(renderer.render(List.of(), course, camera));

        Set<Integer> colors = new HashSet<>();
        for (int y = 0; y < image.getHeight(); y += 3) {
            for (int x = 0; x < image.getWidth(); x += 3) {
                colors.add(image.getRGB(x, y) & 0xFFFFFF);
            }
        }
        int ground = CourseThumbnailRenderer.GROUND.getRGB() & 0xFFFFFF;
        int course111 = CourseThumbnailRenderer.COURSE.getRGB() & 0xFFFFFF;
        assertThat(colors).contains(ground, course111);
        // 모서리는 바탕색이다.
        assertThat(image.getRGB(2, 2) & 0xFFFFFF).isEqualTo(ground);
        assertThat(image.getRGB(597, 897) & 0xFFFFFF).isEqualTo(ground);
        // 출발점(남서 모서리) 중심은 코스 색이다.
        double[] start = course.get(0);
        assertThat(image.getRGB((int) Math.round(camera.screenX(start[0])), (int) Math.round(camera.screenY(start[1]))) & 0xFFFFFF)
                .isEqualTo(course111);
        // 코스 선 밖 내부는 바탕색이다(코스 선만 그리고 채우지 않는다).
        assertThat(image.getRGB(300, 270) & 0xFFFFFF).isEqualTo(ground);
    }

    @Test
    void 건물은_높이와_관계없이_바닥_모양만_평면으로_칠한다() throws Exception {
        List<double[]> course = List.of(at(-500, -300), at(500, -300));
        ThumbnailCamera camera = ThumbnailCamera.fit(course);
        BasemapFeature low = building(0, 100, 40, 3);
        BasemapFeature tall = building(0, 100, 40, 200);

        byte[] lowPng = renderer.render(List.of(low), course, camera);
        byte[] tallPng = renderer.render(List.of(tall), course, camera);

        // 높이를 쓰지 않으므로 같은 그림이다.
        assertThat(sha256(tallPng)).isEqualTo(sha256(lowPng));
        BufferedImage image = decode(lowPng);
        int x = (int) Math.round(camera.screenX(LON));
        int inside = image.getRGB(x, (int) Math.round(camera.screenY(at(0, 100)[1]))) & 0xFFFFFF;
        assertThat(inside).isEqualTo(CourseThumbnailRenderer.BUILDING.getRGB() & 0xFFFFFF);
        // 바닥 모양 바로 북쪽(평면이라 벽·지붕이 솟지 않음)은 바탕색이다.
        int north = image.getRGB(x, (int) Math.round(camera.screenY(at(0, 135)[1]))) & 0xFFFFFF;
        assertThat(north).isEqualTo(CourseThumbnailRenderer.GROUND.getRGB() & 0xFFFFFF);
    }

    @Test
    void 도로는_건물_위에_그린다() throws Exception {
        List<double[]> course = List.of(at(-500, -300), at(500, -300));
        ThumbnailCamera camera = ThumbnailCamera.fit(course);
        BasemapFeature block = building(0, 100, 80, 10);
        BasemapFeature street = road(RoadClass.SECONDARY, at(-200, 100), at(200, 100));

        int x = (int) Math.round(camera.screenX(LON));
        int y = (int) Math.round(camera.screenY(at(0, 100)[1]));
        // 입력 순서와 관계없이 도로 채움(흰색)이 보인다.
        assertThat(decode(renderer.render(List.of(street, block), course, camera)).getRGB(x, y) & 0xFFFFFF)
                .isEqualTo(0xFFFFFF);
        assertThat(decode(renderer.render(List.of(block, street), course, camera)).getRGB(x, y) & 0xFFFFFF)
                .isEqualTo(0xFFFFFF);
    }

    @Test
    void 코스는_건물과_도로보다_위에_그린다() throws Exception {
        List<double[]> course = loop();
        ThumbnailCamera camera = ThumbnailCamera.fit(course);
        BasemapFeature block = building(0, -300, 60, 120);
        BasemapFeature street = road(RoadClass.MOTORWAY, at(-50, -300), at(50, -300));

        BufferedImage image = decode(renderer.render(List.of(block, street), course, camera));

        int x = (int) Math.round(camera.screenX(LON));
        int y = (int) Math.round(camera.screenY(at(0, -300)[1]));
        assertThat(image.getRGB(x, y) & 0xFFFFFF).isEqualTo(0x111111);
    }

    // --- 축척(B-2) ---

    /** 동서 spanM 길이의 직선 코스(중심 남쪽 0.3×spanM). 축척 m/px = spanM / 252. */
    private static List<double[]> straight(double spanM) {
        return List.of(at(-spanM / 2, -0.3 * spanM), at(spanM / 2, -0.3 * spanM));
    }

    /** 이미지 가운데 세로줄에서 코스 근처를 뺀, 바탕색이 아닌 화소 수. */
    private static int paintedInColumn(BufferedImage image, ThumbnailCamera camera, double courseLat) {
        int courseY = (int) Math.round(camera.screenY(courseLat));
        int ground = CourseThumbnailRenderer.GROUND.getRGB() & 0xFFFFFF;
        int painted = 0;
        for (int y = 0; y < image.getHeight(); y++) {
            if (Math.abs(y - courseY) > 40 && (image.getRGB(300, y) & 0xFFFFFF) != ground) {
                painted++;
            }
        }
        return painted;
    }

    @Test
    void 선_굵기_배율은_기준_축척_1km_코스에서_1이고_넓을수록_줄어_03에서_멈춘다() {
        double ref = CourseThumbnailRenderer.REFERENCE_METERS_PER_PIXEL;
        assertThat(ref).isCloseTo(1_000 / 252.0, org.assertj.core.api.Assertions.within(1e-9));
        assertThat(ThumbnailCamera.fit(straight(1_000)).metersPerPixel())
                .isCloseTo(ref, org.assertj.core.api.Assertions.within(1e-3));
        assertThat(CourseThumbnailRenderer.lineFactor(ref)).isEqualTo(1.0);
        assertThat(CourseThumbnailRenderer.lineFactor(ref / 3)).isEqualTo(1.0);
        assertThat(CourseThumbnailRenderer.lineFactor(ref * 2)).isCloseTo(0.5, org.assertj.core.api.Assertions.within(1e-9));
        assertThat(CourseThumbnailRenderer.lineFactor(ref * 3)).isCloseTo(1 / 3.0, org.assertj.core.api.Assertions.within(1e-9));
        assertThat(CourseThumbnailRenderer.lineFactor(ref * 10)).isEqualTo(0.3);
    }

    @Test
    void 코스가_넓을수록_도로_선이_가늘어진다() throws Exception {
        int[] widths = new int[3];
        double[] spans = {1_000, 3_000, 5_000};
        for (int i = 0; i < spans.length; i++) {
            List<double[]> course = straight(spans[i]);
            ThumbnailCamera camera = ThumbnailCamera.fit(course);
            BasemapFeature street =
                    road(RoadClass.SECONDARY, at(-3 * spans[i], 0.1 * spans[i]), at(3 * spans[i], 0.1 * spans[i]));
            widths[i] = paintedInColumn(decode(renderer.render(List.of(street), course, camera)), camera, course.get(0)[1]);
        }
        // 1km: 시안 굵기(테두리 4.2 × 3.75 ≈ 15.8px). 3km: 약 1/3. 5km: 하한 0.3배.
        assertThat(widths[0]).isBetween(15, 18);
        assertThat(widths[1]).isLessThan(widths[0] / 2);
        assertThat(widths[2]).isLessThanOrEqualTo(widths[1]);
        assertThat(widths[2]).isGreaterThan(0);
    }

    @Test
    void 코스_선과_출발점은_축척과_관계없이_같은_굵기다() throws Exception {
        int[] widths = new int[2];
        double[] spans = {1_000, 8_000};
        for (int i = 0; i < spans.length; i++) {
            List<double[]> course = List.of(at(0, -spans[i] / 2), at(0, spans[i] / 2));
            ThumbnailCamera camera = ThumbnailCamera.fit(course);
            BufferedImage image = decode(renderer.render(List.of(), course, camera));
            int y = (int) Math.round(camera.screenY(LAT));
            int painted = 0;
            for (int x = 0; x < image.getWidth(); x++) {
                if ((image.getRGB(x, y) & 0xFFFFFF) == (CourseThumbnailRenderer.COURSE.getRGB() & 0xFFFFFF)) {
                    painted++;
                }
            }
            widths[i] = painted;
        }
        assertThat(widths[1]).isEqualTo(widths[0]).isGreaterThan(0);
    }

    @Test
    void 축척에_따라_보행로_이면도로를_그리지_않는다() throws Exception {
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.FOOTWAY, 5.0)).isTrue();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.FOOTWAY, 5.01)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.PATH, 6)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.CYCLEWAY, 6)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.PEDESTRIAN, 6)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.RESIDENTIAL, 8)).isTrue();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.RESIDENTIAL, 8.01)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.UNCLASSIFIED, 9)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.LIVING_STREET, 9)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(null, 9)).isFalse();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.TERTIARY, 100)).isTrue();
        assertThat(CourseThumbnailRenderer.roadDrawn(RoadClass.MOTORWAY, 100)).isTrue();

        // 1km 코스(약 4 m/px)는 보행로를 그리고(선택 시안 ⑤), 3km 코스(약 12 m/px)는 그리지 않는다(빈 지도와 같은 바이트).
        for (double span : new double[] {1_000, 3_000}) {
            List<double[]> course = straight(span);
            ThumbnailCamera camera = ThumbnailCamera.fit(course);
            BasemapFeature footway = road(RoadClass.FOOTWAY, at(-span, 0.1 * span), at(span, 0.1 * span));
            boolean same =
                    sha256(renderer.render(List.of(footway), course, camera))
                            .equals(sha256(renderer.render(List.of(), course, camera)));
            assertThat(same).as("span %s", span).isEqualTo(span > 2_000);
        }
        // 이면도로: 1km 코스는 그리고 3km 코스(약 12 m/px)는 그리지 않는다.
        for (double span : new double[] {1_000, 3_000}) {
            List<double[]> course = straight(span);
            ThumbnailCamera camera = ThumbnailCamera.fit(course);
            BasemapFeature residential = road(RoadClass.RESIDENTIAL, at(-span, 0.1 * span), at(span, 0.1 * span));
            boolean same =
                    sha256(renderer.render(List.of(residential), course, camera))
                            .equals(sha256(renderer.render(List.of(), course, camera)));
            assertThat(same).as("span %s", span).isEqualTo(span > 2_000);
        }
    }

    @Test
    void 화면에서_15px_정사각형보다_작은_건물은_그리지_않는다() throws Exception {
        // 20m 건물: 1km 코스에서 약 5px(그림), 10km 코스에서 약 0.5px(생략).
        for (double span : new double[] {1_000, 10_000}) {
            List<double[]> course = straight(span);
            ThumbnailCamera camera = ThumbnailCamera.fit(course);
            BasemapFeature small = building(0, 0.1 * span, 20, 10);
            boolean same =
                    sha256(renderer.render(List.of(small), course, camera))
                            .equals(sha256(renderer.render(List.of(), course, camera)));
            assertThat(same).as("span %s", span).isEqualTo(span > 5_000);
        }
        ThumbnailCamera camera = ThumbnailCamera.fit(straight(1_000));
        assertThat(CourseThumbnailRenderer.screenArea(square(0, 0, 20), camera))
                .isCloseTo(Math.pow(20 / camera.metersPerPixel(), 2), org.assertj.core.api.Assertions.within(0.01));
    }
}
