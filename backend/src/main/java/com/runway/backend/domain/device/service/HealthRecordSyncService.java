package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.DailyHrEstimate;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.ParsedRecord;
import com.runway.backend.domain.device.dto.request.HealthRecordSyncRequest.Rejected;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse;
import com.runway.backend.domain.device.dto.response.HealthRecordSyncResponse.RecordError;
import com.runway.backend.domain.device.event.DailyHealthMetricsChangedEvent;
import com.runway.backend.domain.device.repository.HealthRecordJdbcRepository;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.TreeSet;
import lombok.RequiredArgsConstructor;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * W06 Samsung Health 데이터 동기화(devices-health.md W06). 현재 지원 레코드는 RunWay 워치 일상 심박 하루 추정값 하나다.
 *
 * <p>검사 순서: 회원 행 FOR SHARE(활성 회원·건강 동의) → 유효 레코드를 날짜 오름차순(같은 날짜는 요청 순서)으로 조건부 upsert → 변경 날짜 이벤트 발행. 동의가 없으면
 * 아무것도 저장하지 않는다. 거절 레코드는 파싱 단계에서 이미 판정됐고 저장하지 않는다.
 *
 * <p>유효 레코드는 한 트랜잭션으로 저장한다. 어느 쓰기든 실패하면 모두 롤백되고 이벤트도 구독자에게 전달되지 않는다. 같은 요청을 다시 보내면 조건부
 * upsert라 같은 최종 상태가 된다.
 */
@Service
@RequiredArgsConstructor
public class HealthRecordSyncService {

    private final HealthRecordJdbcRepository repository;
    private final ApplicationEventPublisher events;

    @Transactional
    public HealthRecordSyncResponse sync(long userId, HealthRecordSyncRequest request) {
        boolean consented =
                repository
                        .lockActiveUserConsent(userId)
                        .orElseThrow(HealthRecordSyncErrors::unauthorized);
        if (!consented) {
            throw HealthRecordSyncErrors.consentRequired();
        }

        int accepted = 0;
        int duplicate = 0;
        List<RecordError> errors = new ArrayList<>();
        TreeSet<LocalDate> changed = new TreeSet<>();
        // 날짜 오름차순(같은 날짜는 요청 순서 유지)으로 저장해 같은 회원의 동시 요청이 행 잠금을 같은 순서로 잡게 한다. 요청마다 순서가 다르면
        // 서로의 날짜 행을 기다리는 교착(40P01)이 생긴다. 응답 errors의 index는 요청 위치 그대로다.
        for (ParsedRecord record : inLockOrder(request.records())) {
            switch (record) {
                case Rejected rejected -> errors.add(rejected.error());
                case DailyHrEstimate estimate -> {
                    if (repository.upsertRestingHr(
                            userId,
                            estimate.metricDate(),
                            estimate.restingHrBpm(),
                            estimate.revision())) {
                        accepted++;
                        changed.add(estimate.metricDate());
                    } else {
                        duplicate++;
                    }
                }
            }
        }
        if (!changed.isEmpty()) {
            events.publishEvent(new DailyHealthMetricsChangedEvent(userId, List.copyOf(changed)));
        }
        errors.sort(Comparator.comparingInt(RecordError::index));
        return new HealthRecordSyncResponse(accepted, duplicate, errors.size(), List.copyOf(errors));
    }

    /** 유효 레코드는 날짜 오름차순으로 안정 정렬하고 거절 레코드는 앞에 둔다(저장하지 않으므로 순서 무관). */
    private static List<ParsedRecord> inLockOrder(List<ParsedRecord> records) {
        List<ParsedRecord> ordered = new ArrayList<>(records);
        ordered.sort(
                Comparator.comparing(
                        r -> r instanceof DailyHrEstimate e ? e.metricDate() : LocalDate.MIN));
        return ordered;
    }
}
