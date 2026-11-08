package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import com.runway.backend.domain.session.service.PostRunAnalysisService;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.session.service.SessionCoachingService;
import com.runway.backend.domain.session.stream.SessionStreamChanged;
import com.runway.backend.domain.session.stream.SessionStreamRegistry;
import com.runway.backend.global.security.JwtAccessTokenService;
import com.runway.backend.global.security.SecurityTestSupport;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.concurrent.BlockingQueue;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import javax.crypto.spec.SecretKeySpec;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.test.context.TestPropertySource;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Testcontainers;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * S10 SSE — 작업 계획 AC-1~AC-5. 실제 HTTP 스트림을 읽어 이벤트 이름·순서·스냅샷 버전을 확인한다. heartbeat 간격은 테스트에서 줄인다. 모든 값은
 * 합성 데이터다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
@TestPropertySource(properties = "runway.session-stream.heartbeat-interval=700ms")
class RunningSessionEventsIntegrationTest extends RunningSessionIntegrationSupport {

    private static final JsonMapper JSON = JsonMapper.builder().build();
    private static final Duration WAIT = Duration.ofSeconds(10);
    private static final String T1 = "2026-10-28T01:00:01Z";

    @LocalServerPort private int port;
    @Autowired private SessionStreamRegistry registry;
    @Autowired private RunningSessionControlService controlService;
    @Autowired private SessionCoachingService coachingService;
    @Autowired private ApplicationEventPublisher events;
    @Autowired private TransactionTemplate tx;
    @Autowired private PostRunAnalysisService analysisService;

    private final HttpClient http = HttpClient.newHttpClient();
    private Stream ownedStream;

    @AfterEach
    void closeStream() {
        if (ownedStream != null) {
            ownedStream.close();
        }
    }

    /** 수신한 SSE 이벤트. 주석(heartbeat)은 name=":"로 기록한다. */
    private record Event(String name, JsonNode data) {}

    /** 열린 연결. 별도 스레드가 줄을 읽어 이벤트 단위로 큐에 넣는다. */
    private final class Stream implements AutoCloseable {
        final int status;
        final String contentType;
        final String errorBody;
        final BlockingQueue<Event> received = new LinkedBlockingQueue<>();
        volatile boolean ended;
        private final java.util.stream.Stream<String> lines;

        Stream(HttpResponse<java.util.stream.Stream<String>> response) {
            status = response.statusCode();
            contentType = response.headers().firstValue("Content-Type").orElse("");
            lines = response.body();
            if (status != 200) {
                errorBody = String.join("\n", lines.toList());
                ended = true;
                return;
            }
            errorBody = null;
            Thread reader =
                    new Thread(
                            () -> {
                                String name = null;
                                StringBuilder data = new StringBuilder();
                                try {
                                    for (String line : (Iterable<String>) lines::iterator) {
                                        if (line.startsWith(":")) {
                                            received.add(new Event(":", null));
                                        } else if (line.startsWith("event:")) {
                                            name = line.substring(6).trim();
                                        } else if (line.startsWith("data:")) {
                                            data.append(line.substring(5));
                                        } else if (line.isEmpty() && name != null) {
                                            received.add(new Event(name, JSON.readTree(data.toString())));
                                            name = null;
                                            data.setLength(0);
                                        }
                                    }
                                } catch (RuntimeException ignored) {
                                    // 연결이 닫혔다.
                                } finally {
                                    ended = true;
                                }
                            });
            reader.setDaemon(true);
            reader.start();
        }

        /** 다음 이름 있는 이벤트(heartbeat 주석 제외). */
        Event next() throws InterruptedException {
            Instant deadline = Instant.now().plus(WAIT);
            while (Instant.now().isBefore(deadline)) {
                Event event = received.poll(100, TimeUnit.MILLISECONDS);
                if (event != null && !":".equals(event.name())) {
                    return event;
                }
            }
            throw new AssertionError("이벤트를 받지 못함");
        }

        /** 조건에 맞는 이벤트가 올 때까지 앞의 이벤트(heartbeat 스냅샷 포함)를 건너뛴다. */
        Event until(java.util.function.Predicate<Event> matches) throws InterruptedException {
            Instant deadline = Instant.now().plus(WAIT);
            while (Instant.now().isBefore(deadline)) {
                Event event = received.poll(100, TimeUnit.MILLISECONDS);
                if (event != null && !":".equals(event.name()) && matches.test(event)) {
                    return event;
                }
            }
            throw new AssertionError("조건에 맞는 이벤트를 받지 못함");
        }

