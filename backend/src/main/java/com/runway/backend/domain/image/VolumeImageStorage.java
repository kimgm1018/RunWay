package com.runway.backend.domain.image;

import com.runway.backend.global.exception.ApiException;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.Optional;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

@Component
public class VolumeImageStorage implements ImageStorage {

    private final Path root;

    public VolumeImageStorage(ImageStorageProperties properties) {
        this.root = properties.resolvedRoot();
    }

    @Override
    public void store(String imageKey, InputStream content, long contentLength) {
        Path target = resolve(imageKey);
        try {
            Files.createDirectories(target.getParent());
            Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
            throw new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "UPLOAD_UNAVAILABLE",
                    "이미지 저장소에 접근할 수 없습니다.");
        }
    }

    @Override
    public boolean exists(String imageKey) {
        return Files.isRegularFile(resolve(imageKey), LinkOption.NOFOLLOW_LINKS);
    }

    @Override
    public Optional<StoredImage> findByImageId(UUID imageId) {
        Optional<StoredImage> jpg = openById(imageId, "jpg", MediaType.IMAGE_JPEG_VALUE);
        if (jpg.isPresent()) {
            return jpg;
        }
        return openById(imageId, "png", MediaType.IMAGE_PNG_VALUE);
    }

    private Optional<StoredImage> openById(UUID imageId, String extension, String contentType) {
        String imageKey = "images/by-id/" + imageId + "." + extension;
        Path path = resolve(imageKey);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            return Optional.empty();
        }
        try {
            long size = Files.size(path);
            InputStream content = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS);
            return Optional.of(new StoredImage(imageKey, contentType, content, size));
        } catch (IOException ex) {
            throw new ApiException(
                    HttpStatus.SERVICE_UNAVAILABLE,
                    "UPLOAD_UNAVAILABLE",
                    "이미지 저장소에 접근할 수 없습니다.");
        }
    }

    private Path resolve(String imageKey) {
        Path target = root.resolve(imageKey).normalize();
        if (!target.startsWith(root)) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST, "VALIDATION_ERROR", "저장 경로가 올바르지 않습니다.");
        }
        return target;
    }
}
