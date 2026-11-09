package com.runway.backend.domain.auth.config;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

/**
 * 가입 설정(users.md U15, S15P31E105-560). {@code BACKEND_SIGNUP_UNVERIFIED_PHONE_ALLOWED}는 개발·테스트 전용이며 기본·운영은
 * false다. false면 휴대전화 인증 증명 없이 가입할 수 없다.
 */
@Getter
@Setter
@Component
@ConfigurationProperties(prefix = "runway.auth.signup")
public class SignupSettings {
    private boolean unverifiedPhoneAllowed;
}
