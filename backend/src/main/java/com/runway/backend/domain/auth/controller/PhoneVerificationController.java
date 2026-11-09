package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.PhoneVerificationConfirmRequest;
import com.runway.backend.domain.auth.dto.PhoneVerificationConfirmResponse;
import com.runway.backend.domain.auth.dto.PhoneVerificationRequest;
import com.runway.backend.domain.auth.dto.PhoneVerificationResponse;
import com.runway.backend.domain.auth.service.PhoneVerificationService;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

/** U28·U29 휴대전화 인증(users.md, S15P31E105-560). 공개 경로. */
@RestController
public class PhoneVerificationController {
    private final PhoneVerificationService verification;
    private final ClientIpResolver addresses;

    public PhoneVerificationController(
            PhoneVerificationService verification, ClientIpResolver addresses) {
        this.verification = verification;
        this.addresses = addresses;
    }

    @PostMapping("/api/v1/auth/phone-verifications")
    public ResponseEntity<PhoneVerificationResponse> request(
            @RequestBody PhoneVerificationRequest body, HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(verification.request(body.phoneNumber(), body.purpose(), addresses.resolve(request)));
    }

    @PostMapping("/api/v1/auth/phone-verifications/confirm")
    public ResponseEntity<PhoneVerificationConfirmResponse> confirm(
            @RequestBody PhoneVerificationConfirmRequest body) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(verification.confirm(body.phoneNumber(), body.purpose(), body.code()));
    }
}
