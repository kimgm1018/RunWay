package com.runway.backend.domain.image;

import java.io.InputStream;
import java.util.Optional;
import java.util.UUID;

public interface ImageStorage {

    void store(String imageKey, InputStream content, long contentLength);

    boolean exists(String imageKey);

    Optional<StoredImage> findByImageId(UUID imageId);

    record StoredImage(String imageKey, String contentType, InputStream content, long contentLength) {}
}
