package com.runway.backend.domain.notification.service;

import com.runway.backend.domain.notification.repository.PushTokenRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** N03/N04: registers and removes the caller's device push tokens (ADR-0025). */
@Service
@RequiredArgsConstructor
public class PushTokenService {
    /** Tokens kept per member; registering beyond this drops the least recently registered ones. */
    static final int MAX_TOKENS_PER_USER = 10;

    private final PushTokenRepository tokens;

    @Transactional
    public void register(long userId, String token, String platform) {
        tokens.upsert(userId, token, platform);
        tokens.trimToLimit(userId, MAX_TOKENS_PER_USER);
    }

    /** Idempotent: a missing token or one owned by another member is left untouched without an error. */
    @Transactional
    public void unregister(long userId, String token) {
        tokens.deleteOwned(userId, token);
    }
}
