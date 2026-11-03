package com.runway.backend.global.auth;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.AuthenticatedUser;

public final class CurrentUserIdResolver {

    private CurrentUserIdResolver() {}

    public static long requireUserId(AuthenticatedUser user) {
        if (user == null || user.id() <= 0) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
        return user.id();
    }
}
