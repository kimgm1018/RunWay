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
                .header(HttpHeaders.CACHE_CONTROL, "no-store")
                .header(HttpHeaders.VARY, HttpHeaders.AUTHORIZATION)
                .header(HttpHeaders.CONTENT_TYPE, image.contentType())
                .contentLength(image.contentLength())
                .body(body);
    }
}
