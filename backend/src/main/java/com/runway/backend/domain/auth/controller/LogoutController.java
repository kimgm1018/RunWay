package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.RefreshTokenRequest;
import com.runway.backend.domain.auth.service.LogoutService;

import jakarta.validation.Valid;

import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class LogoutController {
    private final LogoutService service;

    public LogoutController(LogoutService service) {
        this.service = service;
    }

    @PostMapping("/api/v1/auth/logout")
    public ResponseEntity<Void> logout(@Valid @RequestBody RefreshTokenRequest request) {
        service.logout((String) request.refreshToken());
        return ResponseEntity.noContent().build();
    }
}
