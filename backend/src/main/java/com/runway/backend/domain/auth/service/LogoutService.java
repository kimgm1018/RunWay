package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;

import org.springframework.stereotype.Service;

@Service
public class LogoutService {
    private final RefreshTokenStore store;

    public LogoutService(RefreshTokenStore store) {
        this.store = store;
    }

    public void logout(String value) {
        var token = RefreshTokenFactory.parse(value);
        if (token != null) store.logout(token);
    }
}
