package com.runway.backend.domain.image;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.multipart;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.header;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
class ImageApiIntegrationTest {

    // 1x1 PNG
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
                0x42,
                0x60,
                (byte) 0x82
            };

    private static final byte[] JPEG_HEADER =
            new byte[] {(byte) 0xFF, (byte) 0xD8, (byte) 0xFF, (byte) 0xD9};

    @TempDir static Path imageVolume;

    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(ImageApiIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.images.volume-path", () -> imageVolume.toString());
    }

    @Autowired private MockMvc mockMvc;
    @Autowired private ImageStorage imageStorage;
    @Autowired private JdbcTemplate jdbc;

    @BeforeEach
    void activeImageOwners() {
        for (long id : new long[] {1, 7, 42}) {
            jdbc.update("""
                    INSERT INTO users(id,login_id,password,nickname,birth_date,gender,
                        phone_number,health_data_access)
                    OVERRIDING SYSTEM VALUE
                    VALUES (?,?,'synthetic','이미지' || ?,'2000-01-01','MALE','00000000000','DISAGREE')
                    ON CONFLICT (id) DO NOTHING
                    """, id, "imageuser" + id, id);
        }
    }

    @Test
    void png업로드_201_imageId와_볼륨저장_url은_F02경로() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        MvcResult result =
                mockMvc.perform(
                                multipart("/api/v1/images")
                                        .file(file)
                                        .param("purpose", "PROFILE")
                                        .header("Authorization", SecurityTestSupport.bearer(42)))
                        .andExpect(status().isCreated())
                        .andExpect(jsonPath("$.imageId").isNotEmpty())
                        .andReturn();
        String imageId = JsonPath.read(result.getResponse().getContentAsString(), "$.imageId");
        String url = JsonPath.read(result.getResponse().getContentAsString(), "$.url");
        assertThat(url).isEqualTo("/api/v1/images/" + imageId);
        String key = "images/profile/42/" + imageId + ".png";
        String byId = "images/by-id/" + imageId + ".png";
        assertThat(imageStorage.exists(key)).isTrue();
        assertThat(imageStorage.exists(byId)).isTrue();
        assertThat(Files.size(imageVolume.resolve(key))).isEqualTo(PNG.length);
        assertThat(Files.size(imageVolume.resolve(byId))).isEqualTo(PNG.length);
    }

    @Test
    void 미연결이미지조회_본인GET_바이너리() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        MvcResult uploaded =
                mockMvc.perform(
                                multipart("/api/v1/images")
                                        .file(file)
                                        .param("purpose", "PROFILE")
                                        .header("Authorization", SecurityTestSupport.bearer(42)))
                        .andExpect(status().isCreated())
                        .andReturn();
        String imageId = JsonPath.read(uploaded.getResponse().getContentAsString(), "$.imageId");

        mockMvc.perform(get("/api/v1/images/" + imageId)
                        .header("Authorization", SecurityTestSupport.bearer(42)))
                .andExpect(status().isOk())
                .andExpect(header().string("Content-Type", MediaType.IMAGE_PNG_VALUE))
                // 사용자 이미지는 코스 썸네일(S15P31E105-612)과 달리 캐시하지 않는다.
                .andExpect(header().string("Cache-Control", "no-store"))
                .andExpect(content().bytes(PNG));
    }

    @Test
    void 이미지조회_없는id_404() throws Exception {
        mockMvc.perform(get("/api/v1/images/550e8400-e29b-41d4-a716-446655440000"))
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("IMAGE_NOT_FOUND"));
    }

    @Test
    void 이미지조회_잘못된uuid_400() throws Exception {
        mockMvc.perform(get("/api/v1/images/not-a-uuid"))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
    }

    @Test
    void jpeg업로드_201() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.jpg", MediaType.IMAGE_JPEG_VALUE, JPEG_HEADER);
        mockMvc.perform(
                        multipart("/api/v1/images")
                                .file(file)
                                .param("purpose", "POST")
                                .header("Authorization", SecurityTestSupport.bearer(7)))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.imageId").isNotEmpty());
    }

    @Test
    void 무토큰_401() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        mockMvc.perform(multipart("/api/v1/images").file(file).param("purpose", "CREW"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void gif는_415() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile(
                        "file", "a.gif", "image/gif", new byte[] {'G', 'I', 'F', '8', '9', 'a'});
        mockMvc.perform(
                        multipart("/api/v1/images")
                                .file(file)
                                .param("purpose", "PROFILE")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void contentType과_바이트_불일치_415() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, JPEG_HEADER);
        mockMvc.perform(
                        multipart("/api/v1/images")
                                .file(file)
                                .param("purpose", "PROFILE")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isUnsupportedMediaType())
                .andExpect(jsonPath("$.code").value("UNSUPPORTED_MEDIA_TYPE"));
    }

    @Test
    void 빈파일_422() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, new byte[0]);
        mockMvc.perform(
                        multipart("/api/v1/images")
                                .file(file)
                                .param("purpose", "PROFILE")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_FILE"));
    }

    @Test
    void purpose누락_400() throws Exception {
        MockMultipartFile file =
                new MockMultipartFile("file", "a.png", MediaType.IMAGE_PNG_VALUE, PNG);
        mockMvc.perform(
                        multipart("/api/v1/images")
                                .file(file)
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isBadRequest());
    }

    @Test
    void json본문은_허용하지_않음() throws Exception {
        mockMvc.perform(
                        post("/api/v1/images")
                                .contentType(MediaType.APPLICATION_JSON)
                                .content("{\"purpose\":\"PROFILE\"}")
                                .header("Authorization", SecurityTestSupport.bearer(1)))
                .andExpect(status().isUnsupportedMediaType());
    }
}
