package com.runway.backend.domain.notification;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.user.service.FollowService;
import com.runway.backend.domain.user.service.PrivacySettingsService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.json.JsonMapper;

@SpringBootTest
@AutoConfigureMockMvc
class NotificationApiIntegrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(NotificationApiIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired NotificationService notifications;
    @Autowired FollowService follows;
    @Autowired PrivacySettingsService privacy;

    long actor;
    long recipient;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        actor = member("nactor");
        recipient = member("nrecv");
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

    String auth(long id) {
        return SecurityTestSupport.bearer(id);
    }

    void enableCommunity(long userId) {
        jdbc.update(
                "UPDATE user_settings SET community_notifications_enabled=TRUE WHERE user_id=?",
                userId);
    }

    void disableCommunity(long userId) {
        jdbc.update(
                "UPDATE user_settings SET community_notifications_enabled=FALSE WHERE user_id=?",
                userId);
    }

    long countRows(long userId) {
        return jdbc.queryForObject(
                "SELECT count(*) FROM notifications WHERE user_id=?", Long.class, userId);
    }

    @Test
    void createSkipsWhenCommunitySettingOff() {
        disableCommunity(recipient);
        boolean created =
                notifications.create(
                        recipient,
                        NotificationType.NEW_FOLLOWER,
                        actor,
                        "테스트 알림",
                        "NEW_FOLLOWER:skip-1");
        assertThat(created).isFalse();
        assertThat(countRows(recipient)).isZero();
    }

    @Test
    void followEventCreatesRowAndDedupeKeepsSingleRow() {
        enableCommunity(recipient);
        privacy.update(recipient, false);
        follows.follow(actor, recipient);
        assertThat(countRows(recipient)).isEqualTo(1);
        var row =
                jdbc.queryForMap(
                        "SELECT notification_type, target_id, dedupe_key, delivery_status::text AS"
                            + " delivery_status FROM notifications WHERE user_id=?",
                        recipient);
        assertThat(row.get("notification_type")).isEqualTo("NEW_FOLLOWER");
        assertThat(((Number) row.get("target_id")).longValue()).isEqualTo(actor);
        // ADR-0025: delivery_status is now the device push outcome; push is off in this context, so it stays PENDING.
        assertThat(row.get("delivery_status")).isEqualTo("PENDING");
        String dedupe = (String) row.get("dedupe_key");
        assertThat(dedupe).startsWith("NEW_FOLLOWER:");
        assertThat(
                        notifications.create(
                                recipient,
                                NotificationType.NEW_FOLLOWER,
                                actor,
                                "중복",
                                dedupe))
                .isFalse();
        assertThat(countRows(recipient)).isEqualTo(1);
    }

    @Test
    void listSupportsCursorUnreadCountAndReadAll() throws Exception {
        enableCommunity(recipient);
        for (int i = 0; i < 3; i++) {
            assertThat(
                            notifications.create(
                                    recipient,
                                    NotificationType.FOLLOW_REQUEST,
                                    actor,
                                    "요청 " + i,
                                    "FOLLOW_REQUEST:list-" + i))
                    .isTrue();
        }
        jdbc.update(
                "UPDATE notifications SET created_at = timestamptz '2026-11-06T01:00:00Z'"
                    + " + (id * interval '1 second') WHERE user_id=?",
                recipient);

        String firstPage =
                mvc.perform(
                                get("/api/v1/notifications")
                                        .param("limit", "2")
                                        .header("Authorization", auth(recipient)))
                        .andExpect(status().isOk())
                        .andExpect(jsonPath("$.items.length()").value(2))
                        .andExpect(jsonPath("$.hasNext").value(true))
                        .andExpect(jsonPath("$.nextCursor").isNotEmpty())
                        .andExpect(jsonPath("$.unreadCount").value(3))
                        .andExpect(jsonPath("$.items[0].read").value(false))
                        .andExpect(jsonPath("$.items[0].kind").value("FOLLOW_REQUEST"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        String nextCursor =
                JsonMapper.builder().build().readTree(firstPage).get("nextCursor").asString();

        mvc.perform(
                        get("/api/v1/notifications")
                                .param("limit", "2")
                                .param("cursor", nextCursor)
                                .header("Authorization", auth(recipient)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andExpect(jsonPath("$.unreadCount").value(3));

        mvc.perform(
                        get("/api/v1/notifications")
                                .param("limit", "0")
                                .header("Authorization", auth(recipient)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));

        mvc.perform(
                        get("/api/v1/notifications")
                                .param("cursor", "bad")
                                .header("Authorization", auth(recipient)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));

        mvc.perform(post("/api/v1/notifications/read-all").header("Authorization", auth(recipient)))
                .andExpect(status().isNoContent());
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE user_id=? AND read_at IS"
                                    + " NULL",
                                Long.class,
                                recipient))
                .isZero();
        mvc.perform(get("/api/v1/notifications").header("Authorization", auth(recipient)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unreadCount").value(0))
                .andExpect(jsonPath("$.items[0].read").value(true));
        mvc.perform(post("/api/v1/notifications/read-all").header("Authorization", auth(recipient)))
                .andExpect(status().isNoContent());
    }

    @Test
    void unauthorizedWithoutToken() throws Exception {
        mvc.perform(get("/api/v1/notifications")).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/notifications/read-all")).andExpect(status().isUnauthorized());
    }

    @Test
    void followRequestAndApprovedKindsPersistMessages() {
        enableCommunity(actor);
        enableCommunity(recipient);
        follows.follow(actor, recipient);
        long requestId =
                jdbc.queryForObject(
                        "SELECT id FROM user_follows WHERE follower_id=? AND followee_id=?",
                        Long.class,
                        actor,
                        recipient);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE user_id=? AND"
                                    + " notification_type='FOLLOW_REQUEST' AND dedupe_key=?",
                                Long.class,
                                recipient,
                                "FOLLOW_REQUEST:" + requestId))
                .isEqualTo(1);
        follows.decide(recipient, actor, requestId, "APPROVE");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE user_id=? AND"
                                    + " notification_type='FOLLOW_APPROVED' AND target_id=?",
                                Long.class,
                                actor,
                                recipient))
                .isEqualTo(1);
    }

    // S15P31E105-801 AC-1·2: a new account starts with group·community notifications on and so gets inbox rows.
    @Test
    void newMemberStartsWithNotificationsOnAndReceivesRows() {
        long fresh = member("nfresh");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT group_notifications_enabled AND community_notifications_enabled"
                                        + " FROM user_settings WHERE user_id=?",
                                Boolean.class,
                                fresh))
                .isTrue();
        follows.follow(actor, fresh);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM notifications WHERE user_id=? AND read_at IS NULL",
                                Long.class,
                                fresh))
                .isEqualTo(1);
    }

    long row(long userId, String key) {
        notifications.create(userId, NotificationType.POST_COMMENT, actor, "m", key);
        return jdbc.queryForObject(
                "SELECT id FROM notifications WHERE dedupe_key=?", Long.class, key);
    }

    boolean isRead(long notificationId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT read_at IS NOT NULL FROM notifications WHERE id=?",
                        Boolean.class,
                        notificationId));
    }

    // AC-4: only rows up to upToId are marked read; a row created after it stays unread.
    @Test
    void readAllUpToIdMarksOnlyRowsUpToThatId() throws Exception {
        long first = row(recipient, "k801-a");
        long middle = row(recipient, "k801-b");
        long last = row(recipient, "k801-c");
        mvc.perform(
                        post("/api/v1/notifications/read-all")
                                .param("upToId", String.valueOf(middle))
                                .header("Authorization", auth(recipient)))
                .andExpect(status().isNoContent());
        assertThat(isRead(first)).isTrue();
        assertThat(isRead(middle)).isTrue();
        assertThat(isRead(last)).isFalse();
        mvc.perform(get("/api/v1/notifications").header("Authorization", auth(recipient)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unreadCount").value(1));
    }

    // AC-5: zero, negative or non-number upToId is a validation error and changes nothing.
    @Test
    void readAllRejectsInvalidUpToId() throws Exception {
        long only = row(recipient, "k801-bad");
        for (String bad : new String[] {"0", "-1", "abc"}) {
            mvc.perform(
                            post("/api/v1/notifications/read-all")
                                    .param("upToId", bad)
                                    .header("Authorization", auth(recipient)))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        }
        assertThat(isRead(only)).isFalse();
    }

    // AC-6: an upToId covering someone else's row changes only the caller's rows.
    @Test
    void readAllUpToIdTouchesOnlyCallersRows() throws Exception {
        long other = member("nother");
        long mine = row(recipient, "k801-mine");
        long theirs = row(other, "k801-theirs");
        mvc.perform(
                        post("/api/v1/notifications/read-all")
                                .param("upToId", String.valueOf(theirs))
                                .header("Authorization", auth(recipient)))
                .andExpect(status().isNoContent());
        assertThat(isRead(mine)).isTrue();
        assertThat(isRead(theirs)).isFalse();
    }
}
