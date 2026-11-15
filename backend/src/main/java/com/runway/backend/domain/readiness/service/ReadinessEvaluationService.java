package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.formula.ReadinessFormula;
import com.runway.backend.domain.readiness.formula.ReadinessScore;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.TreeSet;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 준비도 자동 평가(readiness.md 자동 평가). {@link ReadinessEvaluationDispatcher}가 전용 스레드에서 날짜마다 호출한다.
 *
 * <p>잠금 순서: 회원별 평가 advisory lock → 회원 행 FOR SHARE. 같은 회원의 평가가 겹치면 뒤 평가는 앞 평가가 커밋된 뒤 최신 건강값을 다시 읽으므로,
 * 오래된 값으로 계산한 결과가 나중에 덮어쓰지 않는다. W06은 회원 행 FOR SHARE만 잡고 advisory lock을 잡지 않으므로 교차 대기가 없다. 회원 행을
 * 갱신하는 기능(동의 철회·탈퇴 등)이 이 advisory lock을 잡게 되면 반드시 회원 행보다 먼저 잡아야 한다.
 */
@Service
@RequiredArgsConstructor
public class ReadinessEvaluationService {

    /** 날짜 D가 바뀌면 D를 평소 RHR(이전 7일)로 쓰는 D+1~D+7도 다시 평가한다. */
    static final int FOLLOWING_DAYS = 7;

    /** 일별 부하가 바뀐 날짜 D는 D를 부하 28일 창에 넣는 D+1~D+27도 다시 평가한다(S15P31E105-599). */
    static final int LOAD_FOLLOWING_DAYS = ReadinessFormula.LOOKBACK_DAYS;

    /**
     * "오늘"의 시간대. 앱이 KST 날짜로 오늘 결과를 판정하고 서버의 MVP 기본 시간대도 Asia/Seoul이다(S15P31E105-836). 서버 시계는 UTC다.
     */
    public static final ZoneId TODAY_ZONE = ZoneId.of("Asia/Seoul");

    private final ReadinessJdbcRepository repository;
    private final Clock clock;

    /** 서버 시계의 KST 오늘 날짜. */
    public LocalDate today() {
        return LocalDate.ofInstant(clock.instant(), TODAY_ZONE);
    }

    /**
     * 평가할 날짜: 바뀐 날짜 전부와, 각 바뀐 날짜 D의 D+1~D+7 중 건강 행이 있는 날짜. 오름차순, 중복 없음. 건강 행이 없는 지난 날짜는 다시
     * 평가하지 않는다(과거 빈 날짜 소급은 범위 밖). 단 KST 오늘은 행이 없어도 넣는다(S15P31E105-836, 아래 메서드).
     */
    @Transactional(readOnly = true)
    public List<LocalDate> targetDates(long userId, List<LocalDate> changedDates) {
        return targetDates(userId, changedDates, List.of());
    }

    /**
     * 위와 같고, 일별 부하가 바뀐 날짜 D는 D+1~D+27(부하 28일 창) 중 건강 행이 있는 날짜까지 더한다(S15P31E105-599).
     *
     * <p>KST 오늘은 건강 행이 없어도 후보로 본다(S15P31E105-836). 오늘 행이 없어도 D-1·D-2 수면과 28일 부하로 점수가 나오므로, 과거 값이 바뀌면
     * 오늘 결과도 다시 계산해야 한다. 판정 범위(7일·27일)는 다른 후보와 같다.
     */
    @Transactional(readOnly = true)
    public List<LocalDate> targetDates(
            long userId, List<LocalDate> changedDates, List<LocalDate> loadChangedDates) {
        if (changedDates.isEmpty() && loadChangedDates.isEmpty()) {
            return List.of();
        }
        TreeSet<LocalDate> changed = new TreeSet<>(changedDates);
        TreeSet<LocalDate> loadChanged = new TreeSet<>(loadChangedDates);
        TreeSet<LocalDate> targets = new TreeSet<>(changed);
        targets.addAll(loadChanged);
        LocalDate last = targets.last();
        LocalDate until =
                last.plusDays(loadChanged.isEmpty() ? FOLLOWING_DAYS : LOAD_FOLLOWING_DAYS);
        LocalDate from = targets.first().plusDays(1);
        List<LocalDate> candidates = new ArrayList<>(repository.findMetricDates(userId, from, until));
        LocalDate today = today();
        if (!today.isBefore(from) && !today.isAfter(until)) {
            candidates.add(today);
        }
        for (LocalDate candidate : candidates) {
            if (within(changed, candidate, FOLLOWING_DAYS)
                    || within(loadChanged, candidate, LOAD_FOLLOWING_DAYS)) {
                targets.add(candidate);
            }
        }
        return List.copyOf(targets);
    }

    /** candidate보다 앞선 가장 가까운 바뀐 날짜 D가 있고 candidate ≤ D+days인가. */
    private static boolean within(TreeSet<LocalDate> changed, LocalDate candidate, int days) {
        LocalDate nearest = changed.lower(candidate);
        return nearest != null && !candidate.isAfter(nearest.plusDays(days));
    }

    /**
     * 한 날짜를 한 트랜잭션에서 평가한다. 활성 회원이 아니거나 건강정보 동의가 없거나 계산할 항목이 없으면 아무것도 저장하지 않는다(기존 결과도 그대로
     * 둔다).
     *
     * @return 저장한 결과. 저장하지 않았으면 빈 값
     */
    @Transactional
    public Optional<ReadinessScore> evaluate(long userId, LocalDate date) {
        repository.lockEvaluation(userId);
        boolean consented = repository.lockActiveUserConsent(userId).orElse(false);
        if (!consented) {
            return Optional.empty();
        }
        Optional<ReadinessScore> score =
                ReadinessFormula.evaluate(
                        date,
                        repository.findHealthInputs(
                                userId, date.minusDays(ReadinessFormula.LOOKBACK_DAYS), date),
                        repository.findFirstLoadDate(userId, date).orElse(null));
        score.ifPresent(s -> repository.upsert(userId, date, s));
        return score;
    }
}
