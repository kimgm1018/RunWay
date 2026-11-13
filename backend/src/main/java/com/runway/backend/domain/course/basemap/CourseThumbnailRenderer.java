package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import java.awt.BasicStroke;
import java.awt.Color;
import java.awt.Graphics2D;
import java.awt.RenderingHints;
import java.awt.Shape;
import java.awt.geom.Ellipse2D;
import java.awt.geom.Path2D;
import java.awt.geom.Rectangle2D;
import java.awt.image.BufferedImage;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import javax.imageio.ImageIO;
import org.springframework.stereotype.Component;

/**
 * 코스 썸네일 PNG({@value ThumbnailCamera#WIDTH}×{@value ThumbnailCamera#HEIGHT}, 위에서 내려다본 평면 시안)를 Java2D로 그린다
 * (S15P31E105-612). 글자를 그리지 않으므로 글꼴이 없는 컨테이너에서도 동작한다. 같은 입력은 같은 바이트를 만든다.
 *
 * <p>순서(뒤→앞): 바탕 → 바다·녹지·공원·해변·물 면 → 물길 선 → 해안선 → 건물 평면 → 도로(테두리 전부, 그다음 채움. 작은 길→큰 길) →
 * 코스(짙은 녹색 바깥선, 안쪽 녹색, 밝은 민트 테두리, 민트 중심, 출발점). 건물 높이는 쓰지 않는다. 선 굵기는 시안(카드 160px 기준)에
 * {@value #SCALE}(=600/160)를 곱한 화면 px이다.
 *
 * <p>코스 모양은 승인된 커뮤니티 경로선(S15P31E105-743)의 네 겹 색과 18:12.2:9.3:6.9 굵기 비율을 따른다.
 * 카드의 바깥선 전체 굵기는 기존 {@value #COURSE_SHADOW_WIDTH}px를 유지하고 네 겹을 함께 축소한다.
 *
 * <p>축척(B-2): 시안은 폭 약 1km 코스({@link #REFERENCE_METERS_PER_PIXEL} m/px)에서 확인했다. 그보다 넓은 코스는 지도 선 굵기(도로
 * 채움·테두리, 물길·해안선, 건물 테두리)에 {@link #lineFactor}(= 기준 m/px ÷ m/px, {@value #MIN_LINE_FACTOR}~1)를 곱해 도로가
 * 블록을 덮지 않게 한다. 건물 테두리는 {@value #MIN_BUILDING_EDGE_PX}px보다 가늘게 하지 않는다. 코스 선·테두리·출발점은 줄이지
 * 않는다. 화면에서 거의 보이지 않는 것은 그리지 않는다(Route가 보내더라도): 보행로·자전거길·보행자 도로는 {@value
 * #MINOR_PATH_MAX_METERS_PER_PIXEL} m/px 초과, 이면도로(residential·unclassified·living_street·등급 모름)는 {@value
 * #LOCAL_ROAD_MAX_METERS_PER_PIXEL} m/px 초과, 건물은 바깥 고리 넓이가 ({@value #MIN_BUILDING_SIDE_PX}px)²보다 작을 때다. 같은
 * 기준을 Route 요청의 {@code meters_per_pixel}로 보낸다.
 */
@Component
public class CourseThumbnailRenderer {

    /** 시안(160px 카드) 대비 배율. */
    static final double SCALE = ThumbnailCamera.WIDTH / 160.0;

    static final Color GROUND = new Color(0xF2F1EC);
    private static final Color GREEN = new Color(0xD9EBCB);
    private static final Color PARK = new Color(0xC8E6B5);
    private static final Color BEACH = new Color(0xF4EAC8);
    private static final Color WATER = new Color(0xAFD3EF);
    private static final Color RIVER_LINE = new Color(0x9CC6EA);
    private static final Color COAST = new Color(0x8FB9DD);
    static final Color BUILDING = new Color(0xE4E1DA);
    static final Color BUILDING_EDGE = new Color(0xD5D1C8);
    /** 코스 민트 리본(출발점 채움). */
    static final Color COURSE = new Color(0x4DFFD2);

