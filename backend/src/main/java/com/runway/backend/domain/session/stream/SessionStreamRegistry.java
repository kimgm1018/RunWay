package com.runway.backend.domain.session.stream;

import com.runway.backend.domain.session.dto.response.RunningSessionResponse;
import com.runway.backend.domain.session.service.SessionStreamQuery;

import jakarta.annotation.PreDestroy;

import lombok.extern.slf4j.Slf4j;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Queue;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ConcurrentLinkedQueue;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.RejectedExecutionException;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ThreadFactory;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.stream.Collectors;

/**
 * S10 구독 등록소. 단일 서버 메모리에 세션별 구독을 둔다(S15P31E105-257 D-6, 운영 서버 1대).
 *
 * <p>전송은 세션별 직렬 대기열로 실행한다. 같은 세션의 이벤트 순서는 보존하고, 서로 다른 세션은 작은 공용 스레드 풀에서 병렬로 보내 느린 연결 하나가 다른
 * 세션 전체를 막지 않게 한다. 최초 스냅샷도 등록 뒤에 읽으므로 그 사이 커밋된 변경이 빠지지 않는다. 전송마다 회원 탈퇴·세션 삭제를 다시 확인해 위반이면 스트림을
 * 닫는다. 토큰 만료는 구독 시 emitter 제한시간으로 닫는다. 끊긴 동안의 이벤트는 재생하지 않으며 클라이언트는 재접속 후 최신 스냅샷부터 확인한다. 인증정보·원본
 * 데이터는 로그에 남기지 않는다.
 */
@Slf4j
@Component
public class SessionStreamRegistry {

    private static final String HEARTBEAT = "heartbeat";

    /** 한 세션의 동시 연결 상한. 넘으면 가장 오래된 연결을 닫는다(재접속을 반복해도 연결이 쌓이지 않게). */
    static final int MAX_SUBSCRIBERS_PER_SESSION = 3;

    private static final int SENDER_THREADS = 4;

    private final SessionStreamQuery query;
    private final Duration maxLifetime;
    private final ScheduledExecutorService heartbeat;
    private final ExecutorService senders;
    private final Map<Long, List<Subscriber>> subscribers = new ConcurrentHashMap<>();
    private final Map<Long, Lane> lanes = new ConcurrentHashMap<>();

    public SessionStreamRegistry(
            SessionStreamQuery query,
            @Value("${runway.session-stream.heartbeat-interval:15s}") Duration heartbeatInterval,
            @Value("${runway.session-stream.max-lifetime:1h}") Duration maxLifetime) {
        this.query = query;
        this.maxLifetime = maxLifetime;
        this.heartbeat = Executors.newSingleThreadScheduledExecutor(daemon("session-stream-heartbeat"));
        this.senders = Executors.newFixedThreadPool(SENDER_THREADS, daemon("session-stream-send"));
        long interval = heartbeatInterval.toMillis();
        heartbeat.scheduleWithFixedDelay(
                this::heartbeatAll, interval, interval, TimeUnit.MILLISECONDS);
    }

    /**
     * 구독을 등록하고 최초 스냅샷 전송을 예약한다. 호출자는 그 전에 인증·소유권을 검사해 HTTP 오류로 거절해야 한다.
     *
     * @param tokenExpiresAt 접근 토큰 만료시각. 이 시각에 스트림을 닫는다. 알 수 없으면 null
     */
    public SseEmitter subscribe(long userId, long sessionId, Instant tokenExpiresAt) {
        Duration lifetime = maxLifetime;
        if (tokenExpiresAt != null) {
            Duration untilExpiry = Duration.between(Instant.now(), tokenExpiresAt);
            if (untilExpiry.compareTo(lifetime) < 0) {
                lifetime = untilExpiry;
            }
        }
        SseEmitter emitter = new SseEmitter(Math.max(1L, lifetime.toMillis()));
        Subscriber subscriber = new Subscriber(userId, sessionId, emitter);
        emitter.onCompletion(() -> remove(subscriber));
        emitter.onTimeout(
                () -> {
                    remove(subscriber);
                    completeQuietly(subscriber);
                });
        emitter.onError(error -> remove(subscriber));
        List<Subscriber> evicted = new CopyOnWriteArrayList<>();
        // 추가와 마지막 구독 제거(remove)가 같은 키에서 겹쳐도 새 구독이 맵 밖 목록에 들어가지 않도록 한 번의 compute로 처리한다.
        subscribers.compute(
                sessionId,
                (id, list) -> {
                    List<Subscriber> target = list == null ? new CopyOnWriteArrayList<>() : list;
                    target.add(subscriber);
                    while (target.size() > MAX_SUBSCRIBERS_PER_SESSION) {
                        evicted.add(target.remove(0));
                    }
                    return target;
                });
        evicted.forEach(this::completeQuietly);
        submit(
                sessionId,
                () ->
                        sendSnapshot(
                                sessionId,
                                List.of(subscriber),
                                SessionStreamEventType.SESSION_STATE,
                                null));
        return emitter;
    }

