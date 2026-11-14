package com.runway.backend.domain.notification.push;

import com.runway.backend.domain.notification.repository.NotificationRepository;
import com.runway.backend.domain.notification.repository.PushTokenRepository;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 커밋된 알림 행 하나를 수신자의 모든 기기 토큰으로 보내고 결과를 기록한다(ADR-0025).
 *
 * <p>FCM 호출을 감싸는 트랜잭션은 두지 않는다. 토큰 목록은 한 번 읽지만 토큰마다 보내기 직전에 소유자를 다시 확인한다. 행·토큰 조회, 무효 토큰 삭제, 상태 갱신은 각각 단일 문장이다. 상태 갱신은 PENDING인 행만 바꾸므로
 * 그사이 행이 지워졌으면(가입 신청 철회, 탈퇴) 바뀌는 행이 없다.
 */
@Service
@RequiredArgsConstructor
public class PushDispatchService {
    static final String TITLE = "RunWay";

    private static final Logger log = LoggerFactory.getLogger(PushDispatchService.class);

    private final NotificationRepository notifications;
    private final PushTokenRepository tokens;
    private final PushSender sender;

    public void deliver(long notificationId) {
        if (!sender.enabled()) {
            return;
        }
        var row = notifications.findPendingForPush(notificationId);
        if (row.isEmpty()) {
            return;
        }
        var notification = row.get();
        var targets = tokens.findTokens(notification.userId());
        if (targets.isEmpty()) {
            return;
        }
        Map<String, String> data =
                Map.of(
                        "notificationId", Long.toString(notification.id()),
                        "kind", notification.kind(),
                        "targetId", Long.toString(notification.targetId()));
        int attempted = 0;
        int sent = 0;
        for (String token : targets) {
            // 앞 토큰 발송이 FCM 지연으로 오래 걸리는 사이 이 기기가 다른 계정으로 재등록되거나(N03) 해제·탈퇴로 지워졌을 수 있다.
            // 보내기 직전에 소유자를 다시 확인해 다른 계정의 기기로 보내지 않는다.
            if (!tokens.isOwnedBy(notification.userId(), token)) {
                continue;
            }
            attempted++;
            var message = new PushMessage(token, TITLE, notification.message(), data);
            PushSendResult result = sender.send(message);
            if (result == PushSendResult.SENT) {
                sent++;
            } else if (result == PushSendResult.INVALID_TOKEN) {
                tokens.deleteToken(token);
                log.info(
                        "무효 푸시 토큰 삭제 (notificationId={}, token={})",
                        notificationId,
                        message.maskedToken());
            }
            // FAILED: 토큰은 유지한다. 오류 코드는 발송 구현이 로그로 남긴다.
        }
        if (attempted == 0) {
            return; // 보낼 기기가 남지 않음: 토큰이 없을 때와 같이 PENDING으로 둔다.
        }
        if (sent > 0) {
            notifications.markPushSent(notificationId);
        } else {
            notifications.markPushFailed(notificationId);
        }
    }
}
