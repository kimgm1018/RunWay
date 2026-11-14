package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class UserProfileApiIntegrationTest {

    private static final byte[] PNG =
            new byte[] {
                (byte) 0x89,
                0x50,
                0x4E,
                0x47,
                0x0D,
                0x0A,
                0x1A,
                0x0A,
                0x00,
                0x00,
                0x00,
                0x0D,
                0x49,
                0x48,
                0x44,
                0x52,
                0x00,
                0x00,
                0x00,
                0x01,
                0x00,
                0x00,
                0x00,
                0x01,
                0x08,
                0x02,
                0x00,
                0x00,
                0x00,
                (byte) 0x90,
                0x77,
                0x53,
                (byte) 0xDE,
                0x00,
                0x00,
                0x00,
                0x0C,
                0x49,
                0x44,
                0x41,
                0x54,
                0x08,
                (byte) 0xD7,
                0x63,
                (byte) 0xF8,
                (byte) 0xCF,
                (byte) 0xC0,
                0x00,
                0x00,
                0x00,
                0x03,
                0x00,
                0x01,
                0x00,
                0x05,
                (byte) 0xFE,
                (byte) 0xD4,
                (byte) 0xEF,
                0x00,
                0x00,
                0x00,
                0x00,
                0x49,
                0x45,
                0x4E,
                0x44,
                (byte) 0xAE,
                (byte) 0x42,
                (byte) 0x60,
                (byte) 0x82
            };

    @TempDir static Path imageVolume;

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(UserProfileApiIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.images.volume-path", () -> imageVolume.toString());
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private long otherUserId;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM user_profiles");
        jdbc.update("DELETE FROM users");
        userId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('runner01','hash','러너','2000-01-01','MALE','01000000001','DISAGREE')
                        RETURNING id
                        """,
                        Long.class);
        otherUserId =
                jdbc.queryForObject(
                        """
                        INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                        VALUES ('runner02','hash','다른러너','1999-01-01','FEMALE','01000000002','DISAGREE')
                        RETURNING id
                        """,
                        Long.class);
    }

    @Test
    void U04_조회_온보딩미완료_이미지null() throws Exception {
        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.id").value((int) userId))
                .andExpect(jsonPath("$.nickname").value("러너"))
                .andExpect(jsonPath("$.gender").value("MALE"))
                .andExpect(jsonPath("$.birthDate").value("2000-01-01"))
                .andExpect(jsonPath("$.loginId").value("runner01"))
                .andExpect(jsonPath("$.status").value("ACTIVE"))
                .andExpect(jsonPath("$.profileImageUrl").value(nullValue()))
                .andExpect(jsonPath("$.onboardingCompleted").value(false));
    }

    @Test
    void U04_온보딩완료_true() throws Exception {
        jdbc.update(
                """
                INSERT INTO user_profiles(user_id, running_level, average_pace, distance, duraction)
                VALUES (?, 'BEGINNER', 360.00, 5000, 1800)
                """,
                userId);
        mockMvc.perform(
                        get("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.onboardingCompleted").value(true));
    }

    @Test
    void U05_닉네임부분수정() throws Exception {
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"nickname\":\"새닉네임\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("새닉네임"))
                .andExpect(jsonPath("$.gender").value("MALE"))
                .andExpect(jsonPath("$.birthDate").value("2000-01-01"))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty())
                .andExpect(jsonPath("$.profileImageUrl").value(nullValue()))
                .andExpect(jsonPath("$.onboardingCompleted").value(false));
    }

    // S15P31E105-779: 프로필 수정 생년도 1950년부터. 저장된 생년을 그대로 다시 보내는 저장(앱 기본 동작)은 막지 않는다.
    @Test
    void U05_생년_1950년부터_저장값과_같으면_통과() throws Exception {
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"birthDate\":\"1949-12-31\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PROFILE"));
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"birthDate\":\"1950-01-01\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.birthDate").value("1950-01-01"));

        jdbc.update("UPDATE users SET birth_date = '1930-05-05' WHERE id = ?", userId);
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"nickname\":\"옛러너\",\"birthDate\":\"1930-05-05\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.birthDate").value("1930-05-05"));
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"birthDate\":\"1930-05-06\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PROFILE"));
    }

    // S15P31E105-781: 닉네임은 완성형 한글·영문·숫자만. 거절하면 저장된 닉네임은 그대로다.
    @Test
    void U05_허용하지_않는_닉네임_400() throws Exception {
        for (String nickname : List.of("😀😀", "러너!", "홍 길동", "ㅋㅋ")) {
            mockMvc.perform(
                            patch("/api/v1/users/me")
                                    .header("Authorization", SecurityTestSupport.bearer(userId))
                                    .contentType(MediaType.APPLICATION_JSON)
                                    .content("{\"nickname\":\"" + nickname + "\"}"))
                    .andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_PROFILE"));
        }
        assertThat(
                        jdbc.queryForObject(
                                "SELECT nickname FROM users WHERE id = ?", String.class, userId))
                .isEqualTo("러너");
    }

    // 새 규칙 전에 저장된 닉네임은 생략하거나 그대로 보내면 유지하고 다른 항목을 저장할 수 있다(S15P31E105-781).
    @Test
    void U05_규칙밖_기존닉네임_생략하거나_그대로면_다른항목_저장() throws Exception {
        jdbc.update("UPDATE users SET nickname = '😀😀' WHERE id = ?", userId);
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"gender\":\"FEMALE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("😀😀"))
                .andExpect(jsonPath("$.gender").value("FEMALE"));
        // 이전 앱처럼 저장된 닉네임을 그대로 다시 보내도 막지 않는다. 다른 규칙 밖 닉네임으로 바꾸는 것은 거절한다.
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"nickname\":\"😀😀\",\"gender\":\"MALE\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.nickname").value("😀😀"))
                .andExpect(jsonPath("$.gender").value("MALE"));
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"nickname\":\"😀😀😀\"}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_PROFILE"));
    }

    @Test
    void U05_닉네임중복_409() throws Exception {
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"nickname\":\"다른러너\"}"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.code").value("NICKNAME_DUPLICATED"));
    }

    @Test
    void U05_프로필이미지연결_후삭제() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        MvcResult uploaded =
                mockMvc.perform(
                                multipart("/api/v1/images")
                                        .file(file)
                                        .param("purpose", "PROFILE")
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String imageId = JsonPath.read(uploaded.getResponse().getContentAsString(), "$.imageId");

        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"profileImageId\":\"" + imageId + "\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profileImageUrl").value("/api/v1/images/" + imageId));

        String key =
                jdbc.queryForObject(
                        "SELECT profile_image_key FROM users WHERE id = ?", String.class, userId);
        assertThat(key).isEqualTo("images/profile/" + userId + "/" + imageId + ".png");

        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"profileImageId\":null}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.profileImageUrl").value(nullValue()));
    }

    @Test
    void U05_타인또는비PROFILE이미지_422() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        MvcResult uploaded =
                mockMvc.perform(
                                multipart("/api/v1/images")
                                        .file(file)
                                        .param("purpose", "POST")
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String imageId = JsonPath.read(uploaded.getResponse().getContentAsString(), "$.imageId");

        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"profileImageId\":\"" + imageId + "\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_IMAGE"));

        MockMultipartFile otherFile =
                new MockMultipartFile("file", "b.png", MediaType.IMAGE_PNG_VALUE, PNG);
        MvcResult otherUploaded =
                mockMvc.perform(
                                multipart("/api/v1/images")
                                        .file(otherFile)
                                        .param("purpose", "PROFILE")
                                        .header(
                                                "Authorization",
                                                SecurityTestSupport.bearer(otherUserId)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String otherImageId =
                JsonPath.read(otherUploaded.getResponse().getContentAsString(), "$.imageId");

        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"profileImageId\":\"" + otherImageId + "\"}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_IMAGE"));
    }

    @Test
    void U05_빈본문_400() throws Exception {
        mockMvc.perform(
                        patch("/api/v1/users/me")
                                .header("Authorization", SecurityTestSupport.bearer(userId))
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{}"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void U04_무토큰_401() throws Exception {
        mockMvc.perform(get("/api/v1/users/me")).andExpect(status().isUnauthorized());
    }
}
