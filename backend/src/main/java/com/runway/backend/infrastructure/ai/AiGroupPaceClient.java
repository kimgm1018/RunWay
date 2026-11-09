package com.runway.backend.infrastructure.ai;

import com.runway.backend.domain.grouprun.pace.GroupPacePort;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;
import tools.jackson.databind.json.JsonMapper;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Duration;
import java.util.Optional;
import java.util.concurrent.TimeUnit;

/** AI10: no retry; five-second deadline covers headers and bounded response body. */
@Component
public class AiGroupPaceClient implements GroupPacePort {
    private final HttpClient client = HttpClient.newBuilder()
            .connectTimeout(Duration.ofSeconds(1))
            .followRedirects(HttpClient.Redirect.NEVER).build();
    private final URI endpoint;
    private final JsonMapper mapper;
    private final Duration timeout;

    @Autowired
    public AiGroupPaceClient(@Value("${runway.group-pace.base-url:}") String baseUrl,
            JsonMapper mapper) {
        this(baseUrl, mapper, Duration.ofSeconds(5));
    }

    AiGroupPaceClient(String baseUrl, JsonMapper mapper, Duration timeout) {
        URI base = AiHrConfig.parseBaseUrl(baseUrl);
        this.endpoint = base == null ? null : base.resolve("/v1/group/pace");
        this.mapper = mapper;
        this.timeout = timeout;
    }

    @Override
    public Optional<Result> evaluate(Request input) {
        if (endpoint == null) return Optional.empty();
        var request = HttpRequest.newBuilder(endpoint).timeout(timeout)
                .header("Content-Type", "application/json")
                .POST(HttpRequest.BodyPublishers.ofByteArray(mapper.writeValueAsBytes(input))).build();
        var pending = client.sendAsync(request,
                info -> new AiHrPersonalizeClient.LimitedBodySubscriber(
                        info.headers().firstValueAsLong("Content-Length")));
        try {
            HttpResponse<byte[]> response = pending.get(timeout.toNanos(), TimeUnit.NANOSECONDS);
            if (response.statusCode() != 200) return Optional.empty();
            var root = mapper.readTree(response.body());
            if (root == null || !root.isObject()) return Optional.empty();
            var paceValue = root.get("groupPaceSecPerKm");
            if (paceValue == null || !paceValue.isNumber()) return Optional.empty();
            int pace = paceValue.decimalValue().setScale(0, java.math.RoundingMode.HALF_UP)
                    .intValueExact();
            if (pace <= 0) return Optional.empty();
            for (String name : new String[]{"strugglingCount",
                    "excludedCount", "paceOnlyCount"}) {
                var v = root.get(name);
                if (v == null || !v.isIntegralNumber() || !v.canConvertToInt()
                        || v.intValue() < (name.equals("groupPaceSecPerKm") ? 1 : 0))
                    return Optional.empty();
            }
            if (!root.path("changed").isBoolean() || !root.path("direction").isString()
                    || !root.path("reason").isString() || !root.path("modelVersion").isString()
                    || !root.path("warnings").isArray()) return Optional.empty();
            for (var warning : root.path("warnings"))
                if (!warning.isString()) return Optional.empty();
            // Public G03/G10 pace fields remain integer seconds, with the existing HALF_UP rule.
            var warnings = new java.util.ArrayList<String>();
            root.path("warnings").forEach(w -> warnings.add(w.asString()));
            Result result = new Result(pace, root.get("changed").booleanValue(),
                    root.get("direction").asString(), root.get("reason").asString(),
                    root.get("strugglingCount").intValue(), root.get("excludedCount").intValue(),
                    root.get("paceOnlyCount").intValue(), warnings, root.get("modelVersion").asString());
            if (!(result.changed() ? java.util.Set.of("SLOW", "FAST") : java.util.Set.of("HOLD"))
                    .contains(result.direction())) return Optional.empty();
            if (result.changed() && (result.direction().equals("SLOW")
                    ? result.groupPaceSecPerKm() <= input.currentGroupPaceSecPerKm()
                    : result.groupPaceSecPerKm() >= input.currentGroupPaceSecPerKm()))
                return Optional.empty();
            if (!result.changed() && result.groupPaceSecPerKm() != input.currentGroupPaceSecPerKm())
                return Optional.empty();
            return Optional.of(result);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            return Optional.empty();
        } catch (Exception e) {
            return Optional.empty();
        } finally {
            if (!pending.isDone()) pending.cancel(true);
        }
    }
}
