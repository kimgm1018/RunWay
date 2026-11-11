package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import com.runway.backend.domain.course.basemap.CourseBasemapRunService.Outcome;
import com.runway.backend.domain.image.ImageStorage;
import com.runway.backend.domain.image.ImageStorageProperties;
import com.runway.backend.domain.image.VolumeImageStorage;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.awt.image.BufferedImage;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 코스 썸네일 생성(받기→그리기→볼륨 저장→행 저장)·일괄 채우기 — 612. Route 호출은 테스트용 포트로 바꾸고 이미지는 임시 볼륨에, DB는
 * 실제 마이그레이션 스키마에 쓴다. 모든 값은 합성 데이터다.
 */
class CourseBasemapIntegrationTest extends SharedContextIntegrationSupport {

    private static final Instant OSM_TIME = Instant.parse("2026-10-20T00:00:00Z");
    private static final Instant BUILDINGS_TIME = Instant.parse("2026-10-21T00:00:00Z");
    private static final List<BasemapFeature> FEATURES =
            List.of(
                    new BasemapFeature(
                            Kind.ROAD,
                            RoadClass.PRIMARY,
                            false,
                            List.<double[]>of(new double[] {129.0, 35.0, 129.02, 35.01}),
                            0),
                    new BasemapFeature(
                            Kind.BUILDING,
                            null,
                            true,
                            List.<double[]>of(
                                    new double[] {
                                        129.005, 35.004, 129.006, 35.004, 129.006, 35.005, 129.005,
                                        35.005, 129.005, 35.004
                                    }),
                            30));

    @Autowired private JdbcTemplate jdbc;
    @Autowired private CourseBasemapRepository repository;
    @Autowired private com.runway.backend.domain.image.ImageAccessRepository imageAccess;

    @TempDir Path volume;

    private ImageStorage storage;

    /** 호출을 기록하고 정해 둔 결과를 돌려주는 포트. */
    private static class ScriptedPort implements CourseBasemapPort {
        final List<Long> calls = new CopyOnWriteArrayList<>();
        final List<BasemapBbox> boxes = new CopyOnWriteArrayList<>();
        volatile boolean configured = true;
        volatile BasemapResult result = new Success(FEATURES, OSM_TIME, true, BUILDINGS_TIME);
        volatile CountDownLatch gate;
        /** Route 응답 직전에 할 일(다른 실행이 먼저 저장·코스 삭제 같은 경쟁 재현). */
        volatile Runnable beforeReturn;

        @Override
        public boolean isConfigured() {
            return configured;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public BasemapResult fetch(long courseId, BasemapBbox bbox, double metersPerPixel) {
            calls.add(courseId);
            boxes.add(bbox);
            CountDownLatch waitFor = gate;
            if (waitFor != null) {
                try {
                    waitFor.await(5, TimeUnit.SECONDS);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                }
            }
            Runnable hook = beforeReturn;
            if (hook != null) {
                hook.run();
            }
            return result;
        }
    }

    /** 저장을 항상 실패시키는 볼륨(디스크 오류 대역). */
    private static final class FailingStorage extends VolumeImageStorage {
        FailingStorage(ImageStorageProperties properties) {
            super(properties);
        }

        @Override
        public void store(String imageKey, InputStream content, long contentLength) {
            throw new IllegalStateException("synthetic volume failure");
        }
    }

    @BeforeEach
    void storage() {
        storage = new VolumeImageStorage(properties(volume));
    }

    private static ImageStorageProperties properties(Path root) {
        ImageStorageProperties properties = new ImageStorageProperties();
        properties.setVolumePath(root.toString());
        return properties;
    }

    private CourseBasemapRunService service(CourseBasemapPort port) {
        return new CourseBasemapRunService(repository, port, new CourseThumbnailRenderer(), storage);
    }

