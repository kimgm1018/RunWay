package com.runway.backend.domain.user.controller;

import com.runway.backend.domain.user.dto.request.WithdrawalRequest;
import com.runway.backend.domain.user.dto.response.WithdrawalResponse;
import com.runway.backend.domain.user.dto.response.WithdrawalSummaryResponse;
import com.runway.backend.domain.user.service.WithdrawalService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import lombok.RequiredArgsConstructor;
import org.springframework.http.CacheControl;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.*;

@RestController
@RequestMapping("/api/v1/users/me")
@RequiredArgsConstructor
public class WithdrawalController {
    private final WithdrawalService withdrawals;

    @GetMapping("/withdrawal-summary")
    public ResponseEntity<WithdrawalSummaryResponse> summary(@AuthenticationPrincipal AuthenticatedUser user) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(withdrawals.summary(CurrentUserIdResolver.requireUserId(user)));
    }

    @DeleteMapping
    public ResponseEntity<WithdrawalResponse> withdraw(@AuthenticationPrincipal AuthenticatedUser user,
            @RequestBody WithdrawalRequest request) {
        return ResponseEntity.ok().cacheControl(CacheControl.noStore())
                .body(withdrawals.withdraw(CurrentUserIdResolver.requireUserId(user),request));
    }
}
