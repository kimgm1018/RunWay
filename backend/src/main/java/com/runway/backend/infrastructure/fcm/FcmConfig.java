package com.runway.backend.infrastructure.fcm;

import com.google.auth.oauth2.GoogleCredentials;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;
import com.google.firebase.messaging.FirebaseMessaging;
import com.runway.backend.domain.notification.push.PushMessage;
import com.runway.backend.domain.notification.push.PushSendResult;
import com.runway.backend.domain.notification.push.PushSender;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.util.UUID;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * FCM 발송 구성(ADR-0025). 꺼져 있으면 발송하지 않는 구현을 쓰고 알림 행은 PENDING으로 남는다. 켰는데 키가 없거나 해석할 수 없으면 기동을
 * 실패시켜 조용히 발송하지 않는 상태를 막는다.
 */
@Configuration
@EnableConfigurationProperties(PushProperties.class)
public class FcmConfig {
    static final int TIMEOUT_MILLIS = 10_000;

    @Bean
    PushSender pushSender(PushProperties properties) {
        if (!properties.isEnabled()) {
            return new DisabledPushSender();
        }
        byte[] json = properties.serviceAccountJson();
        GoogleCredentials credentials;
        try {
            credentials = GoogleCredentials.fromStream(new ByteArrayInputStream(json));
        } catch (IOException | RuntimeException e) {
            // 원인 메시지에 키 내용 일부가 들어갈 수 있어 연결하지 않는다.
            throw new IllegalStateException(
                    PushProperties.KEY_VARIABLE + "의 서비스 계정 JSON을 해석할 수 없습니다.");
        }
        FirebaseOptions options =
                FirebaseOptions.builder()
                        .setCredentials(credentials)
                        .setConnectTimeout(TIMEOUT_MILLIS)
                        .setReadTimeout(TIMEOUT_MILLIS)
                        .build();
        // 이름 있는 앱을 쓴다. 테스트에서 컨텍스트가 여러 개여도 기본 앱 이름이 충돌하지 않는다.
        FirebaseApp app = FirebaseApp.initializeApp(options, "runway-push-" + UUID.randomUUID());
        return new FcmPushSender(app, FirebaseMessaging.getInstance(app), properties.getAndroidChannelId());
    }

    /** 푸시 꺼짐. */
    static final class DisabledPushSender implements PushSender {
        @Override
        public boolean enabled() {
            return false;
        }

        @Override
        public PushSendResult send(PushMessage message) {
            return PushSendResult.FAILED;
        }
    }
}