    private long course(String status) {
        return jdbc.queryForObject(
                """
                INSERT INTO courses(route,start_position,distance,status)
                VALUES (ST_GeogFromText('LINESTRING(129.0 35.0, 129.01 35.005, 129.02 35.01)'),
                        ST_GeogFromText('POINT(129.0 35.0)'), 2500, ?::courses_status_enum)
                RETURNING id
                """,
                Long.class,
                status);
    }

    private long mergedCourse(long targetId) {
        long id = course("ACTIVE");
        jdbc.update(
                "UPDATE courses SET status='MERGED', merged_into_course_id=? WHERE id=?",
                targetId,
                id);
        return id;
    }

    private int rows(long courseId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM course_basemaps WHERE course_id=?", Integer.class, courseId);
    }

    private Map<String, Object> row(long courseId) {
        return jdbc.queryForMap(
                "SELECT image_key, osm_data_timestamp, buildings_osm_data_timestamp, render_version"
                        + " FROM course_basemaps WHERE course_id=?",
                courseId);
    }

    private long pngFiles() throws Exception {
        if (!Files.exists(volume)) {
            return 0;
        }
        try (Stream<Path> files = Files.walk(volume)) {
            return files.filter(p -> p.toString().endsWith(".png")).count();
        }
    }

    private static CourseBasemapProperties properties(boolean backfill, int limit) {
        CourseBasemapProperties properties = new CourseBasemapProperties();
        properties.setBackfillOnStartup(backfill);
        properties.setBackfillLimit(limit);
        properties.setBackfillInterval(Duration.ZERO);
        properties.setBackfillRetryDelay(Duration.ZERO);
        return properties;
    }

    // --- 생성·저장 ---

    @Test
    void 성공하면_PNG를_볼륨에_저장하고_코스당_한_행을_저장한다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();

        Outcome outcome = service(port).run(courseId);

        assertThat(outcome).isEqualTo(Outcome.SAVED);
        assertThat(port.calls).containsExactly(courseId);
        assertThat(rows(courseId)).isEqualTo(1);
        Map<String, Object> row = row(courseId);
        String imageKey = (String) row.get("image_key");
        assertThat(imageKey)
                .matches(
                        "images/course-basemap/"
                                + courseId
                                + "/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png");
        assertThat(row.get("render_version")).isEqualTo(CourseBasemapRunService.RENDER_VERSION);
        assertThat(repository.find(courseId))
                .hasValueSatisfying(
                        stored -> {
                            assertThat(stored.imageKey()).isEqualTo(imageKey);
                            assertThat(stored.osmDataTimestamp()).isEqualTo(OSM_TIME);
                        });
        assertThat(
                        jdbc.queryForObject(
                                "SELECT buildings_osm_data_timestamp = ?::timestamptz FROM course_basemaps WHERE course_id=?",
                                Boolean.class,
                                BUILDINGS_TIME.toString(),
                                courseId))
                .isTrue();
        BufferedImage image = ImageIO.read(volume.resolve(imageKey).toFile());
        assertThat(image.getWidth()).isEqualTo(600);
        assertThat(image.getHeight()).isEqualTo(900);
        // 경로 범위(129.0~129.02, 35.0~35.01)를 감싸는 범위만 보낸다.
        BasemapBbox bbox = port.boxes.get(0);
        assertThat(bbox.west()).isLessThan(129.0);
        assertThat(bbox.east()).isGreaterThan(129.02);
        assertThat(bbox.south()).isLessThan(35.0);
        assertThat(bbox.north()).isGreaterThan(35.01);
    }

    @Test
    void 같은_그리기_버전으로_저장된_코스는_Route를_부르지_않는다() {
        long courseId = course("ACTIVE");
        repository.upsert(courseId, null, null, null, CourseBasemapRunService.RENDER_VERSION);
        ScriptedPort port = new ScriptedPort();

        Outcome outcome = service(port).run(courseId);

        assertThat(outcome).isEqualTo(Outcome.ALREADY_SAVED);
        assertThat(port.calls).isEmpty();
    }

