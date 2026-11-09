package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.PasswordResetRequest;
import com.runway.backend.domain.auth.service.PasswordResetService;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** U30 비밀번호 재설정(users.md, S15P31E105-560). 공개 경로. */
@RestController
public class PasswordResetController {
    private final PasswordResetService service;

    public PasswordResetController(PasswordResetService service) {
        this.service = service;
    }

    @PostMapping("/api/v1/auth/password-reset")
    public ResponseEntity<Void> reset(@RequestBody PasswordResetRequest request) {
        service.reset(request.verificationToken(), request.newPassword());
        return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
    }
}