    /** 커밋된 변경을 해당 세션 구독자 모두에게 보낸다. 구독자가 없으면 스냅샷을 읽지 않는다. */
    public void dispatch(SessionStreamChanged event) {
        if (!subscribers.containsKey(event.sessionId())) {
            return;
        }
        submit(
                event.sessionId(),
                () ->
                        sendSnapshot(
                                event.sessionId(),
                                List.copyOf(subscribers.getOrDefault(event.sessionId(), List.of())),
                                event.type(),
                                event.commandId()));
    }

    /** 남아 있는 세션별 전송 대기열 수. 테스트·운영 확인용이다. */
    int laneCount() {
        return lanes.size();
    }

    /** 현재 구독 수. 코칭 발행 조건과 테스트·운영 확인에 쓴다. */
    public int subscriberCount(long sessionId) {
        return subscribers.getOrDefault(sessionId, List.of()).size();
    }

    @PreDestroy
    void shutdown() {
        heartbeat.shutdownNow();
        senders.shutdownNow();
        subscribers.values().forEach(list -> list.forEach(this::completeQuietly));
        subscribers.clear();
        lanes.clear();
    }

    /** 세션마다 따로 예약해 한 세션의 실패가 같은 주기의 다른 세션을 건너뛰게 하지 않는다. */
    private void heartbeatAll() {
        try {
            for (Long sessionId : List.copyOf(subscribers.keySet())) {
                submit(
                        sessionId,
                        () -> {
                            List<Subscriber> targets =
                                    List.copyOf(subscribers.getOrDefault(sessionId, List.of()));
                            for (Subscriber subscriber : targets) {
                                trySend(subscriber, SseEmitter.event().comment(HEARTBEAT));
                            }
                            sendSnapshot(
                                    sessionId, targets, SessionStreamEventType.SESSION_STATE, null);
                        });
            }
        } catch (Throwable e) {
            // 예약 작업에서 예외가 나가면 이후 heartbeat가 멈추므로 여기서 막는다.
            log.warn("S10 heartbeat 예약 실패 ({})", e.getClass().getSimpleName());
        }
    }

    private void sendSnapshot(
            long sessionId,
            List<Subscriber> targets,
            SessionStreamEventType type,
            Long commandId) {
        if (targets.isEmpty()) {
            return;
        }
        // 한 세션의 구독자는 보통 같은 소유자다. 사용자별로 소유권을 다시 확인해 위반한 구독만 닫는다.
        Map<Long, List<Subscriber>> byUser =
                targets.stream().collect(Collectors.groupingBy(Subscriber::userId));
        for (Map.Entry<Long, List<Subscriber>> entry : byUser.entrySet()) {
            Optional<RunningSessionResponse> snapshot;
            try {
                snapshot = query.current(entry.getKey(), sessionId);
            } catch (RuntimeException e) {
                // 읽기 실패는 연결 실패로 보고 닫는다. 클라이언트가 재접속해 최신 상태부터 확인한다.
                log.warn(
                        "S10 스냅샷 조회 실패 (sessionId={}, {})",
                        sessionId,
                        e.getClass().getSimpleName());
                entry.getValue().forEach(this::close);
                continue;
            }
            if (snapshot.isEmpty()) {
                entry.getValue().forEach(this::close);
                continue;
            }
            SessionStreamData data = new SessionStreamData(snapshot.get(), commandId);
            for (Subscriber subscriber : entry.getValue()) {
                trySend(
                        subscriber,
                        SseEmitter.event()
                                .name(type.name())
                                .data(data, MediaType.APPLICATION_JSON));
            }
        }
    }

