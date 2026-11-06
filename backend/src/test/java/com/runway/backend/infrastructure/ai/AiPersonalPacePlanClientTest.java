package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.session.entity.SessionGoal;

import org.junit.jupiter.api.Test;

import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.net.http.HttpClient;
import java.time.Duration;

class AiPersonalPacePlanClientTest {
    private static final String OK =
            "{\"courseId\":null,\"userId\":73,\"targetDistanceM\":1000,\"targetPaceSecPerKm\":360,\"segments\":[{\"sequence\":1,\"startDistanceM\":0,\"endDistanceM\":1000,\"paceSecPerKm\":360,\"paceRatio\":1}]}";
    private final JsonMapper mapper = JsonMapper.builder().build();
    private final SessionGoal goal = new SessionGoal(null, null, 1000, null, null);

    private AiPersonalPacePlanClient client(FakeAiServer server, Duration timeout) {
        return new AiPersonalPacePlanClient(
                HttpClient.newBuilder().followRedirects(HttpClient.Redirect.NEVER).build(),
                server.baseUri(),
                timeout,
                mapper);
    }

    @Test
    void distanceOnlyOmitsCourseAndGrade() {
        try (var server = new FakeAiServer()) {
            server.respond(200, OK);
            assertThat(client(server, Duration.ofSeconds(2)).plan(73L, goal)).isPresent();
            var request = server.received().getFirst();
            assertThat(request.path()).isEqualTo("/v1/pace/personal-plan");
            var json = mapper.readTree(request.body());
            assertThat(json.has("courseId")).isFalse();
            assertThat(json.has("gradeProfile")).isFalse();
            assertThat(json.get("selectedGoal").get("targetDistanceM").intValue()).isEqualTo(1000);
        }
    }

    @Test
    void transientFailureRetriesExactlyOnce() {
        try (var server = new FakeAiServer()) {
            server.respond(503, "{}");
            assertThat(client(server, Duration.ofSeconds(2)).plan(73L, goal)).isEmpty();
            assertThat(server.received()).hasSize(2);
        }
    }

    @Test
    void validationFailureDoesNotRetry() {
        try (var server = new FakeAiServer()) {
            server.respond(422, "{}");
            assertThat(client(server, Duration.ofSeconds(2)).plan(73L, goal)).isEmpty();
            assertThat(server.received()).hasSize(1);
        }
    }

    @Test
    void entireBodyIsCoveredByTimeout() {
        try (var server = new FakeAiServer()) {
            server.respond(200, OK).stallBody(Duration.ofSeconds(2));
            long start = System.nanoTime();
            assertThat(client(server, Duration.ofMillis(100)).plan(73L, goal)).isEmpty();
            assertThat(Duration.ofNanos(System.nanoTime() - start))
                    .isLessThan(Duration.ofSeconds(2));
        }
    }

    @Test
    void populationRequestHasNoUserOrPersonalization() {
        try (var server = new FakeAiServer()) {
            server.respond(
                    200,
                    "{\"targetDistanceM\":1000,\"recommendedPaceSecPerKm\":360,\"segments\":[{\"segmentSequence\":1,\"startDistanceM\":0,\"endDistanceM\":1000,\"recommendedPaceSecPerKm\":360,\"ratio\":1}]}");
            assertThat(
                            client(server, Duration.ofSeconds(2))
                                    .populationPlan(goal, BigDecimal.valueOf(360), null))
                    .isPresent();
            assertThat(server.received().getFirst().path()).isEqualTo("/v1/pace/plan");
            var json = mapper.readTree(server.received().getFirst().body());
            assertThat(json.has("userId")).isFalse();
            assertThat(json.has("personalization")).isFalse();
        }
    }

    @Test
    void populationRatiosAreDerivedFromPacesIncludingRemainder() {
        try (var server = new FakeAiServer()) {
            server.respond(
                    200,
                    "{\"targetDistanceM\":1500,\"recommendedPaceSecPerKm\":400,\"segments\":[{\"segmentSequence\":1,\"startDistanceM\":0,\"endDistanceM\":1000,\"recommendedPaceSecPerKm\":450,\"ratio\":1.5},{\"segmentSequence\":2,\"startDistanceM\":1000,\"endDistanceM\":1500,\"recommendedPaceSecPerKm\":300,\"ratio\":1}]}");
            var result =
                    client(server, Duration.ofSeconds(2))
                            .populationPlan(
                                    new SessionGoal(null, null, 1500, null, null),
                                    BigDecimal.valueOf(400),
                                    null)
                            .orElseThrow();
            assertThat(result.pace()).isEqualByComparingTo("400");
            assertThat(result.segments().getFirst().ratio()).isEqualByComparingTo("1.125");
            assertThat(result.segments().getLast().ratio()).isEqualByComparingTo("0.75");
        }
    }
}
