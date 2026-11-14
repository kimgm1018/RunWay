package com.runway.backend.domain.notification.controller;

import com.runway.backend.domain.notification.dto.request.PushTokenDeleteRequest;
import com.runway.backend.domain.notification.dto.request.PushTokenRegisterRequest;
import com.runway.backend.domain.notification.service.PushTokenService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notifications/push-tokens")
@RequiredArgsConstructor
public class PushTokenController {
    private final PushTokenService pushTokens;

    /** N03. Registers (or re-registers) this device's FCM token for the caller. */
    @PutMapping
    public ResponseEntity<Void> register(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody PushTokenRegisterRequest request) {
        pushTokens.register(
                CurrentUserIdResolver.requireUserId(user), request.token(), request.platform());
        return ResponseEntity.noContent().build();
    }

    /** N04. Removes this device's token before logout or when notification permission is revoked. */
    @DeleteMapping
    public ResponseEntity<Void> unregister(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody PushTokenDeleteRequest request) {
        pushTokens.unregister(CurrentUserIdResolver.requireUserId(user), request.token());
        return ResponseEntity.noContent().build();
    }
}
