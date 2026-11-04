package com.runway.backend.domain.image;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

public enum ImagePurpose {
    PROFILE,
    CREW,
    POST;

    public static ImagePurpose from(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ApiException(ErrorCode.IMAGE_PURPOSE_REQUIRED);
        }
        try {
            return ImagePurpose.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.IMAGE_PURPOSE_INVALID);
        }
    }

    public String pathSegment() {
        return name().toLowerCase();
    }
}
