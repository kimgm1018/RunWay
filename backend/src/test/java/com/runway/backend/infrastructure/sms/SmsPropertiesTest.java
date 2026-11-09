package com.runway.backend.infrastructure.sms;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

/** 켰을 때만 키·발신번호를 요구하고, 실패 메시지에는 변수 이름만 담는다. */
class SmsPropertiesTest {
    private static SmsProperties enabled() {
        var properties = new SmsProperties();
        properties.setEnabled(true);
        properties.getSolapi().setApiKey("synthetic-key");
        properties.getSolapi().setApiSecret("synthetic-secret");
        properties.getSolapi().setSenderNumber("01011112222");
        return properties;
    }

    @Test
    void 꺼져_있으면_값이_없어도_기동한다() {
        assertThatCode(() -> new SmsProperties().validate()).doesNotThrowAnyException();
    }

    @Test
    void 켜져_있고_값이_모두_있으면_기동한다() {
        assertThatCode(() -> enabled().validate()).doesNotThrowAnyException();
    }

    @Test
    void 켜져_있는데_값이_없으면_변수_이름만_알리고_실패한다() {
        var noKey = enabled();
        noKey.getSolapi().setApiKey(" ");
        assertThatThrownBy(noKey::validate).hasMessage("BACKEND_SOLAPI_API_KEY 설정이 필요합니다.");
        var noSecret = enabled();
        noSecret.getSolapi().setApiSecret("");
        assertThatThrownBy(noSecret::validate).hasMessage("BACKEND_SOLAPI_API_SECRET 설정이 필요합니다.");
        var noSender = enabled();
        noSender.getSolapi().setSenderNumber(null);
        assertThatThrownBy(noSender::validate).hasMessage("BACKEND_SOLAPI_SENDER_NUMBER 설정이 필요합니다.");
    }

    @Test
    void 줄바꿈이나_숫자가_아닌_발신번호는_거절한다() {
        var newline = enabled();
        newline.getSolapi().setApiSecret("secret\nx");
        assertThatThrownBy(newline::validate).hasMessage("BACKEND_SOLAPI_API_SECRET 설정이 필요합니다.");
        var hyphen = enabled();
        hyphen.getSolapi().setSenderNumber("010-1111-2222");
        assertThatThrownBy(hyphen::validate)
                .hasMessage("BACKEND_SOLAPI_SENDER_NUMBER는 숫자만 입력해야 합니다.")
                .message()
                .doesNotContain("010");
    }
}
