package com.runway.backend.infrastructure.sms;

import java.util.regex.Pattern;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** 휴대전화 인증 SMS 설정(S15P31E105-560). Secret을 포함하므로 toString을 생성하지 않는다. */
@Getter
@Setter
@ConfigurationProperties(prefix = "runway.sms")
public class SmsProperties {
    private static final Pattern SENDER = Pattern.compile("0[0-9]{7,10}");

    private boolean enabled;
    private Solapi solapi = new Solapi();

    /** 켰을 때만 키·발신번호를 요구한다. 값은 메시지에 넣지 않고 변수 이름만 안내한다. */
    public void validate() {
        if (!enabled) return;
        require(solapi.apiKey, "BACKEND_SOLAPI_API_KEY");
        require(solapi.apiSecret, "BACKEND_SOLAPI_API_SECRET");
        require(solapi.senderNumber, "BACKEND_SOLAPI_SENDER_NUMBER");
        if (!SENDER.matcher(solapi.senderNumber).matches()) {
            throw new IllegalStateException("BACKEND_SOLAPI_SENDER_NUMBER는 숫자만 입력해야 합니다.");
        }
    }

    private static void require(String value, String name) {
        if (value == null || value.isBlank() || value.contains("\r") || value.contains("\n")) {
            throw new IllegalStateException(name + " 설정이 필요합니다.");
        }
    }

    @Getter
    @Setter
    public static class Solapi {
        private String apiKey = "";
        private String apiSecret = "";
        private String senderNumber = "";
    }
}