    private void trySend(Subscriber subscriber, SseEmitter.SseEventBuilder event) {
        try {
            subscriber.emitter().send(event);
        } catch (IOException | IllegalStateException e) {
            // 클라이언트가 끊었거나 이미 완료된 emitter다.
            remove(subscriber);
        }
    }

    private void close(Subscriber subscriber) {
        remove(subscriber);
        completeQuietly(subscriber);
    }

    private void completeQuietly(Subscriber subscriber) {
        try {
            subscriber.emitter().complete();
        } catch (IllegalStateException ignored) {
            // 이미 완료됐다.
        }
    }

    private void remove(Subscriber subscriber) {
        subscribers.computeIfPresent(
                subscriber.sessionId(),
                (id, list) -> {
                    list.remove(subscriber);
                    return list.isEmpty() ? null : list;
                });
        releaseLaneIfIdle(subscriber.sessionId());
    }

    /**
     * 구독도 대기 작업도 없고 실행 중도 아닌 대기열만 지운다. 작업 추가(submit)와 같은 맵 잠금 안에서 판단하므로, 실행 중인 대기열을 지운 뒤 같은 세션에
     * 새 대기열이 생겨 두 대기열이 동시에 전송하는 일이 없다.
     */
    private void releaseLaneIfIdle(long sessionId) {
        lanes.computeIfPresent(
                sessionId,
                (id, lane) -> lane.idle() && !subscribers.containsKey(id) ? null : lane);
    }

    /** 같은 세션의 작업은 순서대로, 다른 세션과는 병렬로 실행한다. */
    private void submit(long sessionId, Runnable task) {
        // 작업 추가와 대기열 정리를 같은 키의 맵 잠금으로 직렬화한다.
        Lane lane =
                lanes.compute(
                        sessionId,
                        (id, current) -> {
                            Lane target = current == null ? new Lane(id) : current;
                            target.tasks.add(task);
                            return target;
                        });
        lane.schedule();
    }

    private static ThreadFactory daemon(String name) {
        AtomicInteger seq = new AtomicInteger();
        return runnable -> {
            Thread thread = new Thread(runnable, name + "-" + seq.incrementAndGet());
            thread.setDaemon(true);
            return thread;
        };
    }

    /** 세션별 직렬 대기열. 한 번에 한 스레드만 비운다. */
    private final class Lane {
        private final long sessionId;
        private final Queue<Runnable> tasks = new ConcurrentLinkedQueue<>();
        private final AtomicBoolean running = new AtomicBoolean();

        Lane(long sessionId) {
            this.sessionId = sessionId;
        }

        boolean idle() {
            return !running.get() && tasks.isEmpty();
        }

        void schedule() {
            if (running.compareAndSet(false, true)) {
                try {
                    senders.execute(this::drain);
                } catch (RejectedExecutionException e) {
                    // 종료 중이다.
                    running.set(false);
                }
            }
        }

        private void drain() {
            try {
                Runnable task;
                while ((task = tasks.poll()) != null) {
                    try {
                        task.run();
                    } catch (Throwable e) {
                        log.warn("S10 전송 실패 ({})", e.getClass().getSimpleName());
                    }
                }
            } finally {
                running.set(false);
                if (!tasks.isEmpty()) {
                    schedule();
                } else {
                    releaseLaneIfIdle(sessionId);
                }
            }
        }
    }

    /** 레코드 동등성은 emitter 인스턴스로 구분된다(같은 사용자의 두 연결도 별개다). */
    private record Subscriber(long userId, long sessionId, SseEmitter emitter) {}
}
