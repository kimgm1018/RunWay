package com.runway.backend.infrastructure.naver;

import com.runway.backend.domain.place.search.PlaceSearchPort;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonPoint;
import java.net.URI;
import java.net.URLEncoder;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.ByteBuffer;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionStage;
import java.util.concurrent.Flow;
import java.util.concurrent.TimeUnit;
import org.springframework.web.util.HtmlUtils;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 외부 본문·검색어·좌표·Secret을 예외 원인/로그에 남기지 않는다. */
public final class NaverPlaceSearchClient implements PlaceSearchPort {
    static final int MAX_BYTES = 128 * 1024;
    private final PlaceSearchProperties properties;
    private final JsonMapper mapper;
    private final HttpClient client;
    private final URI localEndpoint;
    private final URI geocodeEndpoint;
    private final Duration timeout;

    public NaverPlaceSearchClient(PlaceSearchProperties properties, JsonMapper mapper) {
        this(properties, mapper,
                // 개발자센터 검색 API는 2026-07-31부터 신규 발급이 막혀 NAVER API HUB 지역 검색을 쓴다.
                URI.create("https://naverapihub.apigw.ntruss.com/search/v1/local"),
                URI.create("https://maps.apigw.ntruss.com/map-geocode/v2/geocode"),
                Duration.ofSeconds(5));
    }

