package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.LoginRequest;
import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.service.LoginService;
import jakarta.validation.Valid;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class LoginController {
    private final LoginService service;

    public LoginController(LoginService service) {
        this.service = service;
    }

    @PostMapping("/api/v1/auth/login")
    public ResponseEntity<LoginResponse> login(@Valid @RequestBody LoginRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(service.login((String) request.loginId(), (String) request.password()));
    }
}
