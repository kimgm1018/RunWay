package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.time.Clock;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZonedDateTime;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 오늘 준비도 푸시(S15P31E105-847). 회원·KST 날짜당 한 번, 오늘 결과가 있을 때만 공통 알림 모듈로 알림함 행을 만들고 커밋 후 푸시한다(ADR-0025).
 * 설정은 groupRun을 따르며 꺼져 있으면 공통 모듈이 행·푸시를 만들지 않는다.
 *
 * <p>발송 시각: KST {@value #SEND_HOUR}시 정기 발송({@link ReadinessPushJob})과, 그 뒤 오늘 결과가 처음 저장될 때 이벤트 평가에서의 발송. 00:05 정기 평가가
 * 오늘 결과를 처음 만들 때는 아직 시각 전이라 보내지 않는다. 같은 날 다시 불려도 dedupe 키로 새 행을 만들지 않는다.
 *
 * <p>평가 트랜잭션 밖에서 불린다. 결과 조회와 알림 생성은 각자의 트랜잭션이다. 그사이 동의를 철회해도 알림 생성은 막지 못하나, 결과 조회가 동의를 다시 확인하므로
 * 철회가 먼저 커밋됐으면 보내지 않는다.
 */
@Component
@RequiredArgsConstructor
public class ReadinessPushNotifier {

    /** 정기 발송 시각(KST 시). 이 시각 전에는 이벤트 평가에서 보내지 않는다. */
    public static final int SEND_HOUR = 8;

    static final String DEDUPE_PREFIX = NotificationType.READINESS_TODAY.name() + ":";

    private final ReadinessJdbcRepository repository;
    private final NotificationService notifications;
    private final Clock clock;

    /**
     * 이벤트 평가가 date 결과를 저장한 뒤 부른다. date가 KST 오늘이고 정기 발송 시각이 지났을 때만 보낸다.
     *
     * @return 새 알림 행을 만들었으면 true
     */
    public boolean notifyIfDue(long userId, LocalDate date) {
        ZonedDateTime now = ZonedDateTime.now(clock.withZone(ReadinessEvaluationService.TODAY_ZONE));
        if (!date.equals(now.toLocalDate()) || now.toLocalTime().isBefore(LocalTime.of(SEND_HOUR, 0))) {
            return false;
        }
        return send(userId, date);
    }

    /**
     * date 결과로 알림을 만든다. 결과가 없거나 동의·활성 회원이 아니면 보내지 않는다.
     *
     * @return 새 알림 행을 만들었으면 true(설정 꺼짐·이미 보냄이면 false)
     */
    public boolean send(long userId, LocalDate date) {
        return repository
                .findPushReadiness(userId, date)
                .map(
                        readiness ->
                                notifications.create(
                                        userId,
                                        NotificationType.READINESS_TODAY,
                                        readiness.id(),
                                        message(readiness.score()),
                                        dedupeKey(userId, date)))
                .orElse(false);
    }

    /** 앱 2.1과 같은 점수 표기(소수 둘째 자리까지, 끝의 0 제거). */
    static String message(BigDecimal score) {
        String text = score.setScale(2, RoundingMode.HALF_UP).stripTrailingZeros().toPlainString();
        return "오늘 준비도는 " + text + "점입니다. 달리러 가볼까요?";
    }

    static String dedupeKey(long userId, LocalDate date) {
        return DEDUPE_PREFIX + userId + ":" + date;
    }
}
