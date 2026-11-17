package com.runway.backend.domain.grouprun.service;

import com.runway.backend.domain.grouprun.repository.GroupRunJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import com.runway.backend.domain.grouprun.repository.GroupRunParticipantRow;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.domain.session.service.GroupParticipantSettledEvent;
import com.runway.backend.domain.session.service.PersonalSessionEndedEvent;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;
import org.springframework.transaction.support.TransactionTemplate;

import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Comparator;

/**
 * 참가자 전원이 개인 종료하면 그룹런을 자동 종료한다(group-runs.md "그룹 자동 처리와 전달", S15P31E105-734).
 *
 * <p>개인 END 확정·그룹 START 거절·S08 시작 미확인 중단이 커밋된 뒤 새 트랜잭션에서 G09/G12와 같은 그룹 행 잠금을 잡고 다시 판단한다. 실제
 * 시작한 참가자가 있고 진행·일시정지 중인 세션이 없으면 RUNNING을 COMPLETED로 바꾸고 미확정 START를 중단한다.
 * 동시에 끝난 두 참가자의 처리와 G12는 그룹 행 잠금과 조건부 UPDATE(status = RUNNING)로 한 번만 반영된다. 실패는 개인 종료 응답에
 * 영향을 주지 않도록 로그만 남긴다(호스트는 G12로 끝낼 수 있다).
 */
@Slf4j
@Component
public class GroupRunAutoFinisher {
    private final SessionReferenceRepository references;
    private final GroupRunJdbcRepository groups;
    private final GroupRunParticipantJdbcRepository participants;
    private final RunningSessionControlService controls;
    private final TransactionTemplate tx;

    public GroupRunAutoFinisher(
            SessionReferenceRepository references,
            GroupRunJdbcRepository groups,
            GroupRunParticipantJdbcRepository participants,
            RunningSessionControlService controls,
            PlatformTransactionManager manager) {
        this.references = references;
        this.groups = groups;
        this.participants = participants;
        this.controls = controls;
        this.tx = new TransactionTemplate(manager);
        // The publishing transaction has already committed; this work needs its own.
        this.tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onPersonalSessionEnded(PersonalSessionEndedEvent event) {
        if (event.groupRunId() != null) {
            attempt(event.groupRunId());
        }
    }

    @TransactionalEventListener(phase = TransactionPhase.AFTER_COMMIT)
    public void onParticipantSettled(GroupParticipantSettledEvent event) {
        attempt(event.groupRunId());
    }

    private void attempt(long groupRunId) {
        try {
            tryComplete(groupRunId);
        } catch (RuntimeException e) {
            log.warn("그룹런 자동 종료 확인 실패 groupRunId={}", groupRunId, e);
        }
    }

    /** 종료했으면 true. 이미 종료됐거나 아직 끝나지 않은 참가자가 있으면 false. */
    public boolean tryComplete(long groupRunId) {
        return Boolean.TRUE.equals(
                tx.execute(
                        status -> {
                            var state = references.lockGroupRun(groupRunId).orElse(null);
                            if (state == null || !"RUNNING".equals(state.status())) {
                                return false;
                            }
                            var counts = groups.completionCounts(groupRunId);
                            // 막 승인된 미확정 START(2분 이내, 예: 지금 합류 직후)는 기다린다. 그 START의 결과·종료가 다시 판단을 부른다.
                            if (counts.started() == 0
                                    || counts.running() > 0
                                    || counts.unsettledFresh() > 0) {
                                return false;
                            }
                            Instant endedAt = Instant.now().truncatedTo(ChronoUnit.MICROS);
                            if (groups.markCompleted(groupRunId, endedAt) != 1) {
                                return false;
                            }
                            if (counts.unsettled() > 0) {
                                participants.findByGroupRunId(groupRunId).stream()
                                        .filter(p -> p.sessionId() != null)
                                        .sorted(Comparator.comparingLong(GroupRunParticipantRow::sessionId))
                                        .forEach(p -> controls.forceFinishGroupParticipant(p.sessionId(), true));
                            }
                            return true;
                        }));
    }
}
