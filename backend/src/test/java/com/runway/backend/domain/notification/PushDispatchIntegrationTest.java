package com.runway.backend.domain.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.notification.push.PushDispatcher;
import com.runway.backend.domain.notification.push.PushMessage;
import com.runway.backend.domain.notification.push.PushSendResult;
import com.runway.backend.domain.notification.push.PushSender;
import com.runway.backend.domain.notification.repository.PushTokenRepository;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.user.service.FollowService;
import com.runway.backend.domain.user.service.PrivacySettingsService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.time.Duration;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.mockito.ArgumentCaptor;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoBean;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.transaction.support.TransactionTemplate;

/** Push after commit and its recorded outcome (S15P31E105-815, AC-2~AC-5). FCM itself is replaced by a mock sender. */
@SpringBootTest
@ExtendWith(OutputCaptureExtension.class)
class PushDispatchIntegrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(PushDispatchIntegrationTest.class);

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
    @Autowired NotificationService notifications;
    @Autowired FollowService follows;
    @Autowired PrivacySettingsService privacy;
    @MockitoSpyBean PushDispatcher dispatcher;
    @MockitoSpyBean PushTokenRepository tokens;
    @Autowired TransactionTemplate tx;

    long actor;
    long recipient;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        actor = member("dactor");
        recipient = member("drecv");
        jdbc.update(
                "UPDATE user_settings SET community_notifications_enabled=TRUE, group_notifications_enabled=TRUE");
        when(sender.enabled()).thenReturn(true);
        when(sender.send(any())).thenReturn(PushSendResult.SENT);
    }

    long member(String name) {
        long id =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '00000000000', 'DISAGREE')
                        RETURNING id
                        """,
                        Long.class,
                        name,
                        name);
        signup.insertSettings(id);
        return id;
    }

    void token(long userId, String token) {
        jdbc.update(
                "INSERT INTO push_device_tokens(user_id,token,platform) VALUES (?,?,'ANDROID')",
                userId,
                token);
    }

    void awaitDispatch() throws InterruptedException {
        assertThat(dispatcher.awaitIdle(Duration.ofSeconds(10))).isTrue();
    }

    Map<String, Object> row(String dedupeKey) {
        return jdbc.queryForMap(
                "SELECT id, delivery_status::text AS status, sent_at FROM notifications WHERE dedupe_key=?",
                dedupeKey);
    }

    boolean create(String dedupeKey) {
        return Boolean.TRUE.equals(
                tx.execute(
                        s ->
                                notifications.create(
                                        recipient,
                                        NotificationType.POST_COMMENT,
                                        77,
                                        "새 댓글이 달렸어요",
                                        dedupeKey)));
    }

    @Test
    void committedRowIsPushedToEveryDeviceAndMarkedSent() throws Exception {
        token(recipient, "dev-a-123456789");
        token(recipient, "dev-b-123456789");
        token(actor, "actor-device-1");

        assertThat(create("POST_COMMENT:1")).isTrue();
        awaitDispatch();

        var captor = ArgumentCaptor.forClass(PushMessage.class);
        verify(sender, times(2)).send(captor.capture());
        assertThat(captor.getAllValues())
                .extracting(PushMessage::token)
                .containsExactlyInAnyOrder("dev-a-123456789", "dev-b-123456789");
        var row = row("POST_COMMENT:1");
        var message = captor.getValue();
        assertThat(message.title()).isEqualTo("RunWay");
        assertThat(message.body()).isEqualTo("새 댓글이 달렸어요");
        assertThat(message.data())
                .containsExactlyInAnyOrderEntriesOf(
                        Map.of(
                                "notificationId", row.get("id").toString(),
                                "kind", "POST_COMMENT",
                                "targetId", "77"));
        assertThat(row.get("status")).isEqualTo("SENT");
        assertThat(row.get("sent_at")).isNotNull();
    }

    @Test
    void followThroughDomainServicePushesAfterItsTransaction() throws Exception {
        token(recipient, "dev-follow-1234");
        privacy.update(recipient, false);

        follows.follow(actor, recipient);
        awaitDispatch();

        verify(sender)
                .send(
                        argThat(
                                m ->
                                        m.token().equals("dev-follow-1234")
                                                && m.data().get("kind").equals("NEW_FOLLOWER")
                                                && m.data().get("targetId").equals(Long.toString(actor))));
        assertThat(
                        jdbc.queryForObject(
                                "SELECT delivery_status::text FROM notifications WHERE user_id=?",
                                String.class,
                                recipient))
                .isEqualTo("SENT");
    }

    @Test
    void rolledBackCreationNeverPushes() throws Exception {
        token(recipient, "dev-rollback-12");
        tx.executeWithoutResult(
                s -> {
                    notifications.create(
                            recipient, NotificationType.POST_COMMENT, 77, "롤백", "POST_COMMENT:rb");
                    s.setRollbackOnly();
                });
        awaitDispatch();
        verify(sender, never()).send(any());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE dedupe_key='POST_COMMENT:rb'",
                                Long.class))
                .isZero();
    }

    @Test
    void duplicateAndDisabledSettingDoNotPushAgain() throws Exception {
        token(recipient, "dev-dup-1234567");
        assertThat(create("POST_COMMENT:dup")).isTrue();
        assertThat(create("POST_COMMENT:dup")).isFalse();
        jdbc.update(
                "UPDATE user_settings SET community_notifications_enabled=FALSE WHERE user_id=?",
                recipient);
        assertThat(create("POST_COMMENT:off")).isFalse();
        awaitDispatch();
        verify(sender, times(1)).send(any());
    }

    @Test
    void invalidTokenIsDeletedWhileOtherDeviceSucceeds() throws Exception {
        token(recipient, "dev-gone-123456");
        token(recipient, "dev-live-123456");
        when(sender.send(argThat(m -> m != null && m.token().equals("dev-gone-123456"))))
                .thenReturn(PushSendResult.INVALID_TOKEN);

        create("POST_COMMENT:mixed");
        awaitDispatch();

        assertThat(jdbc.queryForList("SELECT token FROM push_device_tokens", String.class))
                .containsExactly("dev-live-123456");
        assertThat(row("POST_COMMENT:mixed").get("status")).isEqualTo("SENT");
    }

    @Test
    void allDevicesFailingMarksFailedAndKeepsTransientTokens() throws Exception {
        token(recipient, "dev-down-123456");
        token(recipient, "dev-gone-123456");
        when(sender.send(any())).thenReturn(PushSendResult.FAILED);
        when(sender.send(argThat(m -> m != null && m.token().equals("dev-gone-123456"))))
                .thenReturn(PushSendResult.INVALID_TOKEN);

        create("POST_COMMENT:fail");
        awaitDispatch();

        var row = row("POST_COMMENT:fail");
        assertThat(row.get("status")).isEqualTo("FAILED");
        assertThat(row.get("sent_at")).isNull();
        assertThat(jdbc.queryForList("SELECT token FROM push_device_tokens", String.class))
                .containsExactly("dev-down-123456");
    }

    @Test
    void noDeviceLeavesRowPendingAndVisible() throws Exception {
        create("POST_COMMENT:none");
        awaitDispatch();
        verify(sender, never()).send(any());
        var row = row("POST_COMMENT:none");
        assertThat(row.get("status")).isEqualTo("PENDING");
        assertThat(row.get("sent_at")).isNull();
    }

    @Test
    void disabledSenderSendsNothingAndLeavesPending() throws Exception {
        when(sender.enabled()).thenReturn(false);
        token(recipient, "dev-off-1234567");
        create("POST_COMMENT:disabled");
        awaitDispatch();
        verify(sender, never()).send(any());
        assertThat(row("POST_COMMENT:disabled").get("status")).isEqualTo("PENDING");
    }

    @Test
    void rowDeletedBeforeDispatchIsSkipped() throws Exception {
        token(recipient, "dev-del-1234567");
        tx.executeWithoutResult(
                s -> {
                    notifications.create(
                            recipient, NotificationType.CREW_JOIN_REQUESTED, 5, "가입 신청", "CJR:del");
                    notifications.deleteByDedupeKey("CJR:del");
                });
        awaitDispatch();
        verify(sender, never()).send(any());
    }

    @Test
    void dispatchIsHandedOverOnlyAfterTheCreatingTransactionCommits() throws Exception {
        token(recipient, "dev-commit-1234");
        tx.executeWithoutResult(
                s -> {
                    notifications.create(
                            recipient, NotificationType.POST_COMMENT, 77, "커밋 전", "POST_COMMENT:tx");
                    verify(dispatcher, never()).dispatch(anyLong());
                });
        verify(dispatcher).dispatch((Long) row("POST_COMMENT:tx").get("id"));
        awaitDispatch();
        verify(sender).send(any());
    }

    @Test
    void deviceReRegisteredToAnotherAccountMidSendIsSkipped() throws Exception {
        token(recipient, "dev-first-12345");
        token(recipient, "dev-second-1234");
        when(sender.send(argThat(m -> m != null && m.token().equals("dev-first-12345"))))
                .thenAnswer(
                        invocation -> {
                            // N03 by another member on that second phone while FCM was slow on the first.
                            jdbc.update(
                                    "UPDATE push_device_tokens SET user_id=? WHERE token='dev-second-1234'",
                                    actor);
                            return PushSendResult.SENT;
                        });

        create("POST_COMMENT:moved");
        awaitDispatch();

        verify(sender, never()).send(argThat(m -> m != null && m.token().equals("dev-second-1234")));
        assertThat(row("POST_COMMENT:moved").get("status")).isEqualTo("SENT");
    }

    @Test
    void noOwnedDeviceLeftLeavesRowPending() throws Exception {
        token(recipient, "dev-gone-before");
        doReturn(false).when(tokens).isOwnedBy(anyLong(), anyString());
        create("POST_COMMENT:none-left");
        awaitDispatch();
        verify(sender, never()).send(any());
        assertThat(row("POST_COMMENT:none-left").get("status")).isEqualTo("PENDING");
    }

    @Test
    void logsNeverContainTheFullToken(CapturedOutput output) throws Exception {
        String full = "dev-logcheck-SECRETPART-0123456789";
        token(recipient, full);
        when(sender.send(any())).thenReturn(PushSendResult.INVALID_TOKEN);
        create("POST_COMMENT:log");
        awaitDispatch();
        assertThat(output.getAll()).contains("dev-logc****").doesNotContain("SECRETPART");
    }
}
