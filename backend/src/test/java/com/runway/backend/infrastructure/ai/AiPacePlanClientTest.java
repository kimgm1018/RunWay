package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.difficulty.CourseDifficultyPort.CourseDifficulty;
import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.time.Duration;
import java.util.Optional;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** AI05 구간 난이도 비율 클라이언트 — 297 플랜 AC-3(T-3). 가짜 AI 서버는 루프백이며 모든 값은 합성 데이터다. */
class AiPacePlanClientTest {

    private static final String PROFILE =
            """
            [{"startDistanceM":0.0,"endDistanceM":100.0,"gradePercent":0.8},
             {"startDistanceM":100.0,"endDistanceM":2500.0,"gradePercent":-1.25}]
            """;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();
    private FakeAiServer server;

    @BeforeEach
    void start() {
        server = new FakeAiServer();
    }

    @AfterEach
    void stop() {
        server.close();
    }

    private AiPacePlanClient client(Duration timeout) {
        HttpClient http =
                HttpClient.newBuilder()
                        .connectTimeout(Duration.ofSeconds(1))
                        .followRedirects(HttpClient.Redirect.NEVER)
                        .version(HttpClient.Version.HTTP_1_1)
                        .build();
        return new AiPacePlanClient(http, server.baseUri(), timeout, jsonMapper);
    }

    private Optional<CourseDifficulty> call() {
        return client(Duration.ofSeconds(2)).segmentDifficulty(42L, PROFILE);
    }

    @Test
    void 코스ID_저장경사_기준페이스로_요청하고_비율과_버전을_읽는다() {
        server.respond(
                200,
                """
                {"plannerVersion":"planner-v1","mode":"COURSE","planStatus":"PLANNED",
                 "segmentDifficultyRatios":[1.2,0.8,1.000001],"segments":[],
                 "warnings":[{"code":"CUE_BPM_NOT_COMPUTED","message":"m"},{"message":"no code"},"bad",
                             {"code":"COURSE_PACE_RATIO_MISSING","message":"m"}]}
                """);

        Optional<CourseDifficulty> result = call();

        assertThat(result).isPresent();
        assertThat(result.get().plannerVersion()).isEqualTo("planner-v1");
        assertThat(result.get().ratios())
                .usingElementComparator(BigDecimal::compareTo)
                .containsExactly(
                        new BigDecimal("1.2"), new BigDecimal("0.8"), new BigDecimal("1.000001"));

        assertThat(result.get().warningCodes())
                .containsExactly("CUE_BPM_NOT_COMPUTED", "COURSE_PACE_RATIO_MISSING");

        assertThat(server.received()).hasSize(1);
        FakeAiServer.Received received = server.received().get(0);
        assertThat(received.method()).isEqualTo("POST");
        assertThat(received.path()).isEqualTo("/v1/pace/plan");
        assertThat(received.contentType()).isEqualTo("application/json");
        JsonNode body = jsonMapper.readTree(received.body());
        assertThat(body.propertyNames())
                .containsExactlyInAnyOrder("courseId", "gradeProfile", "targetPaceSecPerKm");
        assertThat(body.get("courseId").longValue()).isEqualTo(42L);
        assertThat(body.get("targetPaceSecPerKm").intValue()).isEqualTo(360);
        assertThat(body.get("gradeProfile")).isEqualTo(jsonMapper.readTree(PROFILE));
    }

    @Test
    void 비율_값_검사는_호출자에게_맡기고_숫자면_그대로_돌려준다() {
        server.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[0,-1]}");

        assertThat(call()).hasValueSatisfying(r -> assertThat(r.ratios()).hasSize(2));
    }

    @Test
    void 오류_상태는_재시도없이_빈값이다() {
        for (int status : new int[] {503, 500, 422, 400, 302}) {
            server.reset();
            server.respond(status, "{\"code\":\"AI_BUSY\",\"message\":\"busy\"}");

            assertThat(call()).as("status %d", status).isEmpty();
            assertThat(server.received()).as("status %d", status).hasSize(1);
        }
    }

    @Test
    void 응답_형식이_계약과_다르면_빈값이다() {
        String[] bodies = {
            "not-json",
            "[]",
            "{\"segmentDifficultyRatios\":[1.0]}",
            "{\"plannerVersion\":\"\",\"segmentDifficultyRatios\":[1.0]}",
            "{\"plannerVersion\":1,\"segmentDifficultyRatios\":[1.0]}",
            "{\"plannerVersion\":\"v\"}",
            "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":\"1.0\"}",
            "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.0,\"0.8\"]}",
            "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.0,null]}",
            "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.0,1e400]}"
        };
        for (String body : bodies) {
            server.respond(200, body);

            assertThat(call()).as(body).isEmpty();
        }
    }

    @Test
    void 응답이_시간_상한을_넘으면_빈값이다() {
        server.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.0]}")
                .delay(Duration.ofMillis(800));

        assertThat(client(Duration.ofMillis(200)).segmentDifficulty(42L, PROFILE)).isEmpty();
    }

    @Test
    void 본문_전송이_멈춰도_시간_상한에서_끝난다() {
        server.respond(200, "{\"plannerVersion\":\"v\",\"segmentDifficultyRatios\":[1.0]}")
                .stallBody(Duration.ofMillis(800));

        assertThat(client(Duration.ofMillis(200)).segmentDifficulty(42L, PROFILE)).isEmpty();
    }

    @Test
    void 응답_본문이_상한을_넘으면_빈값이다() {
        String huge = "x".repeat(AiHrPersonalizeClient.MAX_RESPONSE_BYTES + 1);
        server.respond(200, "{\"plannerVersion\":\"" + huge + "\"}");

        assertThat(call()).isEmpty();
    }

    @Test
    void 주소가_없으면_호출하지_않고_빈값이다() {
        AiPacePlanClient client =
                new AiPacePlanClient(HttpClient.newHttpClient(), null, Duration.ofSeconds(1), jsonMapper);

        assertThat(client.segmentDifficulty(42L, PROFILE)).isEmpty();
        assertThat(server.received()).isEmpty();
    }

    @Test
    void 연결할_수_없으면_빈값이다() {
        FakeAiServer stopped = new FakeAiServer();
        java.net.URI closed = stopped.baseUri();
        stopped.close();
        AiPacePlanClient client =
                new AiPacePlanClient(
                        HttpClient.newBuilder().connectTimeout(Duration.ofMillis(300)).build(),
                        closed,
                        Duration.ofSeconds(1),
                        jsonMapper);

        assertThat(client.segmentDifficulty(42L, PROFILE)).isEmpty();
    }
}
