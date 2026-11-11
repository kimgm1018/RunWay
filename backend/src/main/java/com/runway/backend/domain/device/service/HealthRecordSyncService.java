package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.DailyHrEstimate;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.DailySleepSummary;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.ExerciseHrSummary;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.ParsedRecord;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.Rejected;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.SamsungRestingHr;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse.RecordError;
import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import com.runway.backend.domain.device.repository.HealthRecordJdbcRepository;
import com.runway.backend.domain.readiness.trainingload.TrainingLoadService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * W06 Samsung Health 데이터 동기화(devices-health.md W06). 지원 레코드는 RunWay 워치 일상 심박 하루 추정값, 삼성 헬스 기상일별
 * 수면 합계(S15P31E105-572)와 삼성 헬스 심박으로 폰이 계산한 안정 심박(S15P31E105-600)이다. 같은 날짜의 안정 심박은 워치 값이
 * 우선한다.
 *
 * <p>검사 순서: 회원 행 FOR SHARE(활성 회원·건강 동의) → 유효 레코드를 날짜 오름차순(같은 날짜는 요청 순서)으로 조건부 upsert → 변경 날짜 이벤트
 * 발행. 동의가 없으면 아무것도 저장하지 않는다. 거절 레코드는 파싱 단계에서 이미 판정됐고 저장하지 않는다.
 *
 * <p>유효 레코드는 한 트랜잭션으로 저장한다. 어느 쓰기든 실패하면 모두 롤백되고 이벤트도 구독자에게 전달되지 않는다. 같은 요청을 다시 보내면 조건부 upsert라 같은
 * 최종 상태가 된다.
 */
@Service
@RequiredArgsConstructor
public class HealthRecordSyncService {

    private final HealthRecordJdbcRepository repository;
    private final ApplicationEventPublisher events;
    private final TrainingLoadService trainingLoads;

    @Transactional
    public HealthRecordSyncResponse sync(long userId, HealthRecordSyncRequest request) {
        boolean consented =
                repository
                        .lockActiveUserConsent(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        if (!consented) {
            throw new ApiException(ErrorCode.CONSENT_REQUIRED);
        }

        int accepted = 0;
        int duplicate = 0;
        List<RecordError> errors = new ArrayList<>();
        TreeSet<LocalDate> changed = new TreeSet<>();
        TreeSet<LocalDate> loadAffected = new TreeSet<>();
        // S15P31E105-599: 운동 요약이 있으면 일별 행을 쓰기 전에 부하 잠금을 잡는다(회원 FOR SHARE → 부하 잠금 → 일별 행). 러닝 부하 저장과
        // 같은 순서라 서로의 일별 행·잠금을 엇갈려 기다리지 않는다. 운동 요약은 일별 행을 쓰지 않으므로 먼저 저장해 일별 부하를 다시 계산할 날짜를
        // 모은다.
        if (request.records().stream().anyMatch(r -> r instanceof ExerciseHrSummary)) {
            trainingLoads.lockForWrite(userId);
        }
        TreeMap<LocalDate, List<ParsedRecord>> byDate = new TreeMap<>();
        for (ParsedRecord record : request.records()) {
            switch (record) {
                case Rejected rejected -> errors.add(rejected.error());
                case ExerciseHrSummary exercise -> {
                    if (trainingLoads.saveSamsungExercise(
                            userId,
                            exercise.exerciseId(),
                            exercise.metricDate(),
                            exercise.startedAt(),
                            exercise.endedAt(),
                            exercise.heartRateSeconds(),
                            loadAffected)) {
                        accepted++;
                    } else {
                        duplicate++;
                    }
                }
                default -> byDate.computeIfAbsent(record.lockDate(), d -> new ArrayList<>()).add(record);
            }
        }
        for (LocalDate date : loadAffected) {
            byDate.computeIfAbsent(date, d -> new ArrayList<>());
        }
        // 일별 행은 날짜 오름차순(같은 날짜는 요청 순서 유지, 그 날짜 부하 재계산은 마지막)으로 쓴다. 같은 회원의 동시 요청이 행 잠금을 같은 순서로
        // 잡게 하기 위해서다. 요청마다 순서가 다르면 서로의 날짜 행을 기다리는 교착(40P01)이 생긴다. 응답 errors의 index는 요청 위치 그대로다.
        List<LocalDate> loadChanged = new ArrayList<>();
        for (Map.Entry<LocalDate, List<ParsedRecord>> entry : byDate.entrySet()) {
            for (ParsedRecord record : entry.getValue()) {
                boolean stored =
                        switch (record) {
                            case DailyHrEstimate estimate ->
                                    repository.upsertRestingHr(
                                            userId,
                                            estimate.metricDate(),
                                            estimate.restingHrBpm(),
                                            estimate.revision());
                            case SamsungRestingHr restingHr ->
                                    repository.upsertSamsungRestingHr(
                                            userId, restingHr.metricDate(), restingHr.restingHrBpm());
                            case DailySleepSummary sleep ->
                                    repository.upsertSleep(
                                            userId, sleep.metricDate(), sleep.sleepDurationMin());
                            default -> throw new IllegalStateException("unexpected record");
                        };
                if (stored) {
                    accepted++;
                    changed.add(entry.getKey());
                } else {
                    duplicate++;
                }
            }
            // 운동 요약이 바꾼 날짜의 일별 부하를 다시 계산한다(RunWay 러닝과 겹치는 운동 제외).
            if (loadAffected.contains(entry.getKey())
                    && !trainingLoads.recomputeDaily(userId, List.of(entry.getKey())).isEmpty()) {
                loadChanged.add(entry.getKey());
            }
        }
        changed.addAll(loadChanged);
        if (!changed.isEmpty()) {
            events.publishEvent(
                    new DailyHealthMetricsChangedEvent(
                            userId, List.copyOf(changed), List.copyOf(loadChanged)));
        }
        errors.sort(Comparator.comparingInt(RecordError::index));
        return new HealthRecordSyncResponse(
                accepted, duplicate, errors.size(), List.copyOf(errors));
    }
}
