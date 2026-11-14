package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.RejectedExecutionException;

/** Mirrors CoachingTrigger's after-commit executor, independently of S10 subscribers. */
@Component
@Slf4j
@ConditionalOnProperty(name = "runway.group-pace.enabled", havingValue = "true")
public class GroupPaceTrigger {
    private final GroupPaceService service;
    private final ExecutorService executor = executor("group-pace-start");
    private final ExecutorService liveExecutor = executor("group-pace-live");
    private final Set<Long> liveBusy = ConcurrentHashMap.newKeySet();
    private final Set<Long> busy = ConcurrentHashMap.newKeySet();
    private final Set<Long> again = ConcurrentHashMap.newKeySet();

    private final boolean backfillOnStartup;
    private final int backfillLimit;
    private final Duration backfillStartDelay;

    @Autowired
    public GroupPaceTrigger(GroupPaceService service,
            @Value("${runway.group-pace.backfill-on-startup:true}") boolean backfillOnStartup,
            @Value("${runway.group-pace.backfill-limit:100}") int backfillLimit,
            @Value("${runway.group-pace.backfill-start-delay:PT30S}") String backfillStartDelay) {
        this(service, backfillOnStartup, backfillLimit,
                org.springframework.boot.convert.DurationStyle.detectAndParse(backfillStartDelay));
    }

    GroupPaceTrigger(GroupPaceService service, boolean backfillOnStartup, int backfillLimit,
            Duration backfillStartDelay) {
        this.service = service;
        this.backfillOnStartup = backfillOnStartup;
        this.backfillLimit = Math.max(0, backfillLimit);
        // 음수는 0(바로 시작)으로 본다.
        this.backfillStartDelay = backfillStartDelay.isNegative() ? Duration.ZERO : backfillStartDelay;
    }

    public GroupPaceTrigger(GroupPaceService service) {
        this(service, true, 100, Duration.ZERO);
    }

    private static ExecutorService executor(String name) {
        return new ThreadPoolExecutor(2, 2, 0, TimeUnit.SECONDS, new ArrayBlockingQueue<>(256),
                runnable -> {
                    Thread thread = new Thread(runnable, name);
                    thread.setDaemon(true);
                    return thread;
                }, new ThreadPoolExecutor.AbortPolicy());
    }

    @TransactionalEventListener
    void onBatch(RunningBatchCommittedEvent event) {
        try {
            service.groupForBatch(event.sessionId()).ifPresent(id -> {
                if (!liveBusy.add(id)) return;
                try {
                    liveExecutor.execute(() -> {
                        try { service.evaluateRunning(id); }
                        catch (RuntimeException e) {
                            log.warn("Group pace live calculation failed ({})",
                                    e.getClass().getSimpleName());
                        } finally { liveBusy.remove(id); }
                    });
                } catch (RejectedExecutionException e) { liveBusy.remove(id); }
            });
        } catch (RuntimeException e) {
            // The batch is already committed; optional AI failures must not fail its ACK.
            log.warn("Group pace batch dispatch failed ({})", e.getClass().getSimpleName());
        }
    }

    @TransactionalEventListener
    void onGroupChanged(GroupPaceChanged event) {
        long id = event.groupRunId();
        again.add(id);
        if (busy.add(id) && !submit(() -> recompute(id))) busy.remove(id);
    }

    /**
     * 기동 시 한 번(S15P31E105-817): V39 배포 전에 계산돼 km 비율이 없는 예정 그룹런을 다시 계산한다. 조회(GET)가 계산을 일으키지 않게
     * 서버 쪽에서만 하며 기존 계산 경로를 그대로 쓴다(그래서 출발 페이스 등도 최신 기록으로 다시 저장될 수 있다). AI가 막 기동한 순간에
     * 준비되지 않았을 수 있어 start-delay 뒤에, 기동을 막지 않도록 실행기에서 돌린다. 끄려면 backfill-on-startup=false.
     */
    @EventListener(ApplicationReadyEvent.class)
    void onReady() {
        if (!backfillOnStartup) return;
        if (!submit(() -> {
            try {
                if (!backfillStartDelay.isZero()) Thread.sleep(backfillStartDelay.toMillis());
            } catch (InterruptedException e) {
                Thread.currentThread().interrupt();
                return;
            }
            backfillStart();
        })) log.warn("Group pace backfill was not scheduled");
    }

    /**
     * @param targets 이번에 처리한 방 수(상한 적용)
     * @param filled 저장 후 비율까지 채워진 방 수
     * @param savedWithoutRatios 출발 추천은 저장됐지만 비율이 비어 있는 방 수(AI 비율이 검증에서 빠짐)
     * @param discarded 저장하지 않은 방 수(계산 불가·AI 실패·변경에 밀림·다른 계산 중이라 건너뜀)
     * @param failed 예외로 끝난 방 수
     * @param remaining 끝난 뒤에도 대상 조건을 만족하는 전체 방 수(상한 무시)
     */
    record BackfillResult(int targets, int filled, int savedWithoutRatios, int discarded, int failed,
            int remaining) {}

    BackfillResult backfillStart() {
        List<Long> targets = service.startBackfillTargets(backfillLimit);
        Set<Long> saved = new java.util.HashSet<>();
        int discarded = 0;
        int failed = 0;
        for (int i = 0; i < targets.size(); i++) {
            long id = targets.get(i);
            // 종료 중이면 남은 대상을 헛돌지 않고 멈춘다.
            if (Thread.currentThread().isInterrupted()) { discarded += targets.size() - i; break; }
            // 같은 그룹을 다른 변경이 이미 계산 중이면 그쪽이 최신이므로 건너뛴다.
            if (!busy.add(id)) { discarded++; continue; }
            try {
                if (recompute(id)) saved.add(id); else discarded++;
            } catch (RuntimeException e) {
                failed++;
                // Do not log request/response objects, health values or exception messages.
                log.warn("Group pace backfill calculation failed ({})", e.getClass().getSimpleName());
            }
        }
        Set<Long> remaining = new java.util.HashSet<>(service.startBackfillTargets(Integer.MAX_VALUE));
        int filled = (int) saved.stream().filter(id -> !remaining.contains(id)).count();
        var result = new BackfillResult(targets.size(), filled, saved.size() - filled, discarded, failed,
                remaining.size());
        // 개수만 남긴다. 사용자·페이스 값은 남기지 않는다.
        log.info("Group pace km ratio backfill targets={} filled={} savedWithoutRatios={} discarded={}"
                + " failed={} remaining={}", result.targets(), result.filled(),
                result.savedWithoutRatios(), result.discarded(), result.failed(), result.remaining());
        return result;
    }

    private boolean recompute(long id) {
        boolean saved = false;
        try {
            do {
                again.remove(id);
                saved = service.evaluateStart(id);
            } while (again.remove(id));
        } finally {
            busy.remove(id);
            if (again.remove(id) && busy.add(id)
                    && !submit(() -> recompute(id))) busy.remove(id);
        }
        return saved;
    }

    private boolean submit(Runnable work) {
        try {
            executor.execute(() -> {
                try { work.run(); }
                catch (RuntimeException e) {
                    // Do not log request/response objects, health values or exception messages.
                    log.warn("Group pace calculation failed ({})", e.getClass().getSimpleName());
                }
            });
            return true;
        } catch (RejectedExecutionException e) {
            // Shutdown: the next committed change/batch can retry.
            return false;
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
        liveExecutor.shutdownNow();
    }
}
