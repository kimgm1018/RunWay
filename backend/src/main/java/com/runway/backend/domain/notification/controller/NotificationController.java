package com.runway.backend.domain.notification.controller;

import com.runway.backend.domain.notification.dto.response.NotificationListResponse;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/notifications")
@RequiredArgsConstructor
public class NotificationController {
    private final NotificationService notifications;

    @GetMapping
    public NotificationListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String cursor,
            @RequestParam(required = false) Integer limit) {
        return notifications.list(CurrentUserIdResolver.requireUserId(user), cursor, limit);
    }

    @PostMapping("/read-all")
    public ResponseEntity<Void> readAll(@AuthenticationPrincipal AuthenticatedUser user) {
        notifications.markAllRead(CurrentUserIdResolver.requireUserId(user));
        return ResponseEntity.noContent().build();
    }
}
