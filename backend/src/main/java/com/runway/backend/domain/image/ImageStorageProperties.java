package com.runway.backend.domain.image;

import java.nio.file.Path;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "runway.images")
public class ImageStorageProperties {

    /** Absolute or relative directory for image binaries. */
    private String volumePath = "data/images";

    private long maxBytes = 5L * 1024 * 1024;

    public String getVolumePath() {
        return volumePath;
    }

    public void setVolumePath(String volumePath) {
        this.volumePath = volumePath;
    }

    public long getMaxBytes() {
        return maxBytes;
    }

    public void setMaxBytes(long maxBytes) {
        this.maxBytes = maxBytes;
    }

    public Path resolvedRoot() {
        return Path.of(volumePath == null || volumePath.isBlank() ? "data/images" : volumePath)
                .toAbsolutePath()
                .normalize();
    }
}