    /** 코스 중심 민트 줄. */
    static final Color COURSE_CENTRE = COURSE;

    /** 중심을 감싸는 밝은 민트 테두리. */
    static final Color COURSE_RIBBON = new Color(0xB3FFEC);

    /** 밝은 민트 테두리 바깥의 안쪽 녹색 선. */
    static final Color COURSE_INNER = new Color(0x00785A);

    /** 코스 바깥 짙은 녹색 선(출발점 테두리). */
    static final Color COURSE_SHADOW = new Color(0x003A2C);

    /** 코스 굵기(카드 px). 커뮤니티의 18 : 12.2 : 9.3 : 6.9 dp 비율. */
    static final double COURSE_SHADOW_WIDTH = 5.0;

    static final double COURSE_INNER_WIDTH = COURSE_SHADOW_WIDTH * 12.2 / 18;
    static final double COURSE_RIBBON_WIDTH = COURSE_SHADOW_WIDTH * 9.3 / 18;
    static final double COURSE_CENTRE_WIDTH = COURSE_SHADOW_WIDTH * 6.9 / 18;

    /** 출발점 반지름(카드 px): 테두리 바깥, 민트 채움. */
    static final double START_RADIUS = 3.5;

    static final double START_FILL_RADIUS = 2.4;

    /** 기준 축척(m/px): 폭 1km 코스가 이미지 너비의 0.42배일 때(시안 확인 크기). */
    static final double REFERENCE_METERS_PER_PIXEL =
            1_000 / (ThumbnailCamera.WIDTH * ThumbnailCamera.COURSE_SPAN_RATIO);

    /** 지도 선 굵기 배율 하한. */
    static final double MIN_LINE_FACTOR = 0.3;

    /** 건물 테두리 최소 굵기(px). */
    static final double MIN_BUILDING_EDGE_PX = 0.5;

    /** 이보다 축척이 작으면(m/px가 크면) 보행로·자전거길·보행자 도로를 그리지 않는다. Route와 같은 기준이다. */
    static final double MINOR_PATH_MAX_METERS_PER_PIXEL = 5.0;

    /** 이보다 축척이 작으면 이면도로(residential·unclassified·living_street)를 그리지 않는다. Route와 같은 기준이다. */
    static final double LOCAL_ROAD_MAX_METERS_PER_PIXEL = 8;

    /** 바깥 고리 넓이가 이 변 길이(px)의 정사각형보다 작은 건물은 그리지 않는다. */
    static final double MIN_BUILDING_SIDE_PX = 1.5;

    /** 이미지 밖으로 이만큼(px) 넘는 도형은 건너뛴다. */
    private static final double CULL_MARGIN = 64;

    private static final Rectangle2D VIEW =
            new Rectangle2D.Double(
                    -CULL_MARGIN,
                    -CULL_MARGIN,
                    ThumbnailCamera.WIDTH + 2 * CULL_MARGIN,
                    ThumbnailCamera.HEIGHT + 2 * CULL_MARGIN);

    /** 면 그리기 순서. 물이 공원 위에 오도록 시안 순서를 따른다. */
    private static final List<Kind> AREA_ORDER =
            List.of(Kind.SEA, Kind.GREEN, Kind.PARK, Kind.BEACH, Kind.WATER, Kind.RIVER);

    /**
     * @param features 지형지물. 빈 목록이면 바탕과 코스만 그린다
     * @param course 코스 경로 좌표({@code [lon, lat]}), 첫 점이 출발점
     * @param camera 시점
     * @return PNG 바이트
     */
    public byte[] render(List<BasemapFeature> features, List<double[]> course, ThumbnailCamera camera) {
        return renderParts(features, List.of(course), camera);
    }