    // 주소 교체는 동일 패키지의 합성 HTTP 테스트에만 사용한다. 운영 주소는 고정한다.
    NaverPlaceSearchClient(PlaceSearchProperties properties, JsonMapper mapper,
            URI localEndpoint, URI geocodeEndpoint, Duration timeout) {
        this.properties = properties;
        this.mapper = mapper;
        this.localEndpoint = localEndpoint;
        this.geocodeEndpoint = geocodeEndpoint;
        this.timeout = timeout;
        this.client = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(1))
                .followRedirects(HttpClient.Redirect.NEVER).build();
    }

    @Override
    public List<Place> search(String query, GeoJsonPoint reference) {
        if (!properties.isEnabled()) throw unavailable();
        CompletableFuture<HttpResponse<byte[]>> local = null;
        CompletableFuture<HttpResponse<byte[]>> address = null;
        try {
            String encoded = URLEncoder.encode(query, StandardCharsets.UTF_8);
            var localRequest = request(localEndpoint, "query=" + encoded + "&display=5")
                    .header("X-NCP-APIGW-API-KEY-ID", properties.getSearchClientId())
                    .header("X-NCP-APIGW-API-KEY", properties.getSearchClientSecret()).build();
            String coordinate = reference == null ? "" : "&coordinate="
                    + reference.longitude() + "," + reference.latitude();
            var addressRequest = request(geocodeEndpoint, "query=" + encoded + "&count=5" + coordinate)
                    .header("x-ncp-apigw-api-key-id", properties.getMapsKeyId())
                    .header("x-ncp-apigw-api-key", properties.getMapsKey()).build();
            local = client.sendAsync(localRequest, ignored -> new LimitedBody());
            address = client.sendAsync(addressRequest, ignored -> new LimitedBody());
            CompletableFuture.allOf(local, address).get(timeout.toMillis(), TimeUnit.MILLISECONDS);
            var results = new ArrayList<Place>();
            parseLocal(read(local.join()), results);
            parseAddresses(read(address.join()), results);
            return List.copyOf(results);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw unavailable();
        } catch (Exception e) {
            throw unavailable();
        } finally {
            if (local != null && !local.isDone()) local.cancel(true);
            if (address != null && !address.isDone()) address.cancel(true);
        }
    }

    private HttpRequest.Builder request(URI endpoint, String query) {
        return HttpRequest.newBuilder(URI.create(endpoint + "?" + query))
                .timeout(timeout).header("Accept", "application/json").GET();
    }

    private JsonNode read(HttpResponse<byte[]> response) {
        if (response.statusCode() != 200) throw unavailable();
        return mapper.readTree(response.body());
    }

    private void parseLocal(JsonNode root, List<Place> results) {
        JsonNode items = array(root, "items");
        if (items.size() > 5) throw unavailable();
        for (JsonNode item : items) {
            String name = HtmlUtils.htmlUnescape(stripTags(text(item, "title"))).strip();
            String address = address(item, "roadAddress", "address");
            if (name.isEmpty()) throw unavailable();
            results.add(new Place(name, address, GeoJsonPoint.of(
                    wgs84(number(item, "mapx")), wgs84(number(item, "mapy")))));
        }
    }

    private void parseAddresses(JsonNode root, List<Place> results) {
        if (!"OK".equals(text(root, "status"))) throw unavailable();
        JsonNode items = array(root, "addresses");
        if (items.size() > 5) throw unavailable();
        for (JsonNode item : items) {
            String address = address(item, "roadAddress", "jibunAddress");
            results.add(new Place(address, address,
                    GeoJsonPoint.of(number(item, "x"), number(item, "y"))));
        }
    }

    private static String address(JsonNode item, String preferred, String fallback) {
        String address = text(item, preferred).strip();
        if (address.isEmpty()) address = text(item, fallback).strip();
        if (address.isEmpty()) throw unavailable();
        return address;
    }

    private static JsonNode array(JsonNode root, String name) {
        JsonNode node = root == null ? null : root.get(name);
        if (node == null || !node.isArray()) throw unavailable();
        return node;
    }

    private static String text(JsonNode item, String name) {
        JsonNode node = item.get(name);
        if (node == null || !node.isString()) throw unavailable();
        String value = node.asString();
        if (value.length() > 2048) throw unavailable();
        return value;
    }

    /** 태그 제거는 선형 시간으로 수행한다. 닫히지 않은 태그도 되돌아가며 재검색하지 않는다. */
    private static String stripTags(String text) {
        var result = new StringBuilder(text.length());
        boolean inTag = false;
        for (int i = 0; i < text.length(); i++) {
            char ch = text.charAt(i);
            if (ch == '<') inTag = true;
            else if (ch == '>' && inTag) inTag = false;
            else if (!inTag) result.append(ch);
        }
        return result.toString();
    }

    private static double number(JsonNode item, String name) {
        JsonNode node = item.get(name);
        if (node == null || !(node.isString() || node.isNumber())) throw unavailable();
        double value = Double.parseDouble(node.asString());
        if (!Double.isFinite(value)) throw unavailable();
        return value;
    }

    /** 지역 검색 좌표는 WGS84에 10^7을 곱한 정수로 오며, 소수 경위도로 오면 그대로 쓴다. */
    private static double wgs84(double value) {
        return Math.abs(value) > 180 ? value / 10_000_000 : value;
    }

    private static ApiException unavailable() {
        return new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }

    private static final class LimitedBody implements HttpResponse.BodySubscriber<byte[]> {
        private final HttpResponse.BodySubscriber<byte[]> delegate = HttpResponse.BodySubscribers.ofByteArray();
        private Flow.Subscription subscription;
        private long size;
        private boolean failed;

        @Override
        public CompletionStage<byte[]> getBody() { return delegate.getBody(); }

        @Override
        public void onSubscribe(Flow.Subscription subscription) {
            this.subscription = subscription;
            delegate.onSubscribe(subscription);
        }

        @Override
        public void onNext(List<ByteBuffer> buffers) {
            if (failed) return;
            for (ByteBuffer buffer : buffers) size += buffer.remaining();
            if (size > MAX_BYTES) {
                failed = true;
                subscription.cancel();
                delegate.onError(unavailable());
            } else {
                delegate.onNext(buffers);
            }
        }

        @Override
        public void onError(Throwable error) { delegate.onError(unavailable()); }

        @Override
        public void onComplete() { if (!failed) delegate.onComplete(); }
    }
}