        /** 조건에 맞는 이벤트가 올 때까지 앞의 이벤트를 건너뛴다. */
        Event until(String name, long minVersion) throws InterruptedException {
            Instant deadline = Instant.now().plus(WAIT);
            while (Instant.now().isBefore(deadline)) {
                Event event = received.poll(100, TimeUnit.MILLISECONDS);
                if (event != null
                        && name.equals(event.name())
                        && event.data().get("stateVersion").longValue() >= minVersion) {
                    return event;
                }
            }
            throw new AssertionError(name + " v" + minVersion + " 이벤트를 받지 못함");
        }

        boolean awaitHeartbeat() throws InterruptedException {
            Instant deadline = Instant.now().plus(WAIT);
            while (Instant.now().isBefore(deadline)) {
                Event event = received.poll(100, TimeUnit.MILLISECONDS);
                if (event != null && ":".equals(event.name())) {
                    return true;
                }
            }
            return false;
        }

        /** 지금까지 받은 이벤트 이름(주석 제외). */
        List<String> drainNames() {
            List<Event> drained = new ArrayList<>();
            received.drainTo(drained);
            return drained.stream().map(Event::name).filter(name -> !":".equals(name)).toList();
        }

        boolean awaitEnd() throws InterruptedException {
            Instant deadline = Instant.now().plus(WAIT);
            while (!ended && Instant.now().isBefore(deadline)) {
                Thread.sleep(50);
            }
            return ended;
        }

        @Override
        public void close() {
            lines.close();
        }
    }

    private Stream open(String authorization, Object sessionId) throws Exception {
        HttpRequest.Builder request =
                HttpRequest.newBuilder(
                                URI.create(
                                        "http://localhost:" + port + "/api/v1/running-sessions/"
                                                + sessionId + "/events"))
                        .header("Accept", "text/event-stream")
                        .GET();
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        Stream stream = new Stream(http.send(request.build(), HttpResponse.BodyHandlers.ofLines()));
        ownedStream = stream;
        return stream;
    }

    private Stream open(long user, long sessionId) throws Exception {
        return open(SecurityTestSupport.bearer(user), sessionId);
    }

    // ---- AC-1 연결 전 검사 ----

    @Test
    void 인증_소유_존재_ID_검사는_스트림을_열기_전에_HTTP_오류로_거절한다() throws Exception {
        long sessionId = insertReadySession();
        long deleted = insertSession(otherUserId, "COMPLETED", 3, otherWatchId, otherPhoneId, "READY", null);
        jdbc.update("UPDATE running_sessions SET deleted_at=now() WHERE id=?", deleted);

        assertThat(open((String) null, sessionId).status).isEqualTo(401);
        Stream forbidden = open(otherUserId, sessionId);
        assertThat(forbidden.status).isEqualTo(403);
        assertThat(forbidden.errorBody).contains("SESSION_FORBIDDEN");
        Stream missing = open(userId, 999_999_999L);
        assertThat(missing.status).isEqualTo(404);
        assertThat(missing.errorBody).contains("SESSION_NOT_FOUND");
        assertThat(open(otherUserId, deleted).status).isEqualTo(404);
        for (Object badId : new Object[] {0L, "abc", "99999999999999999999"}) {
            Stream invalid = open(SecurityTestSupport.bearer(userId), badId);
            assertThat(invalid.status).as("id %s", badId).isEqualTo(400);
            assertThat(invalid.contentType).startsWith("application/json");
            assertThat(invalid.errorBody).contains("VALIDATION_ERROR");
        }
        assertThat(registry.subscriberCount(sessionId)).isZero();
    }

    @Test
    void 건강정보_미동의여도_구독할_수_있다() throws Exception {
        jdbc.update("UPDATE users SET health_data_access='DISAGREE' WHERE id=?", userId);
        long sessionId = insertReadySession();

        Stream stream = open(userId, sessionId);

        assertThat(stream.status).isEqualTo(200);
        assertThat(stream.next().name()).isEqualTo("SESSION_STATE");
    }

    // ---- AC-2 최초·변경 스냅샷 ----

