package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.dto.response.PrivacySettingsResponse;
import com.runway.backend.domain.user.dto.response.UpdatedPrivacySettingsResponse;
import com.runway.backend.domain.user.repository.PrivacySettingsRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository.UserAccountRow;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PrivacySettingsService {
    private final PrivacySettingsRepository settings;
    private final UserAccountRepository accounts;

    @Transactional(readOnly = true)
    public PrivacySettingsResponse read(long userId) {
        requireActive(accounts.findById(userId));
        var current = settings.find(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
        return new PrivacySettingsResponse(current.isPrivate());
    }

    @Transactional
    public UpdatedPrivacySettingsResponse update(long userId, boolean isPrivate) {
        requireActive(accounts.lock(userId));
        var current = settings.lock(userId)
                .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
        if (current.isPrivate() == isPrivate) {
            return current;
        }
        var updated = settings.update(userId, isPrivate);
        if (!isPrivate) {
            settings.approvePending(userId);
        }
        return updated;
    }

    private static void requireActive(Optional<UserAccountRow> account) {
        if (account.isEmpty() || !"ACTIVE".equals(account.get().status())) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }
}
