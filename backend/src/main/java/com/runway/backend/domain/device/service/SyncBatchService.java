package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.request.SyncBatchRequest;
import com.runway.backend.domain.device.dto.request.SyncBatchRequest.GpsPoint;
import com.runway.backend.domain.device.dto.request.SyncBatchRequest.MetricSample;
import com.runway.backend.domain.device.dto.response.SyncBatchAckResponse;
import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.device.repository.SyncBatchJdbcRepository;
import com.runway.backend.domain.device.repository.SyncBatchJdbcRepository.DeviceRef;
import com.runway.backend.domain.device.repository.SyncBatchJdbcRepository.SessionRef;
import com.runway.backend.domain.device.repository.SyncBatchJdbcRepository.StoredBatch;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * W07 워치 운동 배치 저장(devices-health.md W07). 검사 순서는 회원 → 세션 잠금 → 기기 잠금 → 건강 동의 → 기존 batch → 신규 조건이다.
 *
 * <p>잠금 순서: 세션(FOR NO KEY UPDATE) → 기기(FOR SHARE). 세션 서비스의 세션 → 기기 순서와 같고, W03 해제는 기기 행만 갱신하므로 교차 대기가
 * 없다. 회원 행은 잠그지 않는다(로그인과의 간섭 방지). 같은 세션의 종료·인계와는 세션 행 잠금으로 한 번에 하나씩 처리된다.
 *
 * <p>W04 동의 철회는 회원 행 UPDATE → 본인 진행 가능 세션 FOR SHARE 순서로 잠가 이 저장과 순서를 정한다. 세션 행을 잡은 이 트랜잭션에서 회원
 * 행을 잠그면(FOR SHARE 포함) 철회와 교착하므로 동의는 잠그지 않고 읽는다.
 *
 * <p>건강 동의는 기존 batch 재응답보다 먼저 검사한다(계약 "권한·동의를 먼저 검사"). 저장 후 응답이 유실된 뒤 동의를 철회하면 같은 batch 재전송도
 * 403이다.
 *
 * <p>batch 기록과 원본 행은 한 트랜잭션으로 저장한다. 어느 단계든 실패하면 모두 롤백되어 부분 원본이나 COMMITTED가 남지 않는다.
 */
@Service
@RequiredArgsConstructor
public class SyncBatchService {

    private static final String COMMITTED = "COMMITTED";

    private final SyncBatchJdbcRepository repository;

    /** hash는 {@link BatchPayloadHasher#verify}로 확인한 본문 해시다. 트랜잭션 전에 검증해 잘못된 요청이 DB 잠금을 잡지 않게 한다. */
    @Transactional
    public SyncBatchAckResponse commit(long userId, SyncBatchRequest request, String hash) {
        repository.findActiveUser(userId).orElseThrow(SyncBatchErrors::unauthorized);
        SessionRef session =
                repository
                        .lockOwnedSession(request.sessionId(), userId)
                        .orElseThrow(SyncBatchErrors::sessionForbidden);
        DeviceRef device =
                repository
                        .lockOwnedDevice(request.deviceId(), userId)
                        .orElseThrow(SyncBatchErrors::deviceForbidden);
        // 동의는 잠금을 얻은 뒤 다시 읽는다(READ COMMITTED의 새 문장). 세션 잠금을 기다리는 동안 커밋된 철회·탈퇴를 반영해, 철회 직전 값으로
        // 판정되는 구간을 이 조회 이후 커밋까지로 줄인다.
        boolean healthConsented =
                repository
                        .findActiveUser(userId)
                        .orElseThrow(SyncBatchErrors::unauthorized)
                        .healthConsented();
        // D-2: 위치 동의는 가입 필수다. 건강정보 미동의면 측정 샘플이 있는 batch 전체를 거절하고 GPS만 있는 batch는 받는다.
        if (!healthConsented && request.hasMetricSample()) {
            throw SyncBatchErrors.consentRequired();
        }

        // 이미 저장된 batch는 기기 해제·세션 종료·폰 인계 뒤에도 내용이 같으면 기존 ACK를 다시 준다(D-3).
        StoredBatch stored =
                repository.findBatch(request.deviceId(), request.clientBatchId()).orElse(null);
        if (stored != null) {
            return replay(stored, request, hash);
        }

        requireNewBatchAllowed(request, session, device);
        boolean inserted =
                repository.insertCommitted(
                        request.clientBatchId(),
                        request.deviceId(),
                        request.sessionId(),
                        request.schemaVersion(),
                        hash);
        if (!inserted) {
            // 다른 세션으로 같은 ID를 동시에 저장한 요청이 먼저 커밋됐다. DO NOTHING을 성공으로 보지 않고 내용을 비교한다.
            StoredBatch winner =
                    repository
                            .findBatch(request.deviceId(), request.clientBatchId())
                            .orElseThrow(SyncBatchErrors::hashConflict);
            return replay(winner, request, hash);
        }
        repository.insertMetricSamples(
                request.sessionId(), request.deviceId(), itemsOf(request, MetricSample.class));
        repository.insertRoutePoints(
                request.sessionId(), request.deviceId(), itemsOf(request, GpsPoint.class));
        return ack(request);
    }

