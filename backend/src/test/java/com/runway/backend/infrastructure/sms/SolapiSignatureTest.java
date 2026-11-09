package com.runway.backend.infrastructure.sms;

import static org.assertj.core.api.Assertions.assertThat;

import java.security.SecureRandom;
import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;

/** AC-12: 공식 Node SDK(authenticator.ts)와 같은 서명. 기대값은 합성 키로 HMAC-SHA256(secret, date+salt)을 따로 계산한 값이다. */
class SolapiSignatureTest {
    private static final String DATE = "2026-11-09T12:00:00+09:00";
    private static final String SALT = "abcdefghijABCDEFGHIJ0123456789xy";

    @Test
    void 서명은_date와_salt를_이어_secret으로_계산한_소문자_hex다() {
        assertThat(SolapiSignature.signature("synthetic-secret", DATE, SALT))
                .isEqualTo("3811816cb04e8bfcfdc44bd4c2702f761a56e82db5f7aa06bf6a646ecd5191f7");
    }

    @Test
    void 헤더는_SDK와_같은_형식이다() {
        assertThat(SolapiSignature.authorization("synthetic-key", "synthetic-secret", DATE, SALT))
                .isEqualTo("HMAC-SHA256 apiKey=synthetic-key, date=" + DATE + ", salt=" + SALT
                        + ", signature=3811816cb04e8bfcfdc44bd4c2702f761a56e82db5f7aa06bf6a646ecd5191f7");
    }

    @Test
    void date는_초_단위_ISO8601이고_오프셋을_포함한다() {
        Clock seoul = Clock.fixed(Instant.parse("2026-11-09T03:00:00.987Z"), ZoneId.of("Asia/Seoul"));
        assertThat(SolapiSignature.date(seoul)).isEqualTo(DATE);
        Clock utc = Clock.fixed(Instant.parse("2026-11-09T03:00:00Z"), ZoneOffset.UTC);
        assertThat(SolapiSignature.date(utc)).isEqualTo("2026-11-09T03:00:00Z");
    }

    @Test
    void salt는_영문숫자_32자이고_매번_다르다() {
        var random = new SecureRandom();
        String first = SolapiSignature.salt(random);
        assertThat(first).hasSize(32).matches("[0-9a-zA-Z]{32}");
        assertThat(SolapiSignature.salt(random)).isNotEqualTo(first);
    }
}