    @Test
    void 이전_그리기_버전_행은_다시_그려_바꾼다() throws Exception {
        long courseId = course("ACTIVE");
        jdbc.update(
                "INSERT INTO course_basemaps(course_id, image_key, render_version) VALUES (?, NULL, 'old-v0')",
                courseId);
        ScriptedPort port = new ScriptedPort();

        assertThat(repository.findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 10))
                .containsExactly(courseId);
        Outcome outcome = service(port).run(courseId);

        assertThat(outcome).isEqualTo(Outcome.SAVED);
        assertThat(port.calls).containsExactly(courseId);
        assertThat(rows(courseId)).isEqualTo(1);
        Map<String, Object> row = row(courseId);
        assertThat(row.get("render_version")).isEqualTo(CourseBasemapRunService.RENDER_VERSION);
        assertThat((String) row.get("image_key")).startsWith("images/course-basemap/" + courseId + "/");
        assertThat(pngFiles()).isEqualTo(1);
        assertThat(repository.findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 10))
                .isEmpty();
    }

    @Test
    void Route_실패면_저장하지_않는다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        port.result = new CourseBasemapPort.Failure("HTTP_503_NOT_READY");

        Outcome outcome = service(port).run(courseId);

        // 503은 Route가 잠깐 멈춘 실패라 일괄 채우기가 같은 실행 안에서 한 번 더 시도할 수 있다.
        assertThat(outcome).isEqualTo(Outcome.FAILED_RETRYABLE);
        assertThat(rows(courseId)).isZero();
        assertThat(pngFiles()).isZero();

        port.result = new CourseBasemapPort.Failure("INVALID_RESPONSE");
        assertThat(service(port).run(courseId)).isEqualTo(Outcome.FAILED);
    }

    @Test
    void 저장_경쟁에서_지면_방금_쓴_PNG를_지운다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        String winner = "images/course-basemap/" + courseId + "/00000000-0000-4000-8000-000000000001.png";
        // 이 실행이 그리는 동안 다른 실행이 같은 버전 행을 먼저 저장한다.
        port.beforeReturn =
                () -> repository.upsert(courseId, winner, null, null, CourseBasemapRunService.RENDER_VERSION);

        assertThat(service(port).run(courseId)).isEqualTo(Outcome.ALREADY_SAVED);

        assertThat(row(courseId).get("image_key")).isEqualTo(winner);
        assertThat(pngFiles()).isZero();
    }

    @Test
    void 행_저장이_실패하면_방금_쓴_PNG를_지운다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        // 그리는 동안 코스가 지워져 행 저장이 FK 위반으로 실패한다.
        port.beforeReturn = () -> jdbc.update("DELETE FROM courses WHERE id=?", courseId);

        assertThatThrownBy(() -> service(port).run(courseId)).isInstanceOf(RuntimeException.class);

        assertThat(rows(courseId)).isZero();
        assertThat(pngFiles()).isZero();
    }

    @Test
    void 썸네일_PNG_삭제는_코스_썸네일_키_형식만_받는다() throws Exception {
        String key = "images/course-basemap/7/00000000-0000-4000-8000-000000000002.png";
        storage.store(key, new java.io.ByteArrayInputStream(new byte[] {1}), 1);
        storage.store("images/profile/7/00000000-0000-4000-8000-000000000003.png",
                new java.io.ByteArrayInputStream(new byte[] {1}), 1);

        storage.deleteCourseBasemap(key);
        storage.deleteCourseBasemap(key); // 없으면 아무것도 하지 않는다.

        assertThat(storage.exists(key)).isFalse();
        for (String other :
                List.of(
                        "images/profile/7/00000000-0000-4000-8000-000000000003.png",
                        "images/course-basemap/7/../../profile/7/00000000-0000-4000-8000-000000000003.png",
                        "images/course-basemap/7/x.png")) {
            assertThatThrownBy(() -> storage.deleteCourseBasemap(other))
                    .isInstanceOf(RuntimeException.class);
        }
        assertThat(storage.exists("images/profile/7/00000000-0000-4000-8000-000000000003.png")).isTrue();
    }

    @Test
    void 볼륨_저장에_실패하면_행을_저장하지_않는다() {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        CourseBasemapRunService failing =
                new CourseBasemapRunService(
                        repository, port, new CourseThumbnailRenderer(), new FailingStorage(properties(volume)));

        assertThat(failing.run(courseId)).isEqualTo(Outcome.FAILED);
        assertThat(rows(courseId)).isZero();
    }

    @Test
    void 범위_밖이면_이미지_없는_행으로_저장해_다시_부르지_않는다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        port.result = new CourseBasemapPort.OutOfArea();
        CourseBasemapRunService service = service(port);

        assertThat(service.run(courseId)).isEqualTo(Outcome.SAVED_EMPTY);
        Map<String, Object> row = row(courseId);
        assertThat(row.get("image_key")).isNull();
        assertThat(row.get("osm_data_timestamp")).isNull();
        assertThat(row.get("render_version")).isEqualTo(CourseBasemapRunService.RENDER_VERSION);
        assertThat(pngFiles()).isZero();

        assertThat(service.run(courseId)).isEqualTo(Outcome.ALREADY_SAVED);
        assertThat(port.calls).hasSize(1);
        assertThat(repository.findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 10))
                .doesNotContain(courseId);
    }

    @Test
    void ACTIVE가_아니거나_없는_코스와_주소_미설정은_Route를_부르지_않는다() {
        long target = course("ACTIVE");
        long merged = mergedCourse(target);
        ScriptedPort port = new ScriptedPort();
        CourseBasemapRunService service = service(port);

        assertThat(service.run(merged)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service.run(9_999_999L)).isEqualTo(Outcome.NOT_ELIGIBLE);
        port.configured = false;
        assertThat(service.run(target)).isEqualTo(Outcome.NOT_CONFIGURED);
        assertThat(port.calls).isEmpty();
    }

    @Test
    void 같은_코스_작업이_겹쳐도_Route는_한_번이고_행은_하나다() throws Exception {
        long courseId = course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        port.gate = new CountDownLatch(1);
        CourseBasemapDispatcher dispatcher =
                new CourseBasemapDispatcher(service(port), properties(false, 10));
        try {
            dispatcher.dispatch(courseId);
            dispatcher.dispatch(courseId);
            dispatcher.dispatch(courseId);
            port.gate.countDown();
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(20))).isTrue();

            assertThat(port.calls).hasSize(1);
            assertThat(rows(courseId)).isEqualTo(1);

            // 끝난 뒤 다시 들어와도 같은 버전 행이 있어 부르지 않는다.
            dispatcher.dispatch(courseId);
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(20))).isTrue();
            assertThat(port.calls).hasSize(1);
            assertThat(pngFiles()).isEqualTo(1);
        } finally {
            dispatcher.destroy();
        }
    }

    @Test
    void 저장_경쟁에서_같은_버전의_늦은_쪽은_기존_행을_바꾸지_않는다() {
        long courseId = course("ACTIVE");
        String version = CourseBasemapRunService.RENDER_VERSION;

        assertThat(repository.upsert(courseId, "images/course-basemap/1/a.png", null, null, version)).isTrue();
        assertThat(repository.upsert(courseId, "images/course-basemap/1/b.png", null, null, version)).isFalse();
        // 다른 버전이면 바꾼다.
        assertThat(repository.upsert(courseId, "images/course-basemap/1/c.png", null, null, "next")).isTrue();

        assertThat(rows(courseId)).isEqualTo(1);
        assertThat(row(courseId).get("image_key")).isEqualTo("images/course-basemap/1/c.png");
    }

    @Test
    void 이미지_조회는_파일_이름_색인으로_썸네일_행을_찾는다() {
        long courseId = course("ACTIVE");
        long other = course("ACTIVE");
        String file = "00000000-0000-4000-8000-0000000000aa.png";
        repository.upsert(courseId, "images/course-basemap/" + courseId + "/" + file, null, null, "flat-v1");
        // 다른 코스 폴더를 가리키는 키는 내주지 않는다.
        String foreign = "00000000-0000-4000-8000-0000000000ac.png";
        repository.upsert(other, "images/course-basemap/" + courseId + "/" + foreign, null, null, "flat-v1");

        assertThat(imageAccess.findCourseBasemapKeys(file))
                .containsExactly("images/course-basemap/" + courseId + "/" + file);
        assertThat(imageAccess.findCourseBasemapKeys(foreign)).isEmpty();
        assertThat(imageAccess.findCourseBasemapKeys("00000000-0000-4000-8000-0000000000ab.png")).isEmpty();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT indexdef FROM pg_indexes WHERE tablename='course_basemaps'"
                                        + " AND indexname='idx_course_basemaps_image_file'",
                                String.class))
                .contains("split_part((image_key)::text, '/'::text, 4)");
    }

    // --- 기동 시 일괄 채우기 ---

    @Test
    void 일괄_채우기는_현재_버전_썸네일이_없는_ACTIVE_코스만_넣는다() throws Exception {
        long missingA = course("ACTIVE");
        long missingB = course("ACTIVE");
        long stored = course("ACTIVE");
        repository.upsert(stored, null, null, null, CourseBasemapRunService.RENDER_VERSION);
        long outdated = course("ACTIVE");
        repository.upsert(outdated, null, null, null, "old-v0");
        long merged = mergedCourse(stored);
        ScriptedPort port = new ScriptedPort();
        CourseBasemapProperties properties = properties(true, 500);
        CourseBasemapDispatcher dispatcher = new CourseBasemapDispatcher(service(port), properties);
        try {
            int submitted =
                    new CourseBasemapBackfill(repository, dispatcher, port, properties).submit();
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(30))).isTrue();

            assertThat(submitted).isEqualTo(3);
            assertThat(port.calls).containsExactlyInAnyOrder(missingA, missingB, outdated);
            assertThat(rows(missingA)).isEqualTo(1);
            assertThat(rows(missingB)).isEqualTo(1);
            assertThat(row(outdated).get("render_version"))
                    .isEqualTo(CourseBasemapRunService.RENDER_VERSION);
            assertThat(rows(merged)).isZero();
            assertThat(
                            repository.findActiveCourseIdsNeedingRender(
                                    CourseBasemapRunService.RENDER_VERSION, 500))
                    .isEmpty();
        } finally {
            dispatcher.destroy();
        }
    }

    @Test
    void 일괄_채우기는_상한만큼만_ID_순서로_넣는다() {
        long first = course("ACTIVE");
        long second = course("ACTIVE");
        course("ACTIVE");

        assertThat(repository.findActiveCourseIdsNeedingRender(CourseBasemapRunService.RENDER_VERSION, 2))
                .containsExactly(first, second);
    }

    @Test
    void 설정이_꺼져_있거나_주소가_없으면_일괄_채우기를_하지_않는다() throws Exception {
        course("ACTIVE");
        ScriptedPort port = new ScriptedPort();
        CourseBasemapProperties off = properties(false, 500);
        CourseBasemapDispatcher dispatcher = new CourseBasemapDispatcher(service(port), off);
        try {
            assertThat(new CourseBasemapBackfill(repository, dispatcher, port, off).submit())
                    .isZero();

            port.configured = false;
            CourseBasemapProperties on = properties(true, 500);
            assertThat(new CourseBasemapBackfill(repository, dispatcher, port, on).submit())
                    .isZero();
            assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
            assertThat(port.calls).isEmpty();
        } finally {
            dispatcher.destroy();
        }
    }
}
