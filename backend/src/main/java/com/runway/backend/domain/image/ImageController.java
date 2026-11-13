package com.runway.backend.domain.image;

import com.runway.backend.domain.image.ImageStorage.StoredImage;
import com.runway.backend.domain.image.dto.ImageUploadResponse;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import java.io.IOException;
import lombok.RequiredArgsConstructor;
import org.springframework.core.io.InputStreamResource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

@RestController
@RequestMapping("/api/v1/images")
@RequiredArgsConstructor
public class ImageController {

    /**
     * 코스 썸네일 PNG(S15P31E105-612 B-4) 캐시 정책. 키가 그릴 때마다 새 UUID라 내용이 바뀌지 않는다. 썸네일 조회를 로그인 사용자로
     * 제한하게 되면 이 값 하나를 {@code "private, max-age=31536000, immutable"}로 바꾼다. 다른 이미지는 {@code no-store}다.
     */
    static final String COURSE_BASEMAP_CACHE_CONTROL = "public, max-age=31536000, immutable";

    /**
     * 본인 기록 경로 썸네일 PNG(S15P31E105-756, ADR-0024) 캐시 정책. 키가 그릴 때마다 새 UUID라 내용이 바뀌지 않지만 주인에게만 주므로
     * 공유 캐시는 막고 기기 캐시만 허용한다.
     */
    static final String RUN_ROUTE_BASEMAP_CACHE_CONTROL = "private, max-age=31536000, immutable";

    static final String DEFAULT_CACHE_CONTROL = "no-store";

    private final ImageService imageService;

    @PostMapping(consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseEntity<ImageUploadResponse> upload(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestPart("file") MultipartFile file,
            @RequestParam("purpose") String purpose) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        ImageUploadResponse body = imageService.upload(userId, file, purpose);
        return ResponseEntity.status(HttpStatus.CREATED).body(body);
    }

    @GetMapping("/{imageId}")
    public ResponseEntity<InputStreamResource> get(
            @AuthenticationPrincipal AuthenticatedUser user, @PathVariable String imageId)
            throws IOException {
        Long viewerId = user == null ? null : CurrentUserIdResolver.requireUserId(user);
        StoredImage image = imageService.load(viewerId, imageId);
        InputStreamResource body = new InputStreamResource(image.content());
        return ResponseEntity.ok()
                .header(
                        HttpHeaders.CACHE_CONTROL,
                        ImageService.isCourseBasemap(image)
                                ? COURSE_BASEMAP_CACHE_CONTROL
                                : ImageService.isRunRouteBasemap(image)
                                        ? RUN_ROUTE_BASEMAP_CACHE_CONTROL
                                        : DEFAULT_CACHE_CONTROL)
                .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
                .header(HttpHeaders.CONTENT_TYPE, image.contentType())
                .contentLength(image.contentLength())
                .body(body);
    }
}
