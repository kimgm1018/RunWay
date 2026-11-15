package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.LocalDate;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;

/**
 * 매일 KST 00:05에 오늘 준비도를 평가한다(S15P31E105-836, readiness.md 자동 평가). 오늘 수면·안정 심박이 없으면 오늘 건강 행이 없어 W06 이벤트
 * 평가가 오늘을 고르지 않는다. 산식은 D-1·D-2 수면과 28일 부하만으로도 점수를 내므로 날짜가 바뀐 직후 오늘을 먼저 평가한다. 그 뒤 오늘 값이 들어오거나
 * 과거 값이 바뀌면 이벤트 평가가 오늘을 다시 평가한다.
 *
 * <p>회원마다 {@link ReadinessEvaluationService#evaluate}를 스케줄 스레드에서 차례로 호출한다. 회원 수만큼 준비도 실행기 대기열(1,000건)에 넣으면
 * 넘칠 수 있어 쓰지 않는다. 평가 잠금·동의 재확인·계산 항목 없으면 저장하지 않는 규칙은 evaluate가 그대로 지킨다. 같은 회원 이벤트 평가와 겹쳐도 회원별
 * 잠금으로 한 줄로 선다.
 *
 * <p>Bean 등록·스케줄 활성화는 {@link ReadinessDailyEvaluationConfiguration}이 속성으로 켜고 끈다.
 */
@RequiredArgsConstructor
public class ReadinessDailyEvaluationJob {

    private static final Logger log = LoggerFactory.getLogger(ReadinessDailyEvaluationJob.class);

    private final ReadinessJdbcRepository repository;
    private final ReadinessEvaluationService evaluationService;

    @Scheduled(cron = "0 5 0 * * *", zone = "Asia/Seoul")
    public void run() {
        evaluateToday();
    }

    /**
     * KST 오늘을 대상 회원마다 평가한다. 한 회원 실패는 회원 ID·날짜·예외 종류만 로그하고 다음 회원을 계속한다(예외 메시지에는 바인딩한 건강 값이 들어갈 수
     * 있다).
     *
     * @return 점수를 저장한 회원 수
     */
    public int evaluateToday() {
        LocalDate today = evaluationService.today();
        List<Long> userIds;
        try {
            userIds = repository.findDailyEvaluationUserIds(today);
        } catch (RuntimeException e) {
            log.warn("준비도 정기 평가 대상 조회 실패 (date={}, {})", today, e.getClass().getSimpleName());
            return 0;
        }
        int saved = 0;
        for (long userId : userIds) {
            try {
                if (evaluationService.evaluate(userId, today).isPresent()) {
                    saved++;
                }
            } catch (RuntimeException e) {
                log.warn(
                        "준비도 정기 평가 실패 (userId={}, date={}, {})",
                        userId,
                        today,
                        e.getClass().getSimpleName());
            }
        }
        log.info("준비도 정기 평가 완료 (date={}, users={}, saved={})", today, userIds.size(), saved);
        return saved;
    }
}
