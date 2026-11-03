package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.dto.RefreshResponse;
import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.global.exception.ApiException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

@Service
public class RefreshService {
    private static final Logger log = LoggerFactory.getLogger(RefreshService.class);
    private final RefreshTokenStore store;
    private final RefreshIssuanceService issuance;

    public RefreshService(RefreshTokenStore store, RefreshIssuanceService issuance) {
        this.store = store;
        this.issuance = issuance;
    }

    public RefreshResponse refresh(String value) {
        var token = RefreshTokenFactory.parse(value);
        if (token == null) throw AuthErrors.invalidRefresh();
        var family = store.find(token);
        try {
            // The transactional proxy must finish PostgreSQL commit before returning a response.
            return issuance.issue(token, family);
        } catch (RuntimeException exception) {
            if (exception instanceof ApiException api && api.code().equals("INVALID_REFRESH_TOKEN"))
                throw api;
            try {
                store.logout(token);
            } catch (RuntimeException ignored) {
                log.warn("전달되지 않은 갱신 권한의 폐기를 확인하지 못했습니다.");
            }
            throw AuthErrors.unavailable();
        }
    }
}
