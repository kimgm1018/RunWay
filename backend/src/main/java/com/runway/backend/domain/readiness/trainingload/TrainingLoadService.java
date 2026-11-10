package com.runway.backend.domain.readiness.trainingload;

import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadCalculator.Result;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadJdbcRepository.SessionInfo;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadJdbcRepository.StoredLoad;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadJdbcRepository.ZoneParams;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Collection;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedMap;
import java.util.TreeSet;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 운동 부하 저장과 일별 부하 재계산(S15P31E105-599, readiness-formula.md 5·7절).
 *
 * <ul>
 *   <li>RunWay 러닝: 종료 후 분석이 READY로 커밋되면 {@link #recordSession(long)}이 저장된 심박 샘플로 부하를 계산한다.
 *   <li>삼성 헬스 운동: W06 트랜잭션 안에서 {@link #saveSamsungExercise}로 저장하고 {@link #recomputeDaily}로 일별 합을 갱신한다.
 * </ul>
 *
 * <p>일별 부하가 바뀐 날짜는 {@link DailyHealthMetricsChangedEvent}의 loadChangedDates로 알려 준비도가 D+27까지 다시 평가되게 한다. 건강 값은
 * 로그에 남기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class TrainingLoadService {

    /** 서버는 회원 시간대를 모르므로 RunWay 러닝 날짜는 H06/H07 통계와 같은 MVP 기본 시간대로 정한다. */
    public static final ZoneId SESSION_ZONE = ZoneId.of("Asia/Seoul");

    private final TrainingLoadJdbcRepository repository;
    private final ApplicationEventPublisher events;

    /**
     * 러닝 1건의 부하를 계산·저장하고 영향받는 날짜의 일별 부하를 다시 계산한다. 같은 세션을 다시 불러도 같은 결과다. 활성 회원이 아니면(탈퇴) 아무것도
     * 하지 않는다. 삭제된 러닝이거나, 측정된 심박이 없거나, 건강정보 동의가 없으면 새로 계산·저장하지 않고 저장된 부하 행만 지운다(같은 시간의 삼성 헬스
     * 기록이 쓰이도록 빈 행을 두지 않으며, 동의를 철회한 뒤 삭제한 러닝의 부하도 남기지 않는다).
     *
     * <p>세션은 부하 잠금을 잡은 뒤 다시 읽는다. 분석 직후 저장과 삭제가 겹쳐도 삭제가 커밋된 뒤의 처리는 삭제를 본다.
     */
    @Transactional(propagation = Propagation.REQUIRES_NEW)
    public void recordSession(long sessionId) {
        Optional<SessionInfo> found = repository.findSession(sessionId);
        if (found.isEmpty()) {
            return;
        }
        long userId = found.get().userId();
        Optional<Boolean> consent = repository.lockActiveUserConsent(userId);
        if (consent.isEmpty()) {
            return;
        }
        repository.lockUserLoads(userId);
        Optional<SessionInfo> current = repository.findSession(sessionId);
        if (current.isEmpty()) {
            return;
        }
        SessionInfo session = current.get();
        boolean consented = consent.get();

        TreeSet<LocalDate> affected = new TreeSet<>();
        Optional<StoredLoad> previous = repository.findBySession(sessionId);
        previous.ifPresent(
                p -> {
                    affected.add(p.metricDate());
                    affected.addAll(
                            repository.findOverlappingSamsungDates(
                                    userId, p.startedAt(), p.endedAt()));
                });

        Optional<Result> result = Optional.empty();
        LocalDate date = null;
        if (consented && session.countable()) {
            date = session.startedAt().atZone(SESSION_ZONE).toLocalDate();
            SortedMap<Integer, Integer> histogram =
                    TrainingLoadCalculator.histogram(repository.findSessionHeartRates(sessionId));
            Optional<ZoneParams> params = repository.findZoneParams(userId, date);
            if (!histogram.isEmpty() && params.isPresent()) {
                result =
                        Optional.of(
                                TrainingLoadCalculator.calculate(
                                        histogram, params.get().hrMax(), params.get().rhr()));
            }
        }

        if (result.isEmpty()) {
            if (previous.isEmpty()) {
                return;
            }
            repository.delete(previous.get().id());
        } else if (previous.isPresent()) {
            StoredLoad p = previous.get();
            if (p.sameAs(session.startedAt(), session.endedAt(), date, result.get())) {
                return;
            }
            repository.update(p.id(), session.startedAt(), session.endedAt(), date, result.get());
        } else {
            repository.insert(
                    userId,
                    TrainingLoadJdbcRepository.SOURCE_RUNWAY_SESSION,
                    sessionId,
                    null,
                    session.startedAt(),
                    session.endedAt(),
                    date,
                    result.get());
        }
        if (result.isPresent()) {
            affected.add(date);
            affected.addAll(
                    repository.findOverlappingSamsungDates(
                            userId, session.startedAt(), session.endedAt()));
        }
        List<LocalDate> changed = recomputeDaily(userId, affected);
        if (!changed.isEmpty()) {
            events.publishEvent(new DailyHealthMetricsChangedEvent(userId, changed, changed));
        }
    }

    /**
     * W06 삼성 헬스 운동 요약 1건을 저장한다. 호출자(W06)가 회원 행 FOR SHARE와 {@link #lockForWrite(long)}를 먼저 잡은 트랜잭션에서 부른다. 일별 합은
     * 바꾸지 않으며 호출자가 모든 레코드를 저장한 뒤 {@link #recomputeDaily}로 갱신한다.
     *
     * @param affectedDates 일별 합을 다시 계산할 날짜를 더한다(이전·새 날짜)
     * @return 새로 저장했거나 값이 바뀌었으면 true(accepted), 같으면 false(duplicate)
     */
    @Transactional(propagation = Propagation.MANDATORY)
    public boolean saveSamsungExercise(
            long userId,
            String exerciseId,
            LocalDate metricDate,
            Instant startedAt,
            Instant endedAt,
            Map<Integer, Integer> histogram,
            Collection<LocalDate> affectedDates) {
        Optional<ZoneParams> params = repository.findZoneParams(userId, metricDate);
        Result result =
                params.map(p -> TrainingLoadCalculator.calculate(histogram, p.hrMax(), p.rhr()))
                        .orElseGet(() -> TrainingLoadCalculator.calculate(Map.of(), 1, 0));
        Optional<StoredLoad> previous = repository.findByExternalId(userId, exerciseId);
        if (previous.isPresent()) {
            StoredLoad p = previous.get();
            if (p.sameAs(startedAt, endedAt, metricDate, result)) {
                return false;
            }
            repository.update(p.id(), startedAt, endedAt, metricDate, result);
            affectedDates.add(p.metricDate());
        } else {
            repository.insert(
                    userId,
                    TrainingLoadJdbcRepository.SOURCE_SAMSUNG_HEALTH,
                    null,
                    exerciseId,
                    startedAt,
                    endedAt,
                    metricDate,
                    result);
        }
        affectedDates.add(metricDate);
        return true;
    }

    /** 같은 회원의 부하 쓰기를 한 줄로 세운다. 회원 행 FOR SHARE 다음, 일별 건강 행 쓰기 전에 잡는다. */
    @Transactional(propagation = Propagation.MANDATORY)
    public void lockForWrite(long userId) {
        repository.lockUserLoads(userId);
    }

    /** 날짜 오름차순으로 일별 부하를 다시 계산한다. @return 값이 바뀐 날짜(오름차순) */
    @Transactional(propagation = Propagation.MANDATORY)
    public List<LocalDate> recomputeDaily(long userId, Collection<LocalDate> dates) {
        List<LocalDate> changed = new ArrayList<>();
        for (LocalDate date : new TreeSet<>(dates)) {
            if (repository.recomputeDaily(userId, date)) {
                changed.add(date);
            }
        }
        return changed;
    }
}