    /**
     * 끊긴 조각으로 된 경로(기록의 표시용 경로, S15P31E105-756)를 그린다. 조각마다 따로 선을 그리고 조각 사이는 잇지 않는다. 선
     * 스타일·출발점은 코스와 같다. 조각이 하나면 {@link #render}와 같은 그림이다.
     *
     * @param parts 조각별 경로 좌표({@code [lon, lat]}). 첫 조각의 첫 점이 출발점
     */
    public byte[] renderParts(
            List<BasemapFeature> features, List<List<double[]>> parts, ThumbnailCamera camera) {
        BufferedImage image =
                new BufferedImage(
                        ThumbnailCamera.WIDTH, ThumbnailCamera.HEIGHT, BufferedImage.TYPE_INT_RGB);
        Graphics2D g = image.createGraphics();
        try {
            g.setRenderingHint(RenderingHints.KEY_ANTIALIASING, RenderingHints.VALUE_ANTIALIAS_ON);
            g.setRenderingHint(RenderingHints.KEY_RENDERING, RenderingHints.VALUE_RENDER_QUALITY);
            g.setRenderingHint(RenderingHints.KEY_STROKE_CONTROL, RenderingHints.VALUE_STROKE_PURE);
            g.setColor(GROUND);
            g.fillRect(0, 0, ThumbnailCamera.WIDTH, ThumbnailCamera.HEIGHT);

            double factor = lineFactor(camera.metersPerPixel());
            drawAreas(g, features, camera);
            drawLines(g, features, camera, factor);
            drawBuildings(g, features, camera, factor);
            drawRoads(g, features, camera, factor);
            drawCourse(g, parts, camera);
        } finally {
            g.dispose();
        }
        ByteArrayOutputStream out = new ByteArrayOutputStream(256 * 1024);
        try {
            if (!ImageIO.write(image, "png", out)) {
                throw new IllegalStateException("PNG writer unavailable");
            }
        } catch (IOException e) {
            throw new UncheckedIOException(e);
        }
        return out.toByteArray();
    }

    private static void drawAreas(Graphics2D g, List<BasemapFeature> features, ThumbnailCamera camera) {
        for (Kind kind : AREA_ORDER) {
            g.setColor(areaColor(kind));
            for (BasemapFeature feature : features) {
                if (feature.kind() == kind && feature.polygon()) {
                    Path2D path = polygon(feature.parts(), camera);
                    if (visible(path)) {
                        g.fill(path);
                    }
                }
            }
        }
    }

    private static Color areaColor(Kind kind) {
        return switch (kind) {
            case GREEN -> GREEN;
            case PARK -> PARK;
            case BEACH -> BEACH;
            default -> WATER;
        };
    }

    /** 지도 선 굵기 배율: 기준 축척 ÷ 축척을 {@value #MIN_LINE_FACTOR}~1로 자른 값. 기준보다 확대해도 굵게 하지 않는다. */
    static double lineFactor(double metersPerPixel) {
        return Math.min(1, Math.max(MIN_LINE_FACTOR, REFERENCE_METERS_PER_PIXEL / metersPerPixel));
    }

    /** 이 축척에서 그 등급의 도로를 그리는지. 등급을 모르면 이면도로로 본다. */
    static boolean roadDrawn(RoadClass roadClass, double metersPerPixel) {
        int rank = rank(roadClass);
        if (rank >= RoadClass.PEDESTRIAN.rank()) {
            return metersPerPixel <= MINOR_PATH_MAX_METERS_PER_PIXEL;
        }
        if (rank >= RoadClass.UNCLASSIFIED.rank()) {
            return metersPerPixel <= LOCAL_ROAD_MAX_METERS_PER_PIXEL;
        }
        return true;
    }

    private static void drawLines(
            Graphics2D g, List<BasemapFeature> features, ThumbnailCamera camera, double factor) {
        BasicStroke river = roundStroke(2.4 * SCALE * factor);
        BasicStroke coast = new BasicStroke((float) (1 * SCALE * factor));
        for (BasemapFeature feature : features) {
            if (!feature.polygon() && (feature.kind() == Kind.RIVER || feature.kind() == Kind.WATER)) {
                stroke(g, line(feature.parts(), camera), river, RIVER_LINE);
            }
        }
        for (BasemapFeature feature : features) {
            if (!feature.polygon() && feature.kind() == Kind.COAST) {
                stroke(g, line(feature.parts(), camera), coast, COAST);
            }
        }
    }

