package com.runway.backend.global.security;

import java.util.Base64;
import java.util.Set;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;

/** Holds secrets without record/Lombok-generated toString or binding error value disclosure. */
public final class SecuritySettings {

    private final SecretKey signingKey;
    private final boolean localDocs;
    private final String docsUsername;
    private final String docsPasswordHash;

    public SecuritySettings(Environment environment) {
        String rawKey = environment.getProperty("runway.security.jwt-secret-base64", "");
        byte[] decoded;
        try {
            decoded = Base64.getDecoder().decode(rawKey);
        } catch (IllegalArgumentException exception) {
            throw invalid("BACKEND_JWT_SECRET_BASE64");
        }
        if (decoded.length < 32) {
            throw invalid("BACKEND_JWT_SECRET_BASE64");
        }
        signingKey = new SecretKeySpec(decoded, "HmacSHA256");
        String mode = environment.getProperty("runway.security.docs-access-mode", "password");
        if (!Set.of("local", "password").contains(mode)) {
            throw invalid("BACKEND_DOCS_ACCESS_MODE");
        }
        localDocs = mode.equals("local");
        if (localDocs
                && !Set.of("127.0.0.1", "::1")
                        .contains(environment.getProperty("server.address", "127.0.0.1"))) {
            throw invalid("BACKEND_DOCS_ACCESS_MODE / BACKEND_BIND_ADDRESS");
        }
        docsUsername = environment.getProperty("runway.security.docs-username", "");
        docsPasswordHash = environment.getProperty("runway.security.docs-password-hash", "");
        if (!localDocs) {
            if (docsUsername.isBlank()) {
                throw invalid("BACKEND_DOCS_USERNAME");
            }
            if (!docsPasswordHash.matches(
                    "\\{bcrypt}\\$2[aby]\\$(0[4-9]|[12][0-9]|3[01])\\$[./A-Za-z0-9]{53}")) {
                throw invalid("BACKEND_DOCS_PASSWORD_HASH");
            }
        }
    }

    SecretKey signingKey() {
        return signingKey;
    }

    boolean localDocs() {
        return localDocs;
    }

    String docsUsername() {
        return docsUsername;
    }

    String docsPasswordHash() {
        return docsPasswordHash;
    }

    private static IllegalStateException invalid(String name) {
        return new IllegalStateException("보안 설정을 확인하세요: " + name);
    }
}