    @Test
    void 연결_직후_전체_스냅샷과_커밋된_변경마다_새_스냅샷을_보낸다() throws Exception {
        long sessionId = insertReadySession();
        Stream stream = open(userId, sessionId);
        assertThat(stream.contentType).startsWith("text/event-stream");

        Event first = stream.next();
        assertThat(first.name()).isEqualTo("SESSION_STATE");
        assertThat(first.data().get("sessionId").longValue()).isEqualTo(sessionId);
        assertThat(first.data().get("state").stringValue()).isEqualTo("READY");
        assertThat(first.data().get("stateVersion").longValue()).isEqualTo(1);
        for (String key :
                new String[] {
                    "controlDeviceId", "relayDeviceId", "currentBpm", "goal", "plan", "analysis",
                    "coaching", "pendingCommand", "lastCommand", "serverReceiveAt", "serverSendAt",
                    "recordingMode", "groupEndedAt"
                }) {
            assertThat(first.data().has(key)).as(key).isTrue();
        }
        assertThat(first.data().has("commandId")).isFalse();

        String approved =
                mockMvc.perform(postControl(userId, sessionId, "start", requestBody(watchId, 1)))
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long commandId = JSON.readTree(approved).get("commandId").longValue();
        Event pending = stream.until(event -> !event.data().get("pendingCommand").isNull());
        assertThat(pending.name()).isEqualTo("SESSION_STATE");
        assertThat(pending.data().get("pendingCommand").get("commandId").longValue())
                .isEqualTo(commandId);

        mockMvc.perform(
                postControl(userId, sessionId, "start", resultBody(commandId, watchId, "APPLIED", T1)));
        Event started = stream.until("SESSION_STATE", 2);
        assertThat(started.data().get("state").stringValue()).isEqualTo("RUNNING");
    }

