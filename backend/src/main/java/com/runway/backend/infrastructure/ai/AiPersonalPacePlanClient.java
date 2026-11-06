package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.session.entity.SessionGoal;
import com.runway.backend.domain.session.service.PersonalPacePlanPort;

import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

import java.math.BigDecimal;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.ArrayList;
import java.util.Optional;
import java.util.concurrent.*;

/**
 * AI09. Two attempts for transient transport/HTTP failures; bounded body and whole-attempt
 * deadline.
 */
public final class AiPersonalPacePlanClient implements PersonalPacePlanPort {
    private final HttpClient client;
    private final URI endpoint;
    private final URI populationEndpoint;
    private final Duration timeout;
    private final JsonMapper mapper;

    public AiPersonalPacePlanClient(
            HttpClient client, URI base, Duration timeout, JsonMapper mapper) {
        this.client = client;
        this.endpoint = base == null ? null : base.resolve("/v1/pace/personal-plan");
        this.populationEndpoint = base == null ? null : base.resolve("/v1/pace/plan");
        this.timeout = timeout;
        this.mapper = mapper;
    }

    @Override
    public Optional<Result> plan(Long userId, SessionGoal goal) {
        if (endpoint == null) return Optional.empty();
        var body = mapper.createObjectNode();
        if (userId != null) body.put("userId", userId);
        if (goal.courseId() != null) body.put("courseId", goal.courseId());
        var selected = body.putObject("selectedGoal");
        if (goal.distanceM() != null) selected.put("targetDistanceM", goal.distanceM());
        if (goal.durationSec() != null) selected.put("targetDurationSec", goal.durationSec());
        if (goal.paceSecPerKm() != null) selected.put("targetPaceSecPerKm", goal.paceSecPerKm());
        return send(body, goal, userId, false);
    }

    @Override
    public Optional<Result> populationPlan(
            SessionGoal goal, BigDecimal averagePace, String profile) {
        if (populationEndpoint == null) return Optional.empty();
        var body = mapper.createObjectNode();
        if (goal.courseId() != null) body.put("courseId", goal.courseId());
        if (goal.distanceM() != null) body.put("targetDistanceM", goal.distanceM());
        if (goal.durationSec() != null) body.put("targetDurationSec", goal.durationSec());
        if (goal.paceSecPerKm() != null) body.put("targetPaceSecPerKm", goal.paceSecPerKm());
        if (averagePace != null) body.put("averagePaceSecPerKm", averagePace);
        if (profile != null) body.set("gradeProfile", mapper.readTree(profile));
        return send(body, goal, null, true);
    }

    private Optional<Result> send(
            tools.jackson.databind.node.ObjectNode body,
            SessionGoal goal,
            Long userId,
            boolean population) {
        byte[] payload = mapper.writeValueAsBytes(body);
        for (int attempt = 0; attempt < 2; attempt++) {
            var request =
                    HttpRequest.newBuilder(population ? populationEndpoint : endpoint)
                            .timeout(timeout)
                            .header("Content-Type", "application/json")
                            .header("Accept", "application/json")
                            .header(
                                    "X-Request-Deadline",
                                    Long.toString(System.currentTimeMillis() + timeout.toMillis()))
                            .POST(HttpRequest.BodyPublishers.ofByteArray(payload))
                            .build();
            CompletableFuture<HttpResponse<byte[]>> pending =
                    client.sendAsync(
                            request,
                            info ->
                                    new AiHrPersonalizeClient.LimitedBodySubscriber(
                                            info.headers().firstValueAsLong("Content-Length")));
            try {
                var response = pending.get(timeout.toNanos(), TimeUnit.NANOSECONDS);
                int status = response.statusCode();
                if (status == 200) return parse(response.body(), goal, userId, population);
                if (status != 429 && status != 502 && status != 503 && status != 504)
                    return Optional.empty();
            } catch (InterruptedException e) {
                pending.cancel(true);
                Thread.currentThread().interrupt();
                return Optional.empty();
            } catch (TimeoutException e) {
                pending.cancel(true);
            } catch (ExecutionException e) {
                if (e.getCause() instanceof AiHrPersonalizeClient.ResponseTooLarge)
                    return Optional.empty();
            }
        }
        return Optional.empty();
    }

    private Optional<Result> parse(
            byte[] bytes, SessionGoal goal, Long userId, boolean population) {
        try {
            JsonNode root = mapper.readTree(bytes);
            if (root == null || !root.isObject()) return Optional.empty();
            JsonNode segments = root.get("segments");
            if (segments == null || !segments.isArray() || segments.size() > 45)
                return Optional.empty();
            var values = new ArrayList<Segment>();
            for (JsonNode s : segments)
                values.add(
                        new Segment(
                                integer(s, population ? "segmentSequence" : "sequence"),
                                number(s, "startDistanceM"),
                                number(s, "endDistanceM"),
                                number(s, population ? "recommendedPaceSecPerKm" : "paceSecPerKm"),
                                number(s, population ? "ratio" : "paceRatio")));
            if (population && !values.isEmpty()) {
                BigDecimal distance = number(root, "targetDistanceM");
                if (distance.signum() <= 0) return Optional.empty();
                BigDecimal total = BigDecimal.ZERO;
                for (var segment : values)
                    total =
                            total.add(
                                    segment.end()
                                            .subtract(segment.start())
                                            .multiply(segment.pace()));
                BigDecimal mean = total.divide(distance, java.math.MathContext.DECIMAL64);
                if (mean.signum() <= 0) return Optional.empty();
                var normalized = new ArrayList<Segment>();
                for (var segment : values)
                    normalized.add(
                            new Segment(
                                    segment.sequence(),
                                    segment.start(),
                                    segment.end(),
                                    segment.pace(),
                                    segment.pace().divide(mean, java.math.MathContext.DECIMAL64)));
                return Optional.of(new Result(goal.courseId(), null, distance, mean, normalized));
            }
            return Optional.of(
                    new Result(
                            population ? goal.courseId() : id(root, "courseId"),
                            population ? null : id(root, "userId"),
                            number(root, "targetDistanceM"),
                            number(
                                    root,
                                    population ? "recommendedPaceSecPerKm" : "targetPaceSecPerKm"),
                            values));
        } catch (RuntimeException e) {
            return Optional.empty();
        }
    }

    private static BigDecimal number(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null || !v.isNumber()) throw new IllegalArgumentException();
        BigDecimal value = v.decimalValue();
        if (value.scale() > 32 || value.scale() < -32 || value.precision() > 32)
            throw new IllegalArgumentException();
        return value;
    }

    private static int integer(JsonNode n, String key) {
        return number(n, key).intValueExact();
    }

    private static Long id(JsonNode n, String key) {
        JsonNode v = n.get(key);
        if (v == null) throw new IllegalArgumentException();
        return v.isNull() ? null : number(n, key).longValueExact();
    }
}
