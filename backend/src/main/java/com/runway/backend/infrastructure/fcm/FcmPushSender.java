package com.runway.backend.infrastructure.fcm;

import com.google.firebase.FirebaseApp;
import com.google.firebase.messaging.AndroidConfig;
import com.google.firebase.messaging.AndroidNotification;
import com.google.firebase.messaging.FirebaseMessaging;
import com.google.firebase.messaging.FirebaseMessagingException;
import com.google.firebase.messaging.Message;
import com.google.firebase.messaging.MessagingErrorCode;
import com.google.firebase.messaging.Notification;
import com.runway.backend.domain.notification.push.PushMessage;
import com.runway.backend.domain.notification.push.PushSendResult;
import com.runway.backend.domain.notification.push.PushSender;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.DisposableBean;

/** FCM HTTP v1 발송(firebase-admin). 토큰 원문·예외 메시지는 로그에 남기지 않는다. */
class FcmPushSender implements PushSender, DisposableBean {
    private static final Logger log = LoggerFactory.getLogger(FcmPushSender.class);

    private final FirebaseApp app;
    private final FirebaseMessaging messaging;
    private final String channelId;

    FcmPushSender(FirebaseApp app, FirebaseMessaging messaging, String channelId) {
        this.app = app;
        this.messaging = messaging;
        this.channelId = channelId;
    }

    @Override
    public boolean enabled() {
        return true;
    }

    @Override
    public PushSendResult send(PushMessage message) {
        try {
            messaging.send(toFcm(message, channelId));
            return PushSendResult.SENT;
        } catch (FirebaseMessagingException e) {
            PushSendResult result = classify(e.getMessagingErrorCode());
            log.warn(
                    "푸시 전송 실패 (token={}, code={}, result={})",
                    message.maskedToken(),
                    e.getMessagingErrorCode(),
                    result);
            return result;
        } catch (RuntimeException e) {
            log.warn(
                    "푸시 전송 실패 (token={}, {})",
                    message.maskedToken(),
                    e.getClass().getSimpleName());
            return PushSendResult.FAILED;
        }
    }

    /**
     * 등록 토큰 대상 발송. FCM은 설치 ID(FID) 대상 발송으로 옮겨 가며 {@code setToken}을 사용 중단 예고했으나, 앱이 아직 토큰 API(FID 미전환)를
     * 쓰므로 토큰 발송을 유지한다. FID 전환은 ADR-0025 후속 작업이다.
     */
    @SuppressWarnings("deprecation")
    static Message toFcm(PushMessage message, String channelId) {
        return Message.builder()
                .setToken(message.token())
                .setNotification(
                        Notification.builder()
                                .setTitle(message.title())
                                .setBody(message.body())
                                .build())
                .setAndroidConfig(
                        AndroidConfig.builder()
                                .setPriority(AndroidConfig.Priority.HIGH)
                                .setNotification(
                                        AndroidNotification.builder()
                                                .setChannelId(channelId)
                                                .build())
                                .build())
                .putAllData(message.data())
                .build();
    }

    /**
     * UNREGISTERED: 앱 삭제·토큰 만료. INVALID_ARGUMENT: 이 서버는 고정된 형식의 메시지만 보내므로 토큰 형식 오류로 본다. SENDER_ID_MISMATCH: 다른
     * Firebase 프로젝트의 토큰. 세 경우 모두 다시 보내도 성공하지 않으므로 토큰을 지운다.
     */
    static PushSendResult classify(MessagingErrorCode code) {
        if (code == MessagingErrorCode.UNREGISTERED
                || code == MessagingErrorCode.INVALID_ARGUMENT
                || code == MessagingErrorCode.SENDER_ID_MISMATCH) {
            return PushSendResult.INVALID_TOKEN;
        }
        return PushSendResult.FAILED;
    }

    @Override
    public void destroy() {
        app.delete();
    }
}