    @Test
    void 롤백된_변경은_보내지_않는다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 3, watchId, phoneId, "PENDING", null);
        Stream stream = open(userId, sessionId);
        stream.next();

        try {
            tx.executeWithoutResult(
                    status -> {
                        events.publishEvent(SessionStreamChanged.analysis(sessionId));
                        status.setRollbackOnly();
                    });
        } catch (RuntimeException ignored) {
            // 롤백 지정
        }

        // 롤백된 트랜잭션의 ANALYSIS_STATUS는 오지 않고, heartbeat의 SESSION_STATE만 온다.
        assertThat(stream.awaitHeartbeat()).isTrue();
        assertThat(stream.drainNames()).doesNotContain("ANALYSIS_STATUS");
    }

    @Test
    void S07_취소와_S08_목표_변경도_새_스냅샷을_보낸다() throws Exception {
        long sessionId = insertReadySession();
        Stream stream = open(userId, sessionId);
        stream.next();

        mockMvc.perform(
                patchRequest(
                        userId,
                        sessionId,
                        "{\"operation\":\"UPDATE_GOAL\",\"expectedVersion\":1,\"targetPaceSecPerKm\":300}"));
        Event goal = stream.until("SESSION_STATE", 2);
        assertThat(goal.data().get("goal").get("targetPaceSecPerKm").doubleValue()).isEqualTo(300.0);

        mockMvc.perform(cancelRequest(userId, sessionId));
        Event cancelled = stream.until("SESSION_STATE", 3);
        assertThat(cancelled.data().get("state").stringValue()).isEqualTo("CANCELLED");
    }

    // ---- AC-3 heartbeat ----

    @Test
    void 주기마다_heartbeat_주석과_최신_스냅샷을_보낸다() throws Exception {
        long sessionId = insertReadySession();
        Stream stream = open(userId, sessionId);
        stream.next();

        assertThat(stream.awaitHeartbeat()).isTrue();
        Event snapshot = stream.next();
        assertThat(snapshot.name()).isEqualTo("SESSION_STATE");
        assertThat(snapshot.data().get("sessionId").longValue()).isEqualTo(sessionId);
    }

    // ---- AC-4 종료 ----

    @Test
    void 세션을_삭제하면_스트림을_닫는다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 3, watchId, phoneId, "READY", null);
        Stream stream = open(userId, sessionId);
        stream.next();

        mockMvc.perform(deleteRequest(userId, sessionId));

        assertThat(stream.awaitEnd()).isTrue();
        assertThat(registry.subscriberCount(sessionId)).isZero();
    }

    @Test
    void 회원이_탈퇴하면_다음_전송_전에_스트림을_닫는다() throws Exception {
        long sessionId = insertReadySession();
        Stream stream = open(userId, sessionId);
        stream.next();

        jdbc.update(
                "UPDATE users SET account_status='WITHDRAWN', withdrawn_at=now() WHERE id=?", userId);

        assertThat(stream.awaitEnd()).isTrue();
    }

    @Test
    void 토큰_만료시각에_스트림을_닫는다() throws Exception {
        long sessionId = insertReadySession();
        var key = new SecretKeySpec(Base64.getDecoder().decode(SecurityTestSupport.KEY), "HmacSHA256");
        var issuer =
                new JwtAccessTokenService(
                        new NimbusJwtEncoder(new ImmutableSecret<>(key)), Clock.systemUTC());
        String shortToken =
                "Bearer " + issuer.issue(userId, Instant.now().plusSeconds(2)).accessToken();

        Stream stream = open(shortToken, sessionId);
        assertThat(stream.status).isEqualTo(200);
        stream.next();

        assertThat(stream.awaitEnd()).isTrue();
    }

    // ---- AC-5 이벤트 종류 ----

    @Test
    void 코칭_발행은_COACHING_GUIDE로_보낸다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        startedSecondsAgo(sessionId, 180);
        Stream stream = open(userId, sessionId);
        stream.next();

        long commandId = coachingService.issueIfDue(sessionId).orElseThrow().getId();

        Event guide = stream.until("COACHING_GUIDE", 2);
        assertThat(guide.data().get("coaching").get("commandId").longValue()).isEqualTo(commandId);
        assertThat(guide.data().get("coaching").get("targetBpm").intValue()).isEqualTo(160);
        assertThat(guide.data().get("pendingCommand").get("coachingGuide").get("commandId").longValue())
                .isEqualTo(commandId);
    }

    @Test
    void 그룹_강제_종료의_END_승인은_SERVER_END와_commandId로_보낸다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        joinGroup(insertGroupRun("COMPLETED", true), userId, sessionId);
        Stream stream = open(userId, sessionId);
        stream.next();

        tx.executeWithoutResult(status -> controlService.forceFinishGroupParticipant(sessionId));

        Event end = stream.until("SERVER_END", 2);
        long endCommandId =
                jdbc.queryForObject(
                        "SELECT id FROM session_control_events WHERE session_id=? AND action='END'",
                        Long.class,
                        sessionId);
        assertThat(end.data().get("commandId").longValue()).isEqualTo(endCommandId);
        assertThat(end.data().get("groupEndedAt").stringValue()).isEqualTo("2026-10-29T01:00:00Z");
        assertThat(end.data().get("pendingCommand").get("action").stringValue()).isEqualTo("END");
    }

    @Test
    void 이미_미확정_END가_있으면_그_명령으로_SERVER_END를_보낸다() throws Exception {
        long sessionId = insertSession(userId, "RUNNING", 2, watchId, phoneId, "PENDING", null);
        joinGroup(insertGroupRun("COMPLETED", true), userId, sessionId);
        long existing = insertCommand(sessionId, watchId, "END", 2, "PENDING");
        Stream stream = open(userId, sessionId);
        stream.next();

        tx.executeWithoutResult(status -> controlService.forceFinishGroupParticipant(sessionId));

        Event end = stream.until("SERVER_END", 2);
        assertThat(end.data().get("commandId").longValue()).isEqualTo(existing);
        assertThat(commandCount(sessionId)).isEqualTo(1);
    }

    @Test
    void 종료_후_분석의_상태_변경은_ANALYSIS_STATUS로_보낸다() throws Exception {
        long sessionId = insertSession(userId, "COMPLETED", 3, watchId, phoneId, "PENDING", null);
        Stream stream = open(userId, sessionId);
        stream.next();

        PostRunAnalysisService.Outcome outcome = analysisService.analyze(sessionId);

        // PROCESSING 전환(버전 유지)과 READY/FAILED 확정(버전 +1)이 각각 ANALYSIS_STATUS로 나간다. 스냅샷은 전송 시점에 읽으므로 첫 이벤트의
        // 상태는 이미 확정된 값일 수 있다.
        stream.until("ANALYSIS_STATUS", 3);
        Event done = stream.until("ANALYSIS_STATUS", 4);
        assertThat(done.data().get("analysis").get("status").stringValue())
                .isEqualTo(outcome == PostRunAnalysisService.Outcome.READY ? "READY" : "FAILED");
    }
}
