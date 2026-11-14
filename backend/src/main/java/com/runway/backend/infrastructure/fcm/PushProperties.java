package com.runway.backend.infrastructure.fcm;

import java.util.Base64;
import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 앱 밖 푸시(FCM) 설정(S15P31E105-815, ADR-0025). 서비스 계정 키는 서버에 평문 파일로 두지 않고 JSON을 base64로 인코딩해 환경변수로
 * 주입한다. Secret을 포함하므로 toString을 생성하지 않고, 오류 메시지에는 변수 이름만 넣는다.
 */
@Getter
@Setter
@ConfigurationProperties(prefix = "runway.push")
public class PushProperties {
    static final String KEY_VARIABLE = "BACKEND_FCM_SERVICE_ACCOUNT_BASE64";

    private boolean enabled;
    private String serviceAccountBase64 = "";
    private String androidChannelId = "runway_default";

    /** 켰을 때만 키를 요구한다. 해석한 JSON 바이트를 돌려준다. */
    byte[] serviceAccountJson() {
        String value = serviceAccountBase64 == null ? "" : serviceAccountBase64.strip();
        if (value.isEmpty()) {
            throw new IllegalStateException(KEY_VARIABLE + " 설정이 필요합니다.");
        }
        try {
            return Base64.getDecoder().decode(value);
        } catch (IllegalArgumentException e) {
            throw new IllegalStateException(KEY_VARIABLE + "는 서비스 계정 JSON의 base64 값이어야 합니다.");
        }
    }
}
