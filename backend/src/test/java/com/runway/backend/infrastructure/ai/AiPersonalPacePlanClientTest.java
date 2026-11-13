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

    // S15P31E105-785: AI09 탐색 범위 끝에 걸렸는지(paceSearchBoundaryHit)를 읽는다. 없거나 boolean이 아니면 false.
    @Test
    void readsPaceSearchBoundaryHit() {
        for (var c : new String[][] {{",\"paceSearchBoundaryHit\":true", "true"},
                {",\"paceSearchBoundaryHit\":false", "false"}, {"", "false"},
                {",\"paceSearchBoundaryHit\":\"true\"", "false"}}) {
            try (var server = new FakeAiServer()) {
                server.respond(200, OK.substring(0, OK.length() - 1) + c[0] + "}");
                assertThat(client(server, Duration.ofSeconds(2)).plan(73L, goal).orElseThrow()
                                .paceSearchBoundaryHit())
                        .isEqualTo(Boolean.parseBoolean(c[1]));
            }
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

    // S15P31E105-533: 시간 초과로 끝난 첫 시도 뒤에는 남은 상한이 없으므로 다시 보내지 않는다(예전: 회당 상한 × 2회).
    @Test
    void timeoutCoversBothAttemptsTogether() {
        try (var server = new FakeAiServer()) {
            server.respond(200, OK).delay(Duration.ofSeconds(4));
            long start = System.nanoTime();
            assertThat(client(server, Duration.ofMillis(1500)).plan(73L, goal)).isEmpty();
            assertThat(Duration.ofNanos(System.nanoTime() - start))
                    .isLessThan(Duration.ofMillis(2500));
            assertThat(server.received()).hasSize(1);
        }
    }

    @Test
    void retryIsSkippedWhenTooLittleTimeRemains() {
        try (var server = new FakeAiServer()) {
            server.respond(503, "{}").delay(Duration.ofMillis(1000));
            assertThat(client(server, Duration.ofMillis(1500)).plan(73L, goal)).isEmpty();
            assertThat(server.received()).hasSize(1);
        }
    }

    @Test
    void bothAttemptsSendTheSameOverallDeadline() {
        try (var server = new FakeAiServer()) {
            server.respond(503, "{}");
            long before = System.currentTimeMillis();
            assertThat(client(server, Duration.ofSeconds(3)).plan(73L, goal)).isEmpty();
            long after = System.currentTimeMillis();
            assertThat(server.received()).hasSize(2);
            String first = server.received().get(0).deadline();
            assertThat(server.received().get(1).deadline()).isEqualTo(first);
            assertThat(Long.parseLong(first)).isBetween(before + 3000, after + 3000);
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
            // 상한이 1초보다 짧아도 첫 요청은 보낸다(재시도만 건너뛴다).
            assertThat(server.received()).hasSize(1);
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
