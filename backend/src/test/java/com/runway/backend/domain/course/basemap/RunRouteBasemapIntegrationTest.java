package com.runway.backend.domain.course.basemap;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.course.basemap.BasemapFeature.Kind;
import com.runway.backend.domain.course.basemap.BasemapFeature.RoadClass;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.BasemapResult;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Failure;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.OutOfArea;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Success;
import com.runway.backend.domain.course.basemap.CourseBasemapRunService.Outcome;
import com.runway.backend.domain.image.ImageStorage;
import com.runway.backend.domain.session.service.SessionRouteService;
import com.runway.backend.domain.user.repository.WithdrawalRepository;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.awt.image.BufferedImage;
import java.io.ByteArrayInputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicInteger;
import javax.imageio.ImageIO;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;

/**
 * 본인 기록 경로 썸네일(S15P31E105-756, ADR-0024): 생성(받기→그리기→볼륨 저장→행 저장), 일괄 채우기 대상, F02 본인 전용 조회, H01·H02
 * {@code routePreviewImageUrl}, 탈퇴 정리. Route 호출은 테스트용 포트로 바꾸고 이미지는 임시 볼륨에, DB는 전용 마이그레이션 스키마에 쓴다.
 * 모든 좌표·사용자는 합성 값이다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class RunRouteBasemapIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(RunRouteBasemapIntegrationTest.class);

    @TempDir static Path IMAGE_VOLUME;

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.images.volume-path", () -> IMAGE_VOLUME.toString());
    }

    private static final Instant OSM_TIME = Instant.parse("2026-10-20T00:00:00Z");
    private static final List<BasemapFeature> FEATURES =
            List.of(
                    new BasemapFeature(
                            Kind.ROAD,
                            RoadClass.PRIMARY,
                            false,
                            List.<double[]>of(new double[] {127.0, 37.5, 127.003, 37.501}),
                            0));
    private static final AtomicInteger USERS = new AtomicInteger();

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private RunRouteBasemapRepository repository;
    @Autowired private SessionRouteService sessionRouteService;
    @Autowired private ImageStorage storage;
    @Autowired private WithdrawalRepository withdrawalRepository;

    private long ownerId;
    private long otherId;

    /** 호출을 기록하고 정해 둔 결과를 돌려주는 포트. */
    private static class ScriptedPort implements CourseBasemapPort {
        final List<Long> calls = new CopyOnWriteArrayList<>();
        volatile BasemapResult result = new Success(FEATURES, OSM_TIME, true, null);
        /** Route 응답 직전에 할 일(다른 실행이 먼저 저장·탈퇴 확정 같은 경쟁 재현). */
        volatile Runnable beforeReturn;

        @Override
        public boolean isConfigured() {
            return true;
        }

        @Override
        public boolean isReady() {
            return true;
        }

        @Override
        public BasemapResult fetch(long id, BasemapBbox bbox, double metersPerPixel) {
            calls.add(id);
            Runnable hook = beforeReturn;
            if (hook != null) {
                hook.run();
            }
            return result;
        }
    }

    @BeforeEach
    void seed() {
        ownerId = user();
        otherId = user();
    }

    private RunRouteBasemapRunService service(CourseBasemapPort port) {
        return new RunRouteBasemapRunService(
                repository, sessionRouteService, port, new CourseThumbnailRenderer(), storage);
    }

    private long user() {
        int n = USERS.incrementAndGet();
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE')
                RETURNING id
                """,
                Long.class,
                "rr_user_" + n,
                "기록러너" + n,
                String.format("010%08d", 60000000 + n));
    }

    private long session(long userId, String status, String endedAt) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status, started_at, ended_at, total_distance, moving_duration)
                VALUES (?, ?::running_sessions_status_enum,
                        COALESCE(?::timestamptz - interval '1 hour', '2026-03-01T10:00:00Z'::timestamptz),
                        ?::timestamptz, 500, 300)
                RETURNING id
                """,
                Long.class,
                userId,
                status,
                endedAt,
                endedAt);
    }

    private long completed(long userId) {
        return session(userId, "COMPLETED", "2026-03-01T11:00:00Z");
    }

    /** 세션 시작 기준 sec초 뒤 위도 37.5의 합성 위치(정확도 5 m, 출처 PHONE). */
    private void point(long session, int sec, double lng) {
        jdbc.update(
                """
                INSERT INTO running_route_points(running_session_id,measured_at,position,accuracy)
                SELECT ?, s.started_at + make_interval(secs => ?),
                       ST_SetSRID(ST_MakePoint(?, 37.5), 4326)::geography, 5
                  FROM running_sessions s WHERE s.id = ?
                """,
                session,
                (double) sec,
                lng,
                session);
    }

    /** 약 130 m(경도 0.0005 ≈ 44 m씩 세 구간)의 한 조각 경로. */
    private void route(long session) {
        for (int i = 0; i < 4; i++) {
            point(session, i * 10, 127.0 + i * 0.0005);
        }
    }

    private Map<String, Object> row(long session) {
        return jdbc.queryForMap(
                "SELECT image_key, osm_data_timestamp, render_version FROM running_session_basemaps WHERE running_session_id=?",
                session);
    }

    private int rows(long session) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM running_session_basemaps WHERE running_session_id=?",
                Integer.class,
                session);
    }

    private static String imageId(String key) {
        String file = key.substring(key.lastIndexOf('/') + 1);
        return file.substring(0, file.length() - ".png".length());
    }

    // --- 생성 (AC-1, AC-2) ---

    @Test
    void 완료_기록의_경로로_본인_디렉터리에_600x900_PNG를_그리고_행을_저장한다() throws Exception {
        long session = completed(ownerId);
        route(session);
        ScriptedPort port = new ScriptedPort();

        assertThat(service(port).run(session)).isEqualTo(Outcome.SAVED);

        assertThat(port.calls).containsExactly(session);
        Map<String, Object> row = row(session);
        String key = (String) row.get("image_key");
        assertThat(key).matches("images/run-route/" + ownerId + "/[0-9a-f-]{36}\\.png");
        assertThat(row.get("render_version")).isEqualTo(RunRouteBasemapRunService.RENDER_VERSION);
        BufferedImage png = ImageIO.read(IMAGE_VOLUME.resolve(key).toFile());
        assertThat(png.getWidth()).isEqualTo(600);
        assertThat(png.getHeight()).isEqualTo(900);
        // 같은 버전이 있으면 다시 그리지 않는다.
        assertThat(service(port).run(session)).isEqualTo(Outcome.ALREADY_SAVED);
        assertThat(port.calls).hasSize(1);
    }

    @Test
    void 경로가_없거나_50m_미만이면_Route를_부르지_않고_이미지_없이_저장한다() {
        long none = completed(ownerId);
        long tiny = completed(ownerId);
        point(tiny, 0, 127.0);
        point(tiny, 10, 127.0003); // 약 26 m
        ScriptedPort port = new ScriptedPort();

        assertThat(service(port).run(none)).isEqualTo(Outcome.SAVED_EMPTY);
        assertThat(service(port).run(tiny)).isEqualTo(Outcome.SAVED_EMPTY);

        assertThat(port.calls).isEmpty();
        assertThat(row(none).get("image_key")).isNull();
        assertThat(row(tiny).get("image_key")).isNull();
    }

    @Test
    void 범위_밖은_이미지_없이_저장하고_일시_실패는_저장하지_않는다() throws Exception {
        long outside = completed(ownerId);
        route(outside);
        long busy = completed(ownerId);
        route(busy);
        ScriptedPort port = new ScriptedPort();

        port.result = new OutOfArea();
        assertThat(service(port).run(outside)).isEqualTo(Outcome.SAVED_EMPTY);
        port.result = new Failure("HTTP_503");
        assertThat(service(port).run(busy)).isEqualTo(Outcome.FAILED_RETRYABLE);

        assertThat(row(outside).get("image_key")).isNull();
        assertThat(rows(busy)).isZero();
        Path dir = IMAGE_VOLUME.resolve("images/run-route/" + ownerId);
        assertThat(Files.exists(dir) ? Files.list(dir).count() : 0).isZero();
    }

    @Test
    void 진행_중이거나_삭제된_기록은_그리지_않는다() {
        long running = session(ownerId, "RUNNING", null);
        route(running);
        long deleted = completed(ownerId);
        route(deleted);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);
        ScriptedPort port = new ScriptedPort();

        assertThat(service(port).run(running)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(service(port).run(deleted)).isEqualTo(Outcome.NOT_ELIGIBLE);
        assertThat(port.calls).isEmpty();
        assertThat(rows(running) + rows(deleted)).isZero();
    }

    // --- 일괄 채우기 대상 (AC-3) ---

    @Test
    void 일괄_채우기는_현재_버전이_없는_활성_사용자의_완료_기록만_최신순으로_고른다() {
        long older = session(ownerId, "COMPLETED", "2026-03-01T11:00:00Z");
        long newer = session(ownerId, "COMPLETED", "2026-03-02T11:00:00Z");
        long outdated = session(otherId, "COMPLETED", "2026-03-01T12:00:00Z");
        repository.upsert(outdated, null, null, null, "old-v0");
        long stored = completed(ownerId);
        repository.upsert(stored, null, null, null, RunRouteBasemapRunService.RENDER_VERSION);
        session(ownerId, "RUNNING", null);
        long deleted = completed(ownerId);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);
        long withdrawnUser = user();
        completed(withdrawnUser);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                withdrawnUser);

        List<Long> targets =
                repository.findSessionIdsNeedingRender(RunRouteBasemapRunService.RENDER_VERSION, 10);

        assertThat(targets).containsExactly(newer, outdated, older);
        assertThat(repository.findSessionIdsNeedingRender(RunRouteBasemapRunService.RENDER_VERSION, 1))
                .containsExactly(newer);
    }

    // --- F02 본인 전용 조회 (AC-4, AC-5, AC-6) ---

    private String rendered(long session) {
        route(session);
        assertThat(service(new ScriptedPort()).run(session)).isEqualTo(Outcome.SAVED);
        return (String) row(session).get("image_key");
    }

    @Test
    void 기록_썸네일은_주인만_받고_공유_캐시를_막는다() throws Exception {
        long session = completed(ownerId);
        String key = rendered(session);
        byte[] png = Files.readAllBytes(IMAGE_VOLUME.resolve(key));

        mockMvc.perform(
                        get("/api/v1/images/{id}", imageId(key))
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", "image/png"))
                .andExpect(header().string("Cache-Control", "private, max-age=31536000, immutable"))
                .andExpect(header().string("Vary", "Authorization"))
                .andExpect(content().bytes(png));
        mockMvc.perform(get("/api/v1/images/{id}", imageId(key)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("IMAGE_NOT_FOUND"));
        mockMvc.perform(
                        get("/api/v1/images/{id}", imageId(key))
                                .header("Authorization", SecurityTestSupport.bearer(otherId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("IMAGE_NOT_FOUND"));
    }

    @Test
    void 삭제한_기록과_탈퇴한_주인의_썸네일은_404다() throws Exception {
        long deleted = completed(ownerId);
        String deletedKey = rendered(deleted);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);

        mockMvc.perform(
                        get("/api/v1/images/{id}", imageId(deletedKey))
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isNotFound());

        long leaving = user();
        long session = completed(leaving);
        String key = rendered(session);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                leaving);
        // 탈퇴 사용자의 남은 토큰으로도 그림을 받지 못한다(F02: 존재를 숨기는 404).
        mockMvc.perform(
                        get("/api/v1/images/{id}", imageId(key))
                                .header("Authorization", SecurityTestSupport.bearer(leaving)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("IMAGE_NOT_FOUND"));
    }

    @Test
    void 행이_참조하지_않는_run_route_파일은_주인에게도_404다() throws Exception {
        String stray = "images/run-route/" + ownerId + "/00000000-0000-4000-8000-0000000000aa.png";
        storage.store(stray, new ByteArrayInputStream(new byte[] {1, 2, 3}), 3);

        mockMvc.perform(
                        get("/api/v1/images/{id}", "00000000-0000-4000-8000-0000000000aa")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isNotFound());
    }

    // --- H01·H02 (AC-7) ---

    @Test
    void H01과_H02는_그림이_있는_기록에만_routePreviewImageUrl을_준다() throws Exception {
        long withImage = session(ownerId, "COMPLETED", "2026-03-03T11:00:00Z");
        String key = rendered(withImage);
        long empty = session(ownerId, "COMPLETED", "2026-03-02T11:00:00Z");
        repository.upsert(empty, null, null, null, RunRouteBasemapRunService.RENDER_VERSION);
        long none = session(ownerId, "COMPLETED", "2026-03-01T11:00:00Z");

        mockMvc.perform(
                        get("/api/v1/running-records")
                                .param("runType", "SOLO")
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[0].id").value(withImage))
                .andExpect(jsonPath("$.items[0].routePreviewImageUrl").value("/api/v1/images/" + imageId(key)))
                .andExpect(jsonPath("$.items[1].id").value(empty))
                .andExpect(jsonPath("$.items[1].routePreviewImageUrl").doesNotExist())
                .andExpect(jsonPath("$.items[2].id").value(none))
                .andExpect(jsonPath("$.items[2].routePreviewImageUrl").doesNotExist());

        mockMvc.perform(
                        get("/api/v1/running-records/{id}", withImage)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.routePreviewImageUrl").value("/api/v1/images/" + imageId(key)));
        mockMvc.perform(
                        get("/api/v1/running-records/{id}", none)
                                .header("Authorization", SecurityTestSupport.bearer(ownerId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.routePreviewImageUrl").value(org.hamcrest.Matchers.nullValue()));
    }

    // --- 탈퇴 정리 (AC-6) ---

    @Test
    void 탈퇴_정리는_행과_run_route_파일을_지우고_탈퇴_뒤_저장은_거부된다() throws Exception {
        long session = completed(ownerId);
        String key = rendered(session);
        long later = completed(ownerId);

        // 실제 탈퇴 순서(WithdrawalTransactions): 정리 뒤 탈퇴 확정, 커밋 뒤 개인 이미지 파일 삭제.
        withdrawalRepository.scrub(ownerId, Instant.now());
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                ownerId);
        storage.deletePersonalImages(ownerId);
        // 탈퇴가 확정된 뒤 늦게 끝난 생성은 행을 저장하지 못한다(V17 rw_active_owner).
        assertThatThrownBy(
                        () ->
                                repository.upsert(
                                        later, null, null, null, RunRouteBasemapRunService.RENDER_VERSION))
                .hasMessageContaining("Resource owner is not active");

        assertThat(rows(session)).isZero();
        assertThat(Files.exists(IMAGE_VOLUME.resolve(key))).isFalse();
    }

    // --- 경쟁·실패 뒤 정리, 종료 커밋 연결 (AC-1, AC-6; 리뷰 A-1·B-5) ---

    private long pngCount(long userId) throws Exception {
        Path dir = IMAGE_VOLUME.resolve("images/run-route/" + userId);
        if (!Files.exists(dir)) {
            return 0;
        }
        try (var files = Files.list(dir)) {
            return files.filter(p -> p.toString().endsWith(".png")).count();
        }
    }

    @Test
    void 같은_버전을_다른_실행이_먼저_저장하면_방금_쓴_PNG를_지운다() throws Exception {
        long session = completed(ownerId);
        route(session);
        ScriptedPort port = new ScriptedPort();
        port.beforeReturn =
                () -> repository.upsert(
                        session, null, null, null, RunRouteBasemapRunService.RENDER_VERSION);

        assertThat(service(port).run(session)).isEqualTo(Outcome.ALREADY_SAVED);

        assertThat(row(session).get("image_key")).isNull();
        assertThat(pngCount(ownerId)).isZero();
    }

    @Test
    void 그리는_중에_탈퇴가_확정되면_행을_저장하지_않고_방금_쓴_PNG를_지운다() throws Exception {
        long session = completed(ownerId);
        route(session);
        ScriptedPort port = new ScriptedPort();
        port.beforeReturn =
                () -> {
                    withdrawalRepository.scrub(ownerId, Instant.now());
                    jdbc.update(
                            "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                            ownerId);
                };

        assertThatThrownBy(() -> service(port).run(session))
                .hasMessageContaining("Resource owner is not active");

        assertThat(rows(session)).isZero();
        assertThat(pngCount(ownerId)).isZero();
    }

    @Autowired private org.springframework.context.ApplicationEventPublisher events;
    @Autowired private org.springframework.transaction.PlatformTransactionManager transactions;
    @Autowired private CourseBasemapDispatcher dispatcher;

    @org.springframework.test.context.bean.override.mockito.MockitoBean
    private CourseBasemapPort routePort;

    @Test
    void 종료가_커밋되면_실행기가_썸네일을_저장하고_롤백되면_만들지_않는다() throws Exception {
        org.mockito.Mockito.when(routePort.isConfigured()).thenReturn(true);
        org.mockito.Mockito.when(
                        routePort.fetch(
                                org.mockito.ArgumentMatchers.anyLong(),
                                org.mockito.ArgumentMatchers.any(),
                                org.mockito.ArgumentMatchers.anyDouble()))
                .thenReturn(new Success(FEATURES, OSM_TIME, true, null));
        long committed = completed(ownerId);
        route(committed);
        long rolledBack = completed(ownerId);
        route(rolledBack);
        var template = new org.springframework.transaction.support.TransactionTemplate(transactions);

        template.executeWithoutResult(
                status ->
                        events.publishEvent(
                                new com.runway.backend.domain.session.service.PersonalSessionEndedEvent(
                                        committed, null, Instant.now())));
        template.executeWithoutResult(
                status -> {
                    events.publishEvent(
                            new com.runway.backend.domain.session.service.PersonalSessionEndedEvent(
                                    rolledBack, null, Instant.now()));
                    status.setRollbackOnly();
                });
        assertThat(dispatcher.awaitIdle(java.time.Duration.ofSeconds(30))).isTrue();

        assertThat((String) row(committed).get("image_key"))
                .startsWith("images/run-route/" + ownerId + "/");
        assertThat(rows(rolledBack)).isZero();
    }
}
