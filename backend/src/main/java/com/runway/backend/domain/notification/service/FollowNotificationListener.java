package com.runway.backend.domain.notification.service;

import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.repository.NotificationRepository;
import com.runway.backend.domain.user.service.FollowNotificationEvent;
import lombok.RequiredArgsConstructor;
import org.springframework.context.event.EventListener;
import org.springframework.stereotype.Component;

/** Consumes 249 follow events in the same transaction and persists inbox rows. */
@Component
@RequiredArgsConstructor
public class FollowNotificationListener {
    private final NotificationService notifications;
    private final NotificationRepository repository;

    @EventListener
    public void onFollowNotification(FollowNotificationEvent event) {
        NotificationType type = NotificationType.valueOf(event.kind().name());
        String nickname = repository.findNickname(event.actorId()).orElse("러너");
        String message =
                switch (event.kind()) {
                    case NEW_FOLLOWER -> nickname + "님이 회원님을 팔로우했습니다.";
                    case FOLLOW_REQUEST -> nickname + "님의 팔로우 요청이 도착했습니다.";
                    case FOLLOW_APPROVED -> nickname + "님이 팔로우 요청을 수락했습니다.";
                };
        notifications.create(
                event.recipientId(),
                type,
                event.actorId(),
                message,
                type.name() + ":" + event.requestId());
    }
}
