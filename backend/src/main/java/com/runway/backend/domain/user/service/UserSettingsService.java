package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.dto.request.UserSettingsRequest;
import com.runway.backend.domain.user.dto.response.UserSettingsResponse;
import com.runway.backend.domain.user.repository.UserSettingsRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserSettingsService {
    private final UserSettingsRepository settings;

    @Transactional(readOnly = true)
    public UserSettingsResponse read(long userId) {
        return settings.find(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
    }

    @Transactional
    public UserSettingsResponse update(long userId, UserSettingsRequest patch) {
        return settings.update(userId, patch)
                .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
    }
}
