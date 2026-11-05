package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.sql.Timestamp;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.request.MockHttpServletRequestBuilder;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class DeviceApiIntegrationTest {

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(DeviceApiIntegrationTest.class);

    @DynamicPropertySource
    static void databaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private long otherUserId;
    private int nicknameSeq;

    @BeforeEach
    void seedUsers() {
        jdbc.update("DELETE FROM user_devices");
        jdbc.update("DELETE FROM users");
        userId = insertUser("device_user");
        otherUserId = insertUser("device_other");
    }

    private long insertUser(String loginId) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,'hash',?,'2000-01-01','MALE','01011112222','AGREEE')
                RETURNING id
                """,
                Long.class,
                loginId,
                "러너" + nicknameSeq++);
    }

    private long insertDevice(long owner, String type, String linkedAt, String unlinkedAt) {
        return jdbc.queryForObject(
                "INSERT INTO user_devices(user_id,device_type,linked_at,unlinked_at)"
                        + " VALUES (?,?::user_devices_device_type_enum,?::timestamptz,?::timestamptz)"
                        + " RETURNING id",
                Long.class,
                owner,
                type,
                linkedAt,
                unlinkedAt);
    }

    private int deviceCount() {
        return jdbc.queryForObject("SELECT count(*) FROM user_devices", Integer.class);
    }

    private boolean isLinked(long deviceId) {
        return jdbc.queryForObject(
                "SELECT unlinked_at IS NULL FROM user_devices WHERE id=?", Boolean.class, deviceId);
    }

    private MockHttpServletRequestBuilder register(long user, String body) {
        return post("/api/v1/devices")
                .header("Authorization", SecurityTestSupport.bearer(user))
                .contentType(MediaType.APPLICATION_JSON)
                .content(body);
    }

    private long registeredId(long user, String type) throws Exception {
        String body =
                mockMvc.perform(register(user, "{\"deviceType\":\"" + type + "\"}"))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return Long.parseLong(body.replaceAll("(?s).*\"id\"\\s*:\\s*(\\d+).*", "$1"));
    }

    @Test
    void 신규_등록은_201과_연결중_행을_만든다() throws Exception {
        mockMvc.perform(register(userId, "{\"deviceType\":\"WATCH\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.id").isNumber())
                .andExpect(jsonPath("$.deviceType").value("WATCH"));

        assertThat(
                        jdbc.queryForObject(
                                "SELECT count(*) FROM user_devices WHERE user_id=? AND device_type='WATCH'"
                                        + " AND linked_at IS NOT NULL AND unlinked_at IS NULL",
                                Integer.class,
                                userId))
                .isEqualTo(1);
        assertThat(deviceCount()).isEqualTo(1);
    }

    @Test
    void 같은_유형_재요청은_기존_기기를_200으로_반환한다() throws Exception {
        long first = registeredId(userId, "WATCH");

        mockMvc.perform(register(userId, "{\"deviceType\":\"WATCH\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value(first))
                .andExpect(jsonPath("$.deviceType").value("WATCH"));
        assertThat(deviceCount()).isEqualTo(1);
    }

    @Test
    void 유형별로_따로_등록되고_다른_회원과_독립이다() throws Exception {
        long watch = registeredId(userId, "WATCH");

        mockMvc.perform(register(userId, "{\"deviceType\":\"PHONE\"}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.deviceType").value("PHONE"));
        mockMvc.perform(register(otherUserId, "{\"deviceType\":\"WATCH\"}"))
                .andExpect(status().isCreated());

        assertThat(registeredId(userId, "WATCH")).isEqualTo(watch);
        assertThat(deviceCount()).isEqualTo(3);
    }

    @Test
    void 저장하지_않는_이전_필드는_무시한다() throws Exception {
        mockMvc.perform(
                        register(
                                userId,
                                """
                                {"deviceType":"WATCH","installationId":"00000000-0000-4000-8000-000000000002"}
                                """))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.installationId").doesNotExist());
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "{}",
                "{\"deviceType\":null}",
                "{\"deviceType\":\"TABLET\"}",
                "{\"deviceType\":\"watch\"}",
                "{\"deviceType\":1}",
                "{\"deviceType\":",
                "[]"
            })
    void 잘못된_등록_요청은_400이고_저장하지_않는다(String body) throws Exception {
        mockMvc.perform(register(userId, body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(deviceCount()).isZero();
    }

    @Test
    void 목록은_본인_연결중_기기를_최신순으로_보여준다() throws Exception {
        long oldWatch =
                insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");
        long watch = insertDevice(userId, "WATCH", "2026-10-03T00:00:00Z", null);
        long phone = insertDevice(userId, "PHONE", "2026-10-04T00:00:00Z", null);
        insertDevice(otherUserId, "WATCH", "2026-10-05T00:00:00Z", null);

        mockMvc.perform(
                        get("/api/v1/devices")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(phone))
                .andExpect(jsonPath("$.items[0].deviceType").value("PHONE"))
                .andExpect(jsonPath("$.items[0].linkedAt").value("2026-10-04T00:00:00Z"))
                .andExpect(jsonPath("$.items[0].unlinkedAt").value(nullValue()))
                .andExpect(jsonPath("$.items[1].id").value(watch));

        mockMvc.perform(
                        get("/api/v1/devices")
                                .param("includeUnlinked", "true")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(3))
                .andExpect(jsonPath("$.items[2].id").value(oldWatch))
                .andExpect(jsonPath("$.items[2].unlinkedAt").value("2026-10-02T00:00:00Z"));

        mockMvc.perform(
                        get("/api/v1/devices")
                                .param("includeUnlinked", "false")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2));

        mockMvc.perform(
                        get("/api/v1/devices")
                                .param("deviceType", "WATCH")
                                .param("includeUnlinked", "true")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(watch))
                .andExpect(jsonPath("$.items[1].id").value(oldWatch));
    }

    @Test
    void 같은_연결시각은_id_내림차순이다() throws Exception {
        long first =
                insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", "2026-10-01T00:00:00Z");
        long second = insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", null);

        mockMvc.perform(
                        get("/api/v1/devices")
                                .param("includeUnlinked", "true")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(jsonPath("$.items[0].id").value(second))
                .andExpect(jsonPath("$.items[1].id").value(first));
    }

    @Test
    void 기기가_없으면_빈_목록이다() throws Exception {
        mockMvc.perform(
                        get("/api/v1/devices")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(content().json("{\"items\":[]}", true));
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "deviceType=TABLET",
                "deviceType=watch",
                "deviceType=",
                "includeUnlinked=abc",
                "includeUnlinked=yes",
                "includeUnlinked=1",
                "includeUnlinked=on",
                "includeUnlinked=TRUE",
                "includeUnlinked="
            })
    void 잘못된_목록_조건은_400이다(String query) throws Exception {
        mockMvc.perform(
                        get("/api/v1/devices?" + query)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 본인_기기_해제_후_재등록은_새_기기다() throws Exception {
        long watch = registeredId(userId, "WATCH");

        mockMvc.perform(
                        delete("/api/v1/devices/{id}", watch)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(content().json("{}", true));
        assertThat(isLinked(watch)).isFalse();

        mockMvc.perform(register(userId, "{\"deviceType\":\"WATCH\"}"))
                .andExpect(status().isCreated());
        long replacement = registeredId(userId, "WATCH");
        assertThat(replacement).isNotEqualTo(watch);
        assertThat(deviceCount()).isEqualTo(2);
    }

    @Test
    void 이미_해제된_기기의_재해제는_200이고_해제시각을_바꾸지_않는다() throws Exception {
        long watch =
                insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", "2026-10-02T00:00:00Z");

        mockMvc.perform(
                        delete("/api/v1/devices/{id}", watch)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(content().json("{}", true));
        assertThat(
                        jdbc.queryForObject(
                                        "SELECT unlinked_at FROM user_devices WHERE id=?",
                                        Timestamp.class,
                                        watch)
                                .toInstant()
                                .toString())
                .isEqualTo("2026-10-02T00:00:00Z");
    }

    @Test
    void 타인_기기와_없는_기기는_똑같이_404다() throws Exception {
        long others = insertDevice(otherUserId, "WATCH", "2026-10-01T00:00:00Z", null);

        mockMvc.perform(
                        delete("/api/v1/devices/{id}", others)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DEVICE_NOT_FOUND"));
        mockMvc.perform(
                        delete("/api/v1/devices/{id}", others + 1000)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("DEVICE_NOT_FOUND"));

        assertThat(isLinked(others)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"abc", "0", "-1", "1.5", "9223372036854775808"})
    void 잘못된_기기_ID는_400이다(String deviceId) throws Exception {
        mockMvc.perform(
                        delete("/api/v1/devices/" + deviceId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void 인증이_없거나_위조되면_401이고_변경하지_않는다() throws Exception {
        long watch = insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", null);
        String forged = SecurityTestSupport.bearer(userId) + "x";

        for (String header : new String[] {null, forged}) {
            MockHttpServletRequestBuilder[] requests = {
                post("/api/v1/devices")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"deviceType\":\"PHONE\"}"),
                get("/api/v1/devices"),
                delete("/api/v1/devices/{id}", watch)
            };
            for (MockHttpServletRequestBuilder request : requests) {
                if (header != null) {
                    request.header("Authorization", header);
                }
                mockMvc.perform(request)
                        .andExpect(status().isUnauthorized())
                        .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
            }
        }
        assertThat(deviceCount()).isEqualTo(1);
        assertThat(isLinked(watch)).isTrue();
    }

    @Test
    void 탈퇴한_회원의_남은_토큰은_세_API_모두_401이고_변경하지_않는다() throws Exception {
        long watch = insertDevice(userId, "WATCH", "2026-10-01T00:00:00Z", null);
        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?",
                userId);
        String token = SecurityTestSupport.bearer(userId);

        mockMvc.perform(
                        post("/api/v1/devices")
                                .header("Authorization", token)
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"deviceType\":\"PHONE\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(get("/api/v1/devices").header("Authorization", token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(delete("/api/v1/devices/{id}", watch).header("Authorization", token))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));

        assertThat(deviceCount()).isEqualTo(1);
        assertThat(isLinked(watch)).isTrue();
    }

    @Test
    void 존재하지_않는_회원의_토큰은_401이다() throws Exception {
        long missing = otherUserId + 1000;
        long others = insertDevice(otherUserId, "WATCH", "2026-10-01T00:00:00Z", null);

        mockMvc.perform(
                        delete("/api/v1/devices/{id}", others)
                                .header("Authorization", SecurityTestSupport.bearer(missing)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(
                        delete("/api/v1/devices/{id}", others + 1000)
                                .header("Authorization", SecurityTestSupport.bearer(missing)))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        assertThat(isLinked(others)).isTrue();

        mockMvc.perform(register(missing, "{\"deviceType\":\"WATCH\"}"))
                .andExpect(status().isUnauthorized())
                .andExpect(jsonPath("$.code").value("UNAUTHORIZED"));
        mockMvc.perform(
                        get("/api/v1/devices")
                                .header("Authorization", SecurityTestSupport.bearer(missing)))
                .andExpect(status().isUnauthorized());
        assertThat(deviceCount()).isEqualTo(1);
    }
}
