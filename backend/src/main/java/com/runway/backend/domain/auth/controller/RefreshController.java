package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.RefreshResponse;
import com.runway.backend.domain.auth.dto.RefreshTokenRequest;
import com.runway.backend.domain.auth.service.RefreshService;

import jakarta.validation.Valid;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

@RestController
public class RefreshController {
    private final RefreshService service;

    public RefreshController(RefreshService service) {
        this.service = service;
    }

    @PostMapping("/api/v1/auth/refresh")
    public ResponseEntity<RefreshResponse> refresh(
            @Valid @RequestBody RefreshTokenRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.refresh((String) request.refreshToken()));
    }
}
