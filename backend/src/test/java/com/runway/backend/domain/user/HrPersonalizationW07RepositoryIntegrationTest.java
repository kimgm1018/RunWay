package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.user.personalization.W07MetricSample;
import com.runway.backend.domain.user.personalization.W07RoutePoint;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository.SessionHeader;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** AI06 입력 읽기 SQL 검증. 합성 값만 쓴다. */
class HrPersonalizationW07RepositoryIntegrationTest extends HrPersonalizationIntegrationSupport {

    private static final Instant T0 = Instant.parse("2026-11-01T00:00:00Z");

    @Autowired W07PersonalizationSessionRepository repository;

    /** 회원 삭제가 세션 FK에 막히지 않도록 이 테스트가 만든 행을 자식부터 지운다. */
    @AfterEach
    void cleanUp() {
        jdbc.update("DELETE FROM running_route_points");
        jdbc.update("DELETE FROM running_metric_samples");
        jdbc.update("DELETE FROM exercise_training_loads");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM user_devices");
    }

    private long session(long userId, String status, Instant startedAt, boolean deleted) {
        return jdbc.queryForObject(
                """
                INSERT INTO running_sessions(user_id, status, started_at, deleted_at)
                VALUES (?, ?::running_sessions_status_enum, ?::timestamptz,
                        CASE WHEN ? THEN now() ELSE NULL END)
                RETURNING id
                """,
                Long.class,
                userId,
                status,
                startedAt == null ? null : startedAt.toString(),
                deleted);
    }

    private long device(long userId, String type) {
        return jdbc.queryForObject(
                "INSERT INTO user_devices(user_id, device_type, linked_at)"
                        + " VALUES (?, ?::user_devices_device_type_enum, now()) RETURNING id",
                Long.class,
                userId,
                type);
    }

    @Test
    void 세션의_회원을_조회한다() {
        long id = session(user, "COMPLETED", T0, false);

        assertThat(repository.findUserIdBySessionId(id)).contains(user);
        assertThat(repository.findUserIdBySessionId(-1L)).isEmpty();
    }

    @Test
    void 완료_미삭제_러닝만_시작_최신순으로_limit까지_읽는다() {
        long oldest = session(user, "COMPLETED", T0, false);
        long newest = session(user, "COMPLETED", T0.plusSeconds(7200), false);
        long middle = session(user, "COMPLETED", T0.plusSeconds(3600), false);
        session(user, "COMPLETED", T0.plusSeconds(9000), true); // 삭제됨
        session(user, "CANCELLED", T0.plusSeconds(9100), false);
        session(user, "RUNNING", T0.plusSeconds(9200), false);
        session(user, "COMPLETED", null, false); // 시작 시각 없음
        session(other, "COMPLETED", T0.plusSeconds(9300), false); // 다른 회원

        List<SessionHeader> all = repository.findCompletedSessions(user, 100);
        List<SessionHeader> limited = repository.findCompletedSessions(user, 2);

        assertThat(all).extracting(SessionHeader::sessionId).containsExactly(newest, middle, oldest);
        assertThat(all.getFirst().startedAt()).isEqualTo(T0.plusSeconds(7200));
        assertThat(limited).extracting(SessionHeader::sessionId).containsExactly(newest, middle);
    }

    @Test
    void 샘플을_시각순으로_읽고_없는_값은_null이다() {
        long id = session(user, "COMPLETED", T0, false);
        jdbc.update(
                """
                INSERT INTO running_metric_samples(
                    running_session_id, measured_at, elapsed_duration, heart_rate,
                    speed, total_distance, is_hr_measured)
                VALUES (?, '2026-11-01T00:00:10.123456Z', 10, 131.5, 3.250, 30.5, true),
                       (?, '2026-11-01T00:00:05Z', 5, NULL, NULL, NULL, false)
                """,
                id,
                id);

        List<W07MetricSample> samples = repository.findSamples(id);

        assertThat(samples).hasSize(2);
        W07MetricSample first = samples.get(0);
        assertThat(first.measuredAt()).isEqualTo(T0.plusSeconds(5));
        assertThat(first.heartRate()).isNull();
        assertThat(first.totalDistance()).isNull();
        assertThat(first.speed()).isNull();
        assertThat(first.hrMeasured()).isFalse();
        W07MetricSample second = samples.get(1);
        assertThat(second.measuredAt()).isEqualTo(Instant.parse("2026-11-01T00:00:10.123456Z"));
        assertThat(second.heartRate()).isEqualTo(131.5);
        assertThat(second.speed()).isEqualTo(3.25);
        assertThat(second.totalDistance()).isEqualTo(30.5);
        assertThat(second.hrMeasured()).isTrue();
    }

    @Test
    void 경로점은_기기_종류를_붙이고_기기가_없으면_PHONE이다() {
        long id = session(user, "COMPLETED", T0, false);
        long watch = device(user, "WATCH");
        long phone = device(user, "PHONE");
        jdbc.update(
                """
                INSERT INTO running_route_points(running_session_id, measured_at, position, device_id)
                VALUES (?, '2026-11-01T00:00:02Z', ST_SetSRID(ST_MakePoint(129.0, 35.1), 4326)::geography, ?),
                       (?, '2026-11-01T00:00:01Z', ST_SetSRID(ST_MakePoint(129.0001, 35.1001), 4326)::geography, ?),
                       (?, '2026-11-01T00:00:03Z', ST_SetSRID(ST_MakePoint(129.0002, 35.1002), 4326)::geography, NULL)
                """,
                id,
                watch,
                id,
                phone,
                id);

        List<W07RoutePoint> points = repository.findRoutePoints(id);

        assertThat(points)
                .extracting(W07RoutePoint::deviceType)
                .containsExactly(
                        W07RoutePoint.DeviceType.PHONE,
                        W07RoutePoint.DeviceType.WATCH,
                        W07RoutePoint.DeviceType.PHONE);
        assertThat(points.get(1).longitude()).isEqualTo(129.0);
        assertThat(points.get(1).latitude()).isEqualTo(35.1);
        assertThat(points.get(0).measuredAt()).isEqualTo(T0.plusSeconds(1));
        assertThat(points.get(2).measuredAt()).isEqualTo(T0.plusSeconds(3));
    }
}
