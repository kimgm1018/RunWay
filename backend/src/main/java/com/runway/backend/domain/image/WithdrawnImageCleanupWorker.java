package com.runway.backend.domain.image;

import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@RequiredArgsConstructor
@ConditionalOnProperty(name = "runway.images.cleanup-enabled", havingValue = "true", matchIfMissing = true)
public class WithdrawnImageCleanupWorker {
    private static final Logger log = LoggerFactory.getLogger(WithdrawnImageCleanupWorker.class);
    private static final int PAGE_SIZE = 100;
    private final WithdrawnImageCleanupRepository accounts;
    private final WithdrawnImageCleanup cleanup;
    private long lastId;
    private long upperBound;

    // Run on the scheduler after context startup, without blocking application readiness.
    @Scheduled(fixedDelay = 60000, initialDelay = 0)
    public synchronized void retryBatch() {
        try {
            if (upperBound == 0) {
                upperBound = accounts.maxWithdrawnId();
                if (upperBound == 0) return;
            }
            // A finite sweep revisits failed users even while new withdrawals arrive.
            var ids = accounts.findAfter(lastId, upperBound, PAGE_SIZE);
            if (ids.isEmpty()) {
                lastId = 0;
                upperBound = 0;
                return;
            }
            for (long userId : ids) {
                try {
                    cleanup.clean(userId);
                } catch (RuntimeException exception) {
                    // Retry on the next sweep; no paths, identifiers or cause text in logs.
                    log.warn("탈퇴 회원 이미지 정리를 완료하지 못했습니다. 다음 순회에서 재시도합니다.");
                }
                lastId = userId;
            }
            if (lastId >= upperBound) {
                lastId = 0;
                upperBound = 0;
            }
        } catch (RuntimeException exception) {
            log.warn("탈퇴 회원 이미지 정리 대상을 조회하지 못했습니다. 재시도합니다.");
        }
    }
}
