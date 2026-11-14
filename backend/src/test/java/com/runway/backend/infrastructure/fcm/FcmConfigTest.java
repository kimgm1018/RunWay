package com.runway.backend.infrastructure.fcm;

import static org.assertj.core.api.Assertions.assertThat;

import com.google.firebase.messaging.MessagingErrorCode;
import com.runway.backend.domain.notification.push.PushMessage;
import com.runway.backend.domain.notification.push.PushSendResult;
import com.runway.backend.domain.notification.push.PushSender;
import java.nio.charset.StandardCharsets;
import java.security.KeyPairGenerator;
import java.util.Base64;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/** Push configuration and FCM error mapping (S15P31E105-815, AC-4·AC-5·AC-9). No network is used. */
class FcmConfigTest {
    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(FcmConfig.class);

    @Test
    void disabledByDefaultUsesSenderThatSendsNothing() {
        runner.run(
                context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getBean(PushSender.class).enabled()).isFalse();
                });
    }

    @Test
    void enabledWithoutKeyFailsStartupNamingOnlyTheVariable() {
        runner.withPropertyValues("runway.push.enabled=true")
                .run(
                        context ->
                                assertThat(context)
                                        .hasFailed()
                                        .getFailure()
                                        .hasRootCauseMessage(
                                                "BACKEND_FCM_SERVICE_ACCOUNT_BASE64 설정이 필요합니다."));
    }

    @Test
    void enabledWithNonBase64KeyFailsWithoutEchoingIt() {
        String secretLike = "not*base64*secret-value";
        runner.withPropertyValues(
                        "runway.push.enabled=true",
                        "runway.push.service-account-base64=" + secretLike)
                .run(
                        context -> {
                            assertThat(context).hasFailed();
                            assertThat(stackText(context.getStartupFailure()))
                                    .contains("BACKEND_FCM_SERVICE_ACCOUNT_BASE64")
                                    .doesNotContain(secretLike);
                        });
    }

    @Test
    void enabledWithUnreadableJsonFailsWithoutEchoingIt() {
        String json = "{\"type\":\"service_account\",\"private_key\":\"secret-material\"}";
        runner.withPropertyValues(
                        "runway.push.enabled=true",
                        "runway.push.service-account-base64=" + base64(json))
                .run(
                        context -> {
                            assertThat(context).hasFailed();
                            assertThat(stackText(context.getStartupFailure()))
                                    .contains("BACKEND_FCM_SERVICE_ACCOUNT_BASE64")
                                    .doesNotContain("secret-material");
                        });
    }

    @Test
    void enabledWithServiceAccountJsonBuildsFcmSender() throws Exception {
        runner.withPropertyValues(
                        "runway.push.enabled=true",
                        "runway.push.service-account-base64=" + base64(fakeServiceAccount()))
                .run(
                        context -> {
                            assertThat(context).hasNotFailed();
                            var sender = context.getBean(PushSender.class);
                            assertThat(sender).isInstanceOf(FcmPushSender.class);
                            assertThat(sender.enabled()).isTrue();
                        });
    }

    @Test
    void tokenErrorsDeleteTokenOthersKeepIt() {
        assertThat(FcmPushSender.classify(MessagingErrorCode.UNREGISTERED))
                .isEqualTo(PushSendResult.INVALID_TOKEN);
        assertThat(FcmPushSender.classify(MessagingErrorCode.INVALID_ARGUMENT))
                .isEqualTo(PushSendResult.INVALID_TOKEN);
        assertThat(FcmPushSender.classify(MessagingErrorCode.SENDER_ID_MISMATCH))
                .isEqualTo(PushSendResult.INVALID_TOKEN);
        assertThat(FcmPushSender.classify(MessagingErrorCode.UNAVAILABLE))
                .isEqualTo(PushSendResult.FAILED);
        assertThat(FcmPushSender.classify(MessagingErrorCode.INTERNAL))
                .isEqualTo(PushSendResult.FAILED);
        assertThat(FcmPushSender.classify(MessagingErrorCode.QUOTA_EXCEEDED))
                .isEqualTo(PushSendResult.FAILED);
        assertThat(FcmPushSender.classify(null)).isEqualTo(PushSendResult.FAILED);
    }

    @Test
    void messageToStringNeverContainsFullToken() {
        var message =
                new PushMessage("abcdefgh-secret-device-token", "RunWay", "body", Map.of("k", "v"));
        assertThat(message.toString()).doesNotContain("secret-device-token").contains("abcdefgh****");
        assertThat(new PushMessage("short", "t", "b", Map.of()).maskedToken()).isEqualTo("****");
        assertThat(FcmPushSender.toFcm(message, "runway_default")).isNotNull();
    }

    private static String base64(String value) {
        return Base64.getEncoder().encodeToString(value.getBytes(StandardCharsets.UTF_8));
    }

    private static String stackText(Throwable failure) {
        var text = new StringBuilder();
        for (Throwable t = failure; t != null; t = t.getCause()) {
            text.append(t).append('\n');
        }
        return text.toString();
    }

    /** A syntactically valid service account with a throwaway key; it is never sent anywhere. */
    private static String fakeServiceAccount() throws Exception {
        var generator = KeyPairGenerator.getInstance("RSA");
        generator.initialize(2048);
        String pem =
                "-----BEGIN PRIVATE KEY-----\\n"
                        + Base64.getEncoder()
                                .encodeToString(generator.generateKeyPair().getPrivate().getEncoded())
                        + "\\n-----END PRIVATE KEY-----\\n";
        return """
                {"type":"service_account","project_id":"runway-test","private_key_id":"test",
                 "private_key":"%s","client_email":"push@runway-test.iam.gserviceaccount.com",
                 "client_id":"1","token_uri":"https://oauth2.googleapis.com/token"}
                """
                .formatted(pem);
    }
}
