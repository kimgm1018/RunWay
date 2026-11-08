package com.runway.backend.domain.user.service;

import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.user.dto.request.UpdateProfileRequest;
import com.runway.backend.domain.user.dto.response.UpdatedUserProfileResponse;
import com.runway.backend.domain.user.dto.response.UserProfileResponse;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import com.runway.backend.domain.user.repository.UserAccountRepository.UserAccountRow;
import com.runway.backend.domain.user.validation.UserProfileValidator;
import com.runway.backend.domain.user.validation.UserProfileValidator.Patch;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.sql.SQLException;

@Service
@RequiredArgsConstructor
public class UserProfileService {

    private final UserAccountRepository accounts;
    private final OnboardingStatusService onboarding;
    private final UserProfileValidator validator;
    private final ImageService images;

    @Transactional(readOnly = true)
    public UserProfileResponse read(long userId) {
        UserAccountRow row =
                accounts.findById(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));
        if ("WITHDRAWN".equals(row.status()))
            return new UserProfileResponse(row.id(),"탈퇴한 회원",null,null,null,"WITHDRAWN",null,false);
        return new UserProfileResponse(
                row.id(),
                row.nickname(),
                row.gender(),
                row.birthDate(),
                row.loginId(),
                row.status(),
                ImageService.publicUrlFromKey(row.profileImageKey()),
                onboarding.isCompleted(userId));
    }

    @Transactional
    public UpdatedUserProfileResponse update(long userId, UpdateProfileRequest request) {
        Patch patch = validator.validate(request);
        try {
            UserAccountRow current =
                    accounts.lock(userId)
                            .orElseThrow(() -> new ApiException(ErrorCode.SERVICE_UNAVAILABLE));

            if (!"ACTIVE".equals(current.status())) throw new ApiException(ErrorCode.UNAUTHORIZED);
            String nickname = current.nickname();
            if (patch.nicknamePresent()) {
                if (accounts.nicknameTakenByOther(patch.nickname(), userId)) {
                    throw new ApiException(ErrorCode.NICKNAME_DUPLICATED);
                }
                nickname = patch.nickname();
            }

            String gender = current.gender();
            if (patch.genderPresent()) {
                gender = patch.gender();
            }

            var birthDate = current.birthDate();
            if (patch.birthDatePresent()) {
                birthDate = patch.birthDate();
            }

            String profileImageKey = current.profileImageKey();
            if (patch.profileImagePresent()) {
                if (patch.clearProfileImage()) {
                    profileImageKey = null;
                } else {
                    profileImageKey =
                            images.resolveProfileImageKey(userId, patch.profileImageId())
                                    .orElseThrow(() -> new ApiException(ErrorCode.INVALID_IMAGE));
                }
            }

            UserAccountRow saved =
                    accounts.update(userId, nickname, gender, birthDate, profileImageKey);
            return new UpdatedUserProfileResponse(
                    saved.id(),
                    saved.nickname(),
                    saved.gender(),
                    saved.birthDate(),
                    saved.updatedAt(),
                    ImageService.publicUrlFromKey(saved.profileImageKey()),
                    onboarding.isCompleted(userId));
        } catch (ApiException ex) {
            throw ex;
        } catch (RuntimeException ex) {
            if ("uq_users_nickname".equals(uniqueConstraint(ex))) {
                throw new ApiException(ErrorCode.NICKNAME_DUPLICATED);
            }
            throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        }
    }

    private static String uniqueConstraint(Throwable exception) {
        for (Throwable current = exception; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql && "23505".equals(sql.getSQLState())) {
                try {
                    Object message =
                            current.getClass().getMethod("getServerErrorMessage").invoke(current);
                    return (String) message.getClass().getMethod("getConstraint").invoke(message);
                } catch (ReflectiveOperationException | NullPointerException ignored) {
                    return null;
                }
            }
        }
        return null;
    }
}