    /** 건물: 바닥 모양만 평면으로 칠하고 테두리를 긋는다. 높이는 쓰지 않는다. */
    private static void drawBuildings(
            Graphics2D g, List<BasemapFeature> features, ThumbnailCamera camera, double factor) {
        BasicStroke edge =
                new BasicStroke((float) Math.max(MIN_BUILDING_EDGE_PX, 0.4 * SCALE * factor));
        double minArea = MIN_BUILDING_SIDE_PX * MIN_BUILDING_SIDE_PX;
        for (BasemapFeature feature : features) {
            if (feature.kind() != Kind.BUILDING || !feature.polygon()) {
                continue;
            }
            if (screenArea(feature.parts().get(0), camera) < minArea) {
                continue;
            }
            Path2D path = polygon(feature.parts(), camera);
            if (!visible(path)) {
                continue;
            }
            g.setColor(BUILDING);
            g.fill(path);
            g.setColor(BUILDING_EDGE);
            g.setStroke(edge);
            g.draw(path);
        }
    }

    /** 도로: 작은 길부터 테두리를 모두 그린 뒤 같은 순서로 채움을 그린다. */
    private static void drawRoads(
            Graphics2D g, List<BasemapFeature> features, ThumbnailCamera camera, double factor) {
        double metersPerPixel = camera.metersPerPixel();
        List<BasemapFeature> roads = new ArrayList<>();
        for (BasemapFeature feature : features) {
            if (feature.kind() == Kind.ROAD
                    && !feature.polygon()
                    && roadDrawn(feature.roadClass(), metersPerPixel)) {
                roads.add(feature);
            }
        }
        // 안정 정렬: 같은 등급은 입력 순서를 유지한다.
        roads.sort(Comparator.comparingInt((BasemapFeature f) -> rank(f.roadClass())).reversed());
        List<Path2D> paths = new ArrayList<>(roads.size());
        for (BasemapFeature road : roads) {
            paths.add(line(road.parts(), camera));
        }
        for (int i = 0; i < roads.size(); i++) {
            RoadStyle style = RoadStyle.of(rank(roads.get(i).roadClass()));
            stroke(g, paths.get(i), roundStroke(style.casingWidth() * factor), style.casing());
        }
        for (int i = 0; i < roads.size(); i++) {
            RoadStyle style = RoadStyle.of(rank(roads.get(i).roadClass()));
            stroke(g, paths.get(i), roundStroke(style.fillWidth() * factor), style.fill());
        }
    }

    /** 등급을 모르는 도로는 이면도로(5~7등급)로 그린다. */
    static int rank(RoadClass roadClass) {
        return roadClass == null ? RoadClass.UNCLASSIFIED.rank() : roadClass.rank();
    }

    /** 시안의 도로 모양(카드 px) × 배율. */
    record RoadStyle(Color fill, double fillWidth, Color casing, double casingWidth) {

        static RoadStyle of(int rank) {
            if (rank >= 8) {
                return scaled(0xFFFFFF, 0.8, 0xE3E1DC, 1.2);
            }
            if (rank <= 1) {
                return scaled(0xFFD86E, 3.4, 0xE7B341, 4.6);
            }
            if (rank <= 3) {
                return scaled(0xFFFFFF, 3.0, 0xC9CDD2, 4.2);
            }
            if (rank == 4) {
                return scaled(0xFFFFFF, 2.2, 0xD3D6DA, 3.1);
            }
            return scaled(0xFFFFFF, 1.3, 0xDADDE0, 1.9);
        }

        private static RoadStyle scaled(int fill, double width, int casing, double casingWidth) {
            return new RoadStyle(
                    new Color(fill), width * SCALE, new Color(casing), casingWidth * SCALE);
        }
    }

