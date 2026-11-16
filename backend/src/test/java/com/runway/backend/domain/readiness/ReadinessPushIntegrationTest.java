package com.runway.backend.domain.readiness;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.notification.push.PushDispatcher;
import com.runway.backend.domain.notification.push.PushMessage;
import com.runway.backend.domain.notification.push.PushSendResult;
import com.runway.backend.domain.notification.push.PushSender;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.domain.readiness.service.ReadinessEvaluationService;
import com.runway.backend.domain.readiness.service.ReadinessPushJob;
import com.runway.backend.domain.readiness.service.ReadinessPushNotifier;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.math.BigDecimal;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CountDownLatch;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;

/**
 * 847 오늘 준비도 푸시. 실제 DB의 알림함 행과 커밋 후 푸시(가짜 발송기)를 확인한다. 모든 점수는 합성 값이다. 08:00 작업 Bean은 테스트에서 꺼져 있어 같은
 * Bean들로 직접 만든다.
 */
@SpringBootTest
class ReadinessPushIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(ReadinessPushIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    @MockitoBean PushSender sender;

    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired ReadinessJdbcRepository repository;
    @Autowired ReadinessEvaluationService evaluationService;
    @Autowired NotificationService notifications;
    @Autowired ReadinessPushNotifier notifier;
    @Autowired PushDispatcher pushDispatcher;

    ReadinessPushJob job;
    LocalDate today;
    long user;
    int seq;

    @BeforeEach
    void seed() throws InterruptedException {
        avoidKstMidnight();
        awaitPush();
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        when(sender.enabled()).thenReturn(true);
        when(sender.send(any())).thenReturn(PushSendResult.SENT);
        job = new ReadinessPushJob(repository, evaluationService, notifier);
        today = evaluationService.today();
        user = member("AGREE");
        token(user, "rdy-device-123456");
    }

    /** 테스트와 서버가 각자 KST 오늘을 계산하므로 KST 자정 직전이면 날짜가 바뀐 뒤 시작한다. */
    static void avoidKstMidnight() throws InterruptedException {
        var zone = ReadinessEvaluationService.TODAY_ZONE;
        var now = Instant.now();
        var next = LocalDate.ofInstant(now, zone).plusDays(1).atStartOfDay(zone).toInstant();
        long left = Duration.between(now, next).toMillis();
        if (left < 15_000) {
            Thread.sleep(left + 100);
        }
    }

    long member(String consent) {
        int n = seq++;
        long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '00000000000', ?::users_health_data_access_enum)
                        RETURNING id
                        """,
                        Long.class,
                        "rpush" + n,
                        "rpush" + n,
                        consent);
        signup.insertSettings(id);
        jdbc.update("UPDATE user_settings SET group_notifications_enabled=TRUE WHERE user_id=?", id);
        return id;
    }

    void token(long userId, String token) {
        jdbc.update(
                "INSERT INTO push_device_tokens(user_id,token,platform) VALUES (?,?,'ANDROID')",
                userId,
                token);
    }

    long readiness(long userId, LocalDate date, String score) {
        return jdbc.queryForObject(
                "INSERT INTO daily_readiness(user_id,readiness_date,readiness_score,readiness_confidence)"
                        + " VALUES (?,?,?,'LOW'::daily_readiness_readiness_confidence_enum) RETURNING id",
                Long.class,
                userId,
                date,
                new BigDecimal(score));
    }

    void awaitPush() throws InterruptedException {
        assertThat(pushDispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
    }

    List<Map<String, Object>> rows(long userId) {
        return jdbc.queryForList(
                "SELECT id, notification_type, target_id, message, dedupe_key, delivery_status::text AS status"
                        + " FROM notifications WHERE user_id=? ORDER BY id",
                userId);
    }

    /** T-2 (AC-1). */
    @Test
    void 정기_발송은_오늘_실제_점수로_알림함_행과_푸시를_만든다() throws Exception {
        long readinessId = readiness(user, today, "72.50");

        assertThat(job.sendToday()).isEqualTo(1);
        awaitPush();

        var rows = rows(user);
        assertThat(rows).hasSize(1);
        var row = rows.getFirst();
        assertThat(row.get("notification_type")).isEqualTo("READINESS_TODAY");
        assertThat(((Number) row.get("target_id")).longValue()).isEqualTo(readinessId);
        assertThat(row.get("message")).isEqualTo("오늘 준비도는 72.5점입니다. 달리러 가볼까요?");
        assertThat(row.get("dedupe_key")).isEqualTo("READINESS_TODAY:" + user + ":" + today);
        assertThat(row.get("status")).isEqualTo("SENT");

        var captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(sender).send(captor.capture());
        var message = captor.getValue();
        assertThat(message.token()).isEqualTo("rdy-device-123456");
        assertThat(message.body()).isEqualTo("오늘 준비도는 72.5점입니다. 달리러 가볼까요?");
        assertThat(message.data())
                .containsEntry("kind", "READINESS_TODAY")
                .containsEntry("targetId", Long.toString(readinessId));
    }

    /** T-3 (AC-2). 재실행·재계산 뒤 다시 불려도 같은 날 새 행·푸시가 없다. */
    @Test
    void 같은_날은_한_번만_보낸다() throws Exception {
        readiness(user, today, "72.50");
        assertThat(job.sendToday()).isEqualTo(1);
        awaitPush();

        jdbc.update("UPDATE daily_readiness SET readiness_score=55.00 WHERE user_id=?", user);
        assertThat(job.sendToday()).isZero();
        assertThat(notifier.send(user, today)).isFalse();
        awaitPush();

        assertThat(rows(user)).hasSize(1);
        verify(sender, times(1)).send(any());
    }

    /** T-3 (AC-2). 08:00 작업과 이벤트 평가가 같은 회원에 동시에 보내도 행은 하나다. */
    @Test
    void 동시에_보내도_한_행만_생긴다() throws Exception {
        readiness(user, today, "72.50");
        var start = new CountDownLatch(1);
        var calls =
                java.util.stream.IntStream.range(0, 4)
                        .mapToObj(
                                i ->
                                        CompletableFuture.supplyAsync(
                                                () -> {
                                                    try {
                                                        start.await();
                                                    } catch (InterruptedException e) {
                                                        Thread.currentThread().interrupt();
                                                    }
                                                    return notifier.send(user, today);
                                                }))
                        .toList();
        start.countDown();
        long created = calls.stream().map(CompletableFuture::join).filter(b -> b).count();
        awaitPush();

        assertThat(created).isEqualTo(1);
        assertThat(rows(user)).hasSize(1);
        verify(sender, times(1)).send(any());
    }

    /** T-4·T-5 (AC-3). 실제 저장소·알림 모듈로 시각만 고정한 알리미. */
    @Test
    void 이벤트_평가는_08시_이후에만_보낸다() throws Exception {
        LocalDate day = LocalDate.of(2026, 11, 16);
        readiness(user, day, "61.00");

        assertThat(notifierAt(day, LocalTime.of(0, 5)).notifyIfDue(user, day)).isFalse();
        assertThat(rows(user)).isEmpty();

        assertThat(notifierAt(day, LocalTime.of(9, 0)).notifyIfDue(user, day)).isTrue();
        awaitPush();
        assertThat(rows(user)).hasSize(1);
        assertThat(rows(user).getFirst().get("message"))
                .isEqualTo("오늘 준비도는 61점입니다. 달리러 가볼까요?");
    }

    ReadinessPushNotifier notifierAt(LocalDate day, LocalTime time) {
        Instant at = day.atTime(time).atZone(ReadinessEvaluationService.TODAY_ZONE).toInstant();
        return new ReadinessPushNotifier(
                repository, notifications, Clock.fixed(at, ZoneOffset.UTC));
    }

    /** T-6 (AC-4). */
    @Test
    void 오늘_점수가_없으면_보내지_않는다() throws Exception {
        readiness(user, today.minusDays(1), "80.00");

        assertThat(job.sendToday()).isZero();
        awaitPush();

        assertThat(rows(user)).isEmpty();
        verify(sender, never()).send(any());
    }

    /** T-7 (AC-5). 러닝 알림(groupRun) 꺼짐·건강정보 동의 없음·탈퇴 회원은 보내지 않는다. */
    @Test
    void 설정_동의_계정_상태를_따른다() throws Exception {
        readiness(user, today, "70.00");
        jdbc.update("UPDATE user_settings SET group_notifications_enabled=FALSE WHERE user_id=?", user);

        long disagreed = member("DISAGREE");
        readiness(disagreed, today, "70.00");

        long withdrawn = member("AGREE");
        readiness(withdrawn, today, "70.00");
        jdbc.update("UPDATE users SET account_status='WITHDRAWN' WHERE id=?", withdrawn);

        assertThat(job.sendToday()).isZero();
        assertThat(notifier.send(disagreed, today)).isFalse();
        assertThat(notifier.send(withdrawn, today)).isFalse();
        awaitPush();

        assertThat(jdbc.queryForObject("SELECT count(*) FROM notifications", Long.class)).isZero();
        verify(sender, never()).send(any());
    }
}
