package com.runway.backend.domain.image;

import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;

@Service
@RequiredArgsConstructor
public class WithdrawnImageCleanup {
    private final WithdrawnImageCleanupRepository accounts;
    private final ImageStorage storage;

    /** Safe to call after commit or on retry; uncommitted/active users are never cleaned. */
    public boolean clean(long userId) {
        if (userId <= 0 || !accounts.isCommittedWithdrawal(userId)) return false;
        storage.deletePersonalImages(userId);
        return true;
    }
}
