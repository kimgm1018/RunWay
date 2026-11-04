package com.runway.backend.domain.user.validation;

import com.runway.backend.domain.user.dto.request.UpdateProfileRequest;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.stereotype.Component;

import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.time.format.DateTimeParseException;
import java.util.Set;

@Component
public class UserProfileValidator {

    private final Clock clock;

    public UserProfileValidator(Clock clock) {
        this.clock = clock;
    }

    public Patch validate(UpdateProfileRequest request) {
        if (request == null || !request.hasAnyField()) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        }

        String nickname = null;
        if (request.nicknamePresent()) {
            if (request.nickname() == null || !text(request.nickname(), 2, 10, false)) {
                throw new ApiException(ErrorCode.INVALID_PROFILE);
            }
            nickname = request.nickname();
        }

        String gender = null;
        if (request.genderPresent()) {
            if (request.gender() == null || !Set.of("MALE", "FEMALE").contains(request.gender())) {
                throw new ApiException(ErrorCode.INVALID_PROFILE);
            }
            gender = request.gender();
        }

        LocalDate birthDate = null;
        if (request.birthDatePresent()) {
            birthDate = parseBirthDate(request.birthDate());
        }

        boolean clearImage = false;
        String profileImageId = null;
        if (request.profileImageIdPresent()) {
            if (request.profileImageId() == null) {
                clearImage = true;
            } else {
                profileImageId = request.profileImageId().trim();
                if (profileImageId.isEmpty()) {
                    throw new ApiException(ErrorCode.INVALID_IMAGE);
                }
            }
        }

        return new Patch(
                request.nicknamePresent(),
                nickname,
                request.genderPresent(),
                gender,
                request.birthDatePresent(),
                birthDate,
                request.profileImageIdPresent(),
                clearImage,
                profileImageId);
    }

    private LocalDate parseBirthDate(String raw) {
        if (raw == null || !raw.matches("[0-9]{4}-[0-9]{2}-[0-9]{2}")) {
            throw new ApiException(ErrorCode.INVALID_PROFILE);
        }
        LocalDate birth;
        try {
            birth = LocalDate.parse(raw);
        } catch (DateTimeParseException ex) {
            throw new ApiException(ErrorCode.INVALID_PROFILE);
        }
        if (birth.getYear() < 1 || birth.isAfter(LocalDate.now(clock.withZone(ZoneOffset.UTC)))) {
            throw new ApiException(ErrorCode.INVALID_PROFILE);
        }
        return birth;
    }

    private static boolean text(String value, int min, int max, boolean allowSpaces) {
        int count = 0;
        for (int offset = 0; offset < value.length(); ) {
            char first = value.charAt(offset);
            if (Character.isSurrogate(first)
                    && (!Character.isHighSurrogate(first)
                            || offset + 1 >= value.length()
                            || !Character.isLowSurrogate(value.charAt(offset + 1)))) {
                return false;
            }
            int point = value.codePointAt(offset);
            if (Character.isISOControl(point)
                    || (!allowSpaces
                            && (Character.isWhitespace(point) || Character.isSpaceChar(point)))) {
                return false;
            }
            count++;
            if (count > max) {
                return false;
            }
            offset += Character.charCount(point);
        }
        return count >= min;
    }

    public record Patch(
            boolean nicknamePresent,
            String nickname,
            boolean genderPresent,
            String gender,
            boolean birthDatePresent,
            LocalDate birthDate,
            boolean profileImagePresent,
            boolean clearProfileImage,
            String profileImageId) {}
}
