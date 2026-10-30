package com.runway.backend.domain.image;

import com.runway.backend.domain.image.dto.ImageUploadResponse;
import com.runway.backend.global.exception.ApiException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.Locale;
import java.util.Set;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

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
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지 파일이 비어 있습니다.");
        }
        if (file.getSize() > properties.getMaxBytes()) {
            throw new ApiException(
                    HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.");
        }

        String contentType = normalizeContentType(file.getContentType());
        if (!ALLOWED_CONTENT_TYPES.contains(contentType)) {
            throw new ApiException(
                    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "jpeg 또는 png만 업로드할 수 있습니다.");
        }

        byte[] bytes;
        try {
            bytes = file.getBytes();
        } catch (IOException ex) {
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지를 읽을 수 없습니다.");
        }
        if (bytes.length == 0) {
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지 파일이 비어 있습니다.");
        }
        if (bytes.length > properties.getMaxBytes()) {
            throw new ApiException(
                    HttpStatus.CONTENT_TOO_LARGE, "FILE_TOO_LARGE", "업로드 크기를 초과했습니다.");
        }

        DetectedFormat format = detectFormat(bytes);
        if (format == null) {
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_FILE", "이미지로 해석할 수 없습니다.");
        }
        if (!format.contentType().equals(contentType)) {
            throw new ApiException(
                    HttpStatus.UNSUPPORTED_MEDIA_TYPE,
                    "UNSUPPORTED_MEDIA_TYPE",
                    "선언한 형식과 실제 파일 내용이 일치하지 않습니다.");
        }

        String imageId = UUID.randomUUID().toString();
        String imageKey =
                "images/"
                        + purpose.pathSegment()
                        + "/"
                        + userId
                        + "/"
                        + imageId
                        + "."
                        + format.extension();
        imageStorage.store(imageKey, new ByteArrayInputStream(bytes), bytes.length);
        // MVP: 미리보기 URL 서빙은 후속. 응답 url은 null.
        return new ImageUploadResponse(imageId, null);
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
