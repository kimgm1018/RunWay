package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.entity.RecommendationPreferences;
import com.runway.backend.domain.user.model.PreferenceSelection;
import com.runway.backend.domain.user.repository.RecommendationPreferencesRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PreferencesService {
    private final RecommendationPreferencesRepository preferences;
    private final UserAccountRepository accounts;

    @Transactional(readOnly = true)
    public PreferenceSelection read(long userId) {
        requireActive(accounts.findById(userId));
        return preferences
                .findByUserId(userId)
                .map(RecommendationPreferences::selection)
                .orElseGet(PreferenceSelection::defaults);
    }

    @Transactional
    public PreferenceSelection save(long userId, PreferenceSelection selection) {
        // Lock the existing owner even for first save; the preferences row may not exist yet.
        requireActive(accounts.lock(userId));
        var stored = preferences.findByUserId(userId).orElse(null);
        if (stored == null) {
            stored = preferences.save(RecommendationPreferences.create(userId, selection));
        } else {
            stored.replace(selection);
        }
        preferences.flush();
        return stored.selection();
    }

    private void requireActive(java.util.Optional<UserAccountRepository.UserAccountRow> account) {
        if (account.isEmpty() || !"ACTIVE".equals(account.get().status())) {
            throw new ApiException(ErrorCode.FORBIDDEN);
        }
    }
}
