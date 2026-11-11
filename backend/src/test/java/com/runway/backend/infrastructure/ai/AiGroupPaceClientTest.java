package com.runway.backend.infrastructure.ai;

import static org.assertj.core.api.Assertions.assertThat;
import com.runway.backend.domain.grouprun.pace.GroupPacePort;
import com.runway.backend.domain.coaching.decide.PaceDecideRequest.History;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.Collections;
import java.util.List;

class AiGroupPaceClientTest {
    private final JsonMapper mapper = JsonMapper.builder().build();
    private static final String OK = """
            {"groupPaceSecPerKm":375.0,"changed":true,"direction":"SLOW","reason":"HR_LIMIT",
             "strugglingCount":1,"excludedCount":1,"paceOnlyCount":1,"warnings":[],"modelVersion":"test"}
            """;

    private GroupPacePort.Request request() {
        return request(0.25);
    }

    private GroupPacePort.Request request(Double progressRatio) {
        return new GroupPacePort.Request(7, 360, null, 365, 120, progressRatio,
                Instant.parse("2026-11-09T00:00:00Z"), null,
                List.of(new GroupPacePort.Participant(null, false,
                        new History(Collections.nCopies(360, null), Collections.nCopies(360, null),
                                Collections.nCopies(360, null)), null)));
    }

    @Test
    void success_acceptsNumericPaceAndSendsCamelCaseNullConsent() {
        try (var server = new FakeAiServer().respond(200, OK)) {
            var client = new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofSeconds(2));
            assertThat(client.evaluate(request())).get()
                    .extracting(GroupPacePort.Result::groupPaceSecPerKm).isEqualTo(375);
            var received = server.received().getFirst();
            assertThat(received.path()).isEqualTo("/v1/group/pace");
            var body = mapper.readTree(received.body());
            assertThat(body.get("now").asString()).isEqualTo("2026-11-09T00:00:00Z");
            assertThat(body.get("progressRatio").doubleValue()).isEqualTo(0.25);
            assertThat(body.get("participants").get(0).get("userId").isNull()).isTrue();
            assertThat(body.get("participants").get(0).get("history").get("hrBpm").size()).isEqualTo(360);
        }
    }

    @Test
    void noDistanceGoal_sendsExplicitNullProgressRatio() {
        try (var server = new FakeAiServer().respond(200, OK)) {
            var client = new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofSeconds(2));
            assertThat(client.evaluate(request(null))).isPresent();
            var body = mapper.readTree(server.received().getFirst().body());
            assertThat(body.has("progressRatio")).isTrue();
            assertThat(body.get("progressRatio").isNull()).isTrue();
        }
    }

    @Test
    void paceMode_isSentOnlyForGoal() {
        try (var server = new FakeAiServer().respond(200, OK).respond(200, OK)) {
            var client = new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofSeconds(2));
            var base = request();
            var goal = new GroupPacePort.Request(base.groupRunId(), base.currentGroupPaceSecPerKm(),
                    base.goalPaceSecPerKm(), base.startRecommendedPaceSecPerKm(), base.elapsedSec(),
                    base.progressRatio(), base.now(), base.lastChange(), base.participants(), "GOAL");
            assertThat(client.evaluate(base)).isPresent();
            assertThat(client.evaluate(goal)).isPresent();
            assertThat(mapper.readTree(server.received().get(0).body()).has("paceMode")).isFalse();
            assertThat(mapper.readTree(server.received().get(1).body()).get("paceMode").asString())
                    .isEqualTo("GOAL");
        }
    }

    @Test
    void unavailable_doesNotRetry() {
        try (var server = new FakeAiServer().respond(503, "{}")) {
            assertThat(new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofSeconds(2))
                    .evaluate(request())).isEmpty();
            assertThat(server.received()).hasSize(1);
        }
    }

    @Test
    void timeout_includesStalledBodyAndDoesNotRetry() {
        try (var server = new FakeAiServer().respond(200, OK).stallBody(Duration.ofSeconds(2))) {
            long start = System.nanoTime();
            assertThat(new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofMillis(100))
                    .evaluate(request())).isEmpty();
            assertThat(Duration.ofNanos(System.nanoTime() - start)).isLessThan(Duration.ofSeconds(2));
            assertThat(server.received()).hasSize(1);
        }
    }

    @Test
    void malformedOrInconsistentResponse_isIgnored() {
        for (String bad : List.of(OK.replace("375.0", "-1"), OK.replace("\"SLOW\"", "\"HOLD\""),
                OK.replace("\"strugglingCount\":1", "\"strugglingCount\":-1"),
                OK.replace("\"warnings\":[]", "\"warnings\":[123]"))) {
            try (var server = new FakeAiServer().respond(200, bad)) {
                assertThat(new AiGroupPaceClient(server.baseUri().toString(), mapper, Duration.ofSeconds(2))
                        .evaluate(request())).isEmpty();
            }
        }
    }
}
