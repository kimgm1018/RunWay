package com.runway.backend.domain.image;

import com.runway.backend.domain.image.ImageStorage.StoredImage;
import com.runway.backend.domain.image.dto.ImageUploadResponse;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;

@Service
@RequiredArgsConstructor
public class ImageService {

    private static final Set<String> ALLOWED_CONTENT_TYPES =
            Set.of(MediaType.IMAGE_JPEG_VALUE, MediaType.IMAGE_PNG_VALUE);

    private final ImageStorage imageStorage;
    private final ImageStorageProperties properties;

    public ImageUploadResponse upload(long userId, MultipartFile file, String purposeRaw) {
        ImagePurpose purpose = ImagePurpose.from(purposeRaw);
        if (file == null || file.isEmpty()) {
            throw new ApiException(ErrorCode.IMAGE_FILE_EMPTY);
        }
        if (file.getSize() > properties.getMaxBytes()) {
            throw new ApiException(ErrorCode.FILE_TOO_LARGE);
        }

        String contentType = normalizeContentType(file.getContentType());
        if (!ALLOWED_CONTENT_TYPES.contains(contentType)) {
            throw new ApiException(ErrorCode.UNSUPPORTED_MEDIA_TYPE_IMAGE_MEDIA_TYPE);
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.IMAGE_READ_FAILED);
        }
        if (bytes.length == 0) {
            throw new ApiException(ErrorCode.IMAGE_FILE_EMPTY);
        }
        if (bytes.length > properties.getMaxBytes()) {
            throw new ApiException(ErrorCode.FILE_TOO_LARGE);
        }

        DetectedFormat format = detectFormat(bytes);
        if (format == null) {
            throw new ApiException(ErrorCode.IMAGE_DECODE_FAILED);
        }
        if (!format.contentType().equals(contentType)) {
            throw new ApiException(ErrorCode.IMAGE_MEDIA_MISMATCH);
        }

        String imageId = UUID.randomUUID().toString();
        String extension = format.extension();
        String imageKey =
                "images/" + purpose.pathSegment() + "/" + userId + "/" + imageId + "." + extension;
        String lookupKey = "images/by-id/" + imageId + "." + extension;
        imageStorage.store(imageKey, new ByteArrayInputStream(bytes), bytes.length);
        imageStorage.store(lookupKey, new ByteArrayInputStream(bytes), bytes.length);
        return new ImageUploadResponse(imageId, publicUrl(imageId));
    }

    public StoredImage load(String imageIdRaw) {
        UUID imageId = parseImageId(imageIdRaw);
        return imageStorage
                .findByImageId(imageId)
                .orElseThrow(() -> new ApiException(ErrorCode.IMAGE_NOT_FOUND));
    }

    public Optional<String> resolveProfileImageKey(long userId, String imageIdRaw) {
        UUID imageId = parseImageId(imageIdRaw);
        String base = "images/profile/" + userId + "/" + imageId;
        String jpg = base + ".jpg";
        String png = base + ".png";
        if (imageStorage.exists(jpg)) {
            return Optional.of(jpg);
        }
        if (imageStorage.exists(png)) {
            return Optional.of(png);
        }
        return Optional.empty();
    }

    public static String publicUrl(String imageId) {
        return "/api/v1/images/" + imageId;
    }

    public static String publicUrlFromKey(String imageKey) {
        if (imageKey == null || imageKey.isBlank()) {
            return null;
        }
        int slash = imageKey.lastIndexOf('/');
        String fileName = slash >= 0 ? imageKey.substring(slash + 1) : imageKey;
        int dot = fileName.lastIndexOf('.');
        if (dot <= 0) {
            return null;
        }
        return publicUrl(fileName.substring(0, dot));
    }

    private static UUID parseImageId(String raw) {
        if (raw == null || raw.isBlank()) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_IMAGE_PARSE_IMAGE_ID);
        }
        try {
            return UUID.fromString(raw.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_IMAGE_PARSE_IMAGE_ID);
        }
    }

    private static String normalizeContentType(String raw) {
        if (raw == null || raw.isBlank()) {
            return "";
        }
        String type = raw.trim().toLowerCase(Locale.ROOT);
        int semicolon = type.indexOf(';');
        return semicolon >= 0 ? type.substring(0, semicolon).trim() : type;
    }

    private static DetectedFormat detectFormat(byte[] bytes) {
        if (bytes.length >= 3
                && (bytes[0] & 0xFF) == 0xFF
                && (bytes[1] & 0xFF) == 0xD8
                && (bytes[2] & 0xFF) == 0xFF) {
            return new DetectedFormat(MediaType.IMAGE_JPEG_VALUE, "jpg");
        }
        if (bytes.length >= 8
                && (bytes[0] & 0xFF) == 0x89
                && bytes[1] == 0x50
                && bytes[2] == 0x4E
                && bytes[3] == 0x47
                && bytes[4] == 0x0D
                && bytes[5] == 0x0A
                && bytes[6] == 0x1A
                && bytes[7] == 0x0A) {
            return new DetectedFormat(MediaType.IMAGE_PNG_VALUE, "png");
        }
        return null;
    }

    private record DetectedFormat(String contentType, String extension) {}
}
