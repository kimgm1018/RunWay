package com.runway.backend.global.auth;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.security.AuthenticatedUser;
import org.springframework.http.HttpStatus;

public final class CurrentUserIdResolver {

    private CurrentUserIdResolver() {}

    public static long requireUserId(AuthenticatedUser user) {
        if (user == null || user.id() <= 0) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
        return user.id();
    }
}
