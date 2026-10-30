package com.runway.backend.domain.image;

import com.runway.backend.global.exception.ApiException;
import org.springframework.http.HttpStatus;

public enum ImagePurpose {
    PROFILE,
    CREW,
    POST;

    public static ImagePurpose from(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "purpose는 필수입니다.");
        }
        try {
            return ImagePurpose.valueOf(raw.trim().toUpperCase());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "purpose는 PROFILE, CREW, POST 중 하나여야 합니다.");
        }
    }

    public String pathSegment() {
        return name().toLowerCase();
    }
}