    /** 신규 batch 조건: 연결 중 기기, 세션의 제어/중계 기기, 원본을 받는 세션 상태. */
    private void requireNewBatchAllowed(
            SyncBatchRequest request, SessionRef session, DeviceRef device) {
        if (!device.linked()) {
            throw SyncBatchErrors.deviceForbidden();
        }
        long deviceId = request.deviceId();
        boolean sessionDevice =
                Objects.equals(session.controlDeviceId(), deviceId)
                        || Objects.equals(session.relayDeviceId(), deviceId);
        if (!sessionDevice) {
            // D-5: 폰 인계 뒤 이 세션을 제어하던 워치의 새 batch는 제어 기기 변경으로 거절한다.
            if (session.phoneFallback()
                    && DeviceType.WATCH.name().equals(device.deviceType())
                    && repository.controlledSession(request.sessionId(), deviceId)) {
                throw SyncBatchErrors.controlDeviceChanged();
            }
            throw SyncBatchErrors.sessionForbidden();
        }
        if (!acceptsNewBatch(request.sessionId(), session)) {
            throw SyncBatchErrors.invalidSessionState();
        }
    }

    /**
     * RUNNING·PAUSED는 END 확정 전이므로 받는다. READY는 START를 승인받아 결과를 기다리거나 확인하지 못한 경우에만 받는다(D-1, 워치가 이미 측정을
     * 시작했을 수 있다). COMPLETED·CANCELLED·INTERRUPTED와 기존 기록(state_version=0)은 받지 않는다.
     *
     * <p>W04 동의 철회는 이 조건(새 batch는 READY·RUNNING·PAUSED에만, 종료 상태는 되돌아가지 않음)을 전제로 진행 가능 세션만 잠근다. 받는 상태를
     * 넓히거나 종료 상태에서 돌아가는 전이를 추가하면 ConsentJdbcRepository.lockOwnActiveSessions도 함께 바꾼다.
     */
    private boolean acceptsNewBatch(long sessionId, SessionRef session) {
        if (session.stateVersion() < 1) {
            return false;
        }
        return switch (session.status()) {
            case "RUNNING", "PAUSED" -> true;
            case "READY" -> repository.hasUnconfirmedStart(sessionId);
            default -> false;
        };
    }

    private static SyncBatchAckResponse replay(
            StoredBatch stored, SyncBatchRequest request, String hash) {
        boolean same =
                COMMITTED.equals(stored.status())
                        && Objects.equals(stored.sessionId(), request.sessionId())
                        && request.schemaVersion().equals(stored.payloadVersion())
                        && hash.equals(stored.payloadHash());
        if (!same) {
            throw SyncBatchErrors.hashConflict();
        }
        return ack(request);
    }

    private static SyncBatchAckResponse ack(SyncBatchRequest request) {
        return new SyncBatchAckResponse(COMMITTED, request.id(), request.items().size());
    }

    private static <T> List<T> itemsOf(SyncBatchRequest request, Class<T> type) {
        return request.items().stream().filter(type::isInstance).map(type::cast).toList();
    }
}
