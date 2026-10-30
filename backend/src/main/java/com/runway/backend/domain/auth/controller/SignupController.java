package com.runway.backend.domain.auth.controller;

import com.runway.backend.domain.auth.dto.LoginIdAvailabilityResponse;
import com.runway.backend.domain.auth.dto.LoginResponse;
import com.runway.backend.domain.auth.dto.SignupRequest;
import com.runway.backend.domain.auth.service.LoginIdAvailabilityService;
import com.runway.backend.domain.auth.service.SignupService;

import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.Schema;

import jakarta.servlet.http.HttpServletRequest;

import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SignupController {
    private final SignupService signup;
    private final LoginIdAvailabilityService availability;
    private final ClientIpResolver addresses;

    public SignupController(
            SignupService signup,
            LoginIdAvailabilityService availability,
            ClientIpResolver addresses) {
        this.signup = signup;
        this.availability = availability;
        this.addresses = addresses;
    }

    @PostMapping("/api/v1/auth/signup")
    public ResponseEntity<LoginResponse> signup(@RequestBody SignupRequest request) {
        return ResponseEntity.status(HttpStatus.CREATED)
                .cacheControl(CacheControl.noStore())
                .body(signup.signup(request));
    }

    @GetMapping("/api/v1/auth/login-id/availability")
    @Parameter(
            name = "loginId",
            in = ParameterIn.QUERY,
            required = true,
            description = "영문·숫자 4~16자. 조회는 가입 예약이 아닙니다.",
            schema =
                    @Schema(
                            type = "string",
                            minLength = 4,
                            maxLength = 16,
                            pattern = "[A-Za-z0-9]{4,16}"))
    public ResponseEntity<LoginIdAvailabilityResponse> availability(HttpServletRequest request) {
        return ResponseEntity.ok()
                .cacheControl(CacheControl.noStore())
                .body(
                        availability.check(
                                addresses.resolve(request), request.getParameterValues("loginId")));
    }
}
