package com.runway.backend.domain.auth.service;

import com.runway.backend.domain.auth.validation.PasswordPolicy;
import java.util.Base64;
import java.util.UUID;
import java.util.regex.Pattern;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.stereotype.Component;

@Component
public class MemberPasswordHasher {
    private static final Pattern FORMAT =
            Pattern.compile(
                    "\\$argon2id\\$v=19\\$m=65536,t=3,p=1\\$([A-Za-z0-9+/]{22})\\$([A-Za-z0-9+/]{43})");
    private final Argon2PasswordEncoder encoder = new Argon2PasswordEncoder(16, 32, 1, 65536, 3);
    private final String dummy = encoder.encode(UUID.randomUUID().toString());

    public String encode(String password) {
        if (!PasswordPolicy.accepts(password))
            throw new IllegalArgumentException("비밀번호 형식이 올바르지 않습니다.");
        return encoder.encode(password);
    }

    public boolean matches(String password, String encoded) {
        if (!validEncoding(encoded)) throw AuthErrors.unavailable();
        try {
            return encoder.matches(password, encoded);
        } catch (RuntimeException exception) {
            throw AuthErrors.unavailable();
        }
    }

    public void verifyDummy(String password) {
        encoder.matches(password, dummy);
    }

    private static boolean validEncoding(String encoded) {
        if (encoded == null) return false;
        var match = FORMAT.matcher(encoded);
        if (!match.matches()) return false;
        try {
            for (int i = 1; i <= 2; i++) {
                byte[] decoded = Base64.getDecoder().decode(match.group(i));
                if (decoded.length != (i == 1 ? 16 : 32)
                        || !Base64.getEncoder()
                                .withoutPadding()
                                .encodeToString(decoded)
                                .equals(match.group(i))) return false;
            }
            return true;
        } catch (IllegalArgumentException exception) {
            return false;
        }
    }
}
