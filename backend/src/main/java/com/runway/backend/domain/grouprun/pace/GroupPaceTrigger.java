package com.runway.backend.domain.grouprun.pace;

import com.runway.backend.domain.device.service.RunningBatchCommittedEvent;
import jakarta.annotation.PreDestroy;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;
import org.springframework.transaction.event.TransactionalEventListener;
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

    public GroupPaceTrigger(GroupPaceService service) { this.service = service; }

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

    private void recompute(long id) {
        try {
            do {
                again.remove(id);
                service.evaluateStart(id);
            } while (again.remove(id));
        } finally {
            busy.remove(id);
            if (again.remove(id) && busy.add(id)
                    && !submit(() -> recompute(id))) busy.remove(id);
        }
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
