package com.runway.backend.domain.image;

import java.io.InputStream;

public interface ImageStorage {

    void store(String imageKey, InputStream content, long contentLength);

    boolean exists(String imageKey);
}
