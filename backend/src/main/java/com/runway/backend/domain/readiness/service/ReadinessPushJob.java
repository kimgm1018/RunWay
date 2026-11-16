package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 매일 KST 08:00에 오늘 준비도 푸시를 보낸다(S15P31E105-847). 오늘 결과가 있는 활성·동의 회원마다 {@link ReadinessPushNotifier#send}를 스케줄
 * 스레드에서 차례로 부른다. 행 생성은 회원마다 짧은 트랜잭션이고 FCM 호출은 커밋 후 푸시 실행기가 한다.
 *
 * <p>Bean 등록·스케줄 활성화는 {@link ReadinessPushConfiguration}이 속성으로 켜고 끈다.
 */
@RequiredArgsConstructor
public class ReadinessPushJob {

    private static final Logger log = LoggerFactory.getLogger(ReadinessPushJob.class);

    private final ReadinessJdbcRepository repository;
    private final ReadinessEvaluationService evaluationService;
    private final ReadinessPushNotifier notifier;

    @Scheduled(cron = "0 0 8 * * *", zone = "Asia/Seoul")
    public void run() {
        sendToday();
    }

    /**
     * KST 오늘 결과가 있는 회원에게 보낸다. 한 회원 실패는 회원 ID·날짜·예외 종류만 로그하고 다음 회원을 계속한다(점수는 로그에 남기지 않는다).
     *
     * @return 새 알림 행을 만든 회원 수
     */
    public int sendToday() {
        LocalDate today = evaluationService.today();
        List<Long> userIds;
        try {
            userIds = repository.findPushUserIds(today);
        } catch (RuntimeException e) {
            log.warn("준비도 푸시 대상 조회 실패 (date={}, {})", today, e.getClass().getSimpleName());
            return 0;
        }
        int created = 0;
        for (long userId : userIds) {
            try {
                if (notifier.send(userId, today)) {
                    created++;
                }
            } catch (RuntimeException e) {
                log.warn(
                        "준비도 푸시 생성 실패 (userId={}, date={}, {})",
                        userId,
                        today,
                        e.getClass().getSimpleName());
            }
        }
        log.info("준비도 푸시 완료 (date={}, users={}, created={})", today, userIds.size(), created);
        return created;
    }
}