    /** 코스: 진한 청록 테두리 → 민트 리본 → 밝은 민트 가운데 줄 → 출발점(테두리, 민트 채움). */
    private static void drawCourse(
            Graphics2D g, List<List<double[]>> parts, ThumbnailCamera camera) {
        if (parts.isEmpty() || parts.get(0).isEmpty()) {
            return;
        }
        // Each part is its own sub-path (moveTo), so a stroke never joins one part's end to the next part's start.
        Path2D path = new Path2D.Double();
        boolean drawn = false;
        for (List<double[]> part : parts) {
            if (part.size() < 2) {
                continue;
            }
            for (int i = 0; i < part.size(); i++) {
                double x = camera.screenX(part.get(i)[0]);
                double y = camera.screenY(part.get(i)[1]);
                if (i == 0) {
                    path.moveTo(x, y);
                } else {
                    path.lineTo(x, y);
                }
            }
            drawn = true;
        }
        List<double[]> course = parts.get(0);
        if (drawn) {
            stroke(g, path, roundStroke(COURSE_SHADOW_WIDTH * SCALE), COURSE_SHADOW);
            stroke(g, path, roundStroke(COURSE_INNER_WIDTH * SCALE), COURSE_INNER);
            stroke(g, path, roundStroke(COURSE_RIBBON_WIDTH * SCALE), COURSE_RIBBON);
            stroke(g, path, roundStroke(COURSE_CENTRE_WIDTH * SCALE), COURSE_CENTRE);
        }
        double sx = camera.screenX(course.get(0)[0]);
        double sy = camera.screenY(course.get(0)[1]);
        g.setColor(COURSE_SHADOW);
        g.fill(circle(sx, sy, START_RADIUS * SCALE));
        g.setColor(COURSE);
        g.fill(circle(sx, sy, START_FILL_RADIUS * SCALE));
    }

    private static Ellipse2D circle(double x, double y, double radius) {
        return new Ellipse2D.Double(x - radius, y - radius, 2 * radius, 2 * radius);
    }

    /** 고리({@code [lon0, lat0, ...]})의 화면 넓이(px², 신발끈 공식 절댓값). */
    static double screenArea(double[] ring, ThumbnailCamera camera) {
        int n = ring.length / 2;
        if (n < 3) {
            return 0;
        }
        double sum = 0;
        double px = camera.screenX(ring[2 * (n - 1)]);
        double py = camera.screenY(ring[2 * (n - 1) + 1]);
        for (int i = 0; i < n; i++) {
            double x = camera.screenX(ring[2 * i]);
            double y = camera.screenY(ring[2 * i + 1]);
            sum += px * y - x * py;
            px = x;
            py = y;
        }
        return Math.abs(sum) / 2;
    }

    /** Polygon: 첫 고리가 바깥, 나머지는 구멍(짝홀 규칙). */
    private static Path2D polygon(List<double[]> rings, ThumbnailCamera camera) {
        Path2D path = new Path2D.Double(Path2D.WIND_EVEN_ODD);
        for (double[] ring : rings) {
            append(path, ring, camera);
            path.closePath();
        }
        return path;
    }

    private static Path2D line(List<double[]> parts, ThumbnailCamera camera) {
        Path2D path = new Path2D.Double();
        for (double[] part : parts) {
            append(path, part, camera);
        }
        return path;
    }

    private static void append(Path2D path, double[] coords, ThumbnailCamera camera) {
        for (int i = 0; i + 1 < coords.length; i += 2) {
            double x = camera.screenX(coords[i]);
            double y = camera.screenY(coords[i + 1]);
            if (i == 0) {
                path.moveTo(x, y);
            } else {
                path.lineTo(x, y);
            }
        }
    }

    private static BasicStroke roundStroke(double width) {
        return new BasicStroke((float) width, BasicStroke.CAP_ROUND, BasicStroke.JOIN_ROUND);
    }

    private static void stroke(Graphics2D g, Shape path, BasicStroke stroke, Color color) {
        if (!visible(path)) {
            return;
        }
        g.setStroke(stroke);
        g.setColor(color);
        g.draw(path);
    }

    /** 이미지(여유 포함)와 겹치는지. 수평·수직 선처럼 폭이 0인 범위도 1px 넓혀 판단한다. */
    private static boolean visible(Shape shape) {
        Rectangle2D bounds = shape.getBounds2D();
        return VIEW.intersects(
                bounds.getX() - 1, bounds.getY() - 1, bounds.getWidth() + 2, bounds.getHeight() + 2);
    }
}
