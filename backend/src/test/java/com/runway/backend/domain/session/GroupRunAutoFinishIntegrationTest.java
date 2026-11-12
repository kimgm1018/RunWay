package com.runway.backend.domain.session;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.grouprun.service.GroupRunAutoFinisher;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.CyclicBarrier;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;

/** 참가자 전원이 개인 종료하면 그룹런 자동 종료(S15P31E105-734, group-runs.md "그룹 자동 처리와 전달"). */
class GroupRunAutoFinishIntegrationTest extends RunningSessionIntegrationSupport {
    private static final String ENDED = "2026-10-28T01:30:00Z";

    @Autowired GroupRunAutoFinisher finisher;

    private long running(long owner, long watch, long phone) {
        long sessionId = insertSession(owner, "RUNNING", 4, watch, phone, "PENDING", null);
        jdbc.update(
                "UPDATE running_sessions SET started_at = TIMESTAMPTZ '2026-10-28T01:00:00Z' WHERE id=?",
                sessionId);
        return sessionId;
    }

    /** S06 END 승인과 APPLIED 결과까지 실제 API로 보낸다. */
    private void finish(long owner, long watch, long sessionId) throws Exception {
        String json =
                mockMvc.perform(postControl(owner, sessionId, "finish", requestBody(watch, 4)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        long commandId = Long.parseLong(json.replaceAll(".*\"commandId\":([0-9]+).*", "$1"));
        String applied =
                resultBody(commandId, watch, "APPLIED", ENDED)
                        .replace("}", ",\"uploadComplete\":true}");
        mockMvc.perform(postControl(owner, sessionId, "finish", applied)).andExpect(status().isOk());
    }

    private String groupStatus(long groupRunId) {
        return jdbc.queryForObject(
                "SELECT status::text FROM group_runs WHERE id=?", String.class, groupRunId);
    }

    private boolean groupEnded(long groupRunId) {
        return jdbc.queryForObject(
                "SELECT ended_at IS NOT NULL FROM group_runs WHERE id=?", Boolean.class, groupRunId);
    }

    @Test
    void singleParticipantEnd_completesTheGroup() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long session = running(userId, watchId, phoneId);
        joinGroup(group, userId, session);

        finish(userId, watchId, session);

        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
        assertThat(groupEnded(group)).isTrue();
    }

    @Test
    void twoParticipants_groupWaitsForTheSecondEnd() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long mine = running(userId, watchId, phoneId);
        long theirs = running(otherUserId, otherWatchId, otherPhoneId);
        joinGroup(group, userId, mine);
        joinGroup(group, otherUserId, theirs);

        finish(userId, watchId, mine);
        assertThat(groupStatus(group)).isEqualTo("RUNNING");

        finish(otherUserId, otherWatchId, theirs);
        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void concurrentLastChecks_completeExactlyOnce() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        for (long owner : List.of(userId, otherUserId)) {
            long session = insertSession(owner, "COMPLETED", 5, null, null, "PENDING", null);
            joinGroup(group, owner, session);
        }
        var barrier = new CyclicBarrier(4);
        List<Future<Boolean>> results = new ArrayList<>();
        try (var pool = Executors.newFixedThreadPool(4)) {
            for (int i = 0; i < 4; i++) {
                results.add(
                        pool.submit(
                                () -> {
                                    barrier.await();
                                    return finisher.tryComplete(group);
                                }));
            }
            long completed = 0;
            for (var result : results) completed += result.get() ? 1 : 0;
            assertThat(completed).isEqualTo(1);
        }
        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void unsettledStart_holdsTheGroupUntilItIsAbortedOrRejected() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long mine = running(userId, watchId, phoneId);
        long waiting = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        insertCommand(waiting, otherWatchId, "START", 1, "PENDING");
        joinGroup(group, userId, mine);
        joinGroup(group, otherUserId, waiting);

        finish(userId, watchId, mine);
        assertThat(groupStatus(group)).isEqualTo("RUNNING");

        // S08 시작 미확인 중단과 같은 결과(세션 INTERRUPTED, START는 UNKNOWN으로 남음)면 더는 막지 않는다.
        jdbc.update(
                "UPDATE running_sessions SET status='INTERRUPTED' WHERE id=?", waiting);
        jdbc.update(
                "UPDATE session_control_events SET result='UNKNOWN' WHERE session_id=?", waiting);
        assertThat(finisher.tryComplete(group)).isTrue();
        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void rejectedStartReport_triggersTheCheck() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long ended = insertSession(userId, "COMPLETED", 5, null, null, "PENDING", null);
        long waiting = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        long start = insertCommand(waiting, otherWatchId, "START", 1, "PENDING");
        joinGroup(group, userId, ended);
        joinGroup(group, otherUserId, waiting);
        assertThat(groupStatus(group)).isEqualTo("RUNNING");

        mockMvc.perform(
                        postControl(
                                otherUserId,
                                waiting,
                                "start",
                                resultBody(start, otherWatchId, "REJECTED", null)))
                .andExpect(status().isOk());

        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void s08AbortOfTheLastUnconfirmedStart_completesTheGroup() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long ended = insertSession(userId, "COMPLETED", 5, null, null, "PENDING", null);
        long waiting = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        insertCommand(waiting, otherWatchId, "START", 1, "PENDING");
        joinGroup(group, userId, ended);
        joinGroup(group, otherUserId, waiting);

        mockMvc.perform(
                        patchRequest(
                                otherUserId,
                                waiting,
                                "{\"operation\":\"ABORT_UNCONFIRMED_START\",\"deviceId\":"
                                        + otherPhoneId
                                        + ",\"expectedVersion\":1}"))
                .andExpect(status().isOk());

        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void twoEndsReportedAtTheSameTime_completeTheGroupOnce() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long mine = running(userId, watchId, phoneId);
        long theirs = running(otherUserId, otherWatchId, otherPhoneId);
        joinGroup(group, userId, mine);
        joinGroup(group, otherUserId, theirs);
        long myEnd = approveEnd(userId, watchId, mine);
        long theirEnd = approveEnd(otherUserId, otherWatchId, theirs);
        var barrier = new CyclicBarrier(2);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(() -> { barrier.await(); return reportEnd(userId, watchId, mine, myEnd); });
            var b = pool.submit(() -> { barrier.await(); return reportEnd(otherUserId, otherWatchId, theirs, theirEnd); });
            assertThat(List.of(a.get(), b.get())).containsOnly(200);
        }
        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    private long approveEnd(long owner, long watch, long sessionId) throws Exception {
        String json =
                mockMvc.perform(postControl(owner, sessionId, "finish", requestBody(watch, 4)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString();
        return Long.parseLong(json.replaceAll(".*\"commandId\":([0-9]+).*", "$1"));
    }

    private int reportEnd(long owner, long watch, long sessionId, long commandId) throws Exception {
        String applied =
                resultBody(commandId, watch, "APPLIED", ENDED).replace("}", ",\"uploadComplete\":true}");
        return mockMvc.perform(postControl(owner, sessionId, "finish", applied))
                .andReturn()
                .getResponse()
                .getStatus();
    }

    @Test
    void cancellingAReadiedGroupSession_isTreatedAsSettled() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long ended = insertSession(userId, "COMPLETED", 5, null, null, "PENDING", null);
        long waiting = insertSession(otherUserId, "READY", 1, otherWatchId, otherPhoneId, "PENDING", null);
        // A START that the watch reported UNKNOWN after the control device changed: it does not block S07.
        insertCommand(waiting, otherPhoneId, "START", 1, "UNKNOWN");
        joinGroup(group, userId, ended);
        joinGroup(group, otherUserId, waiting);
        assertThat(finisher.tryComplete(group)).isFalse();

        mockMvc.perform(cancelRequest(otherUserId, waiting)).andExpect(status().isOk());

        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void alreadyForceFinished_isLeftAsIs() {
        long group = insertGroupRun("COMPLETED", true);
        long session = insertSession(userId, "COMPLETED", 5, null, null, "PENDING", null);
        joinGroup(group, userId, session);

        assertThat(finisher.tryComplete(group)).isFalse();
        assertThat(
                        jdbc.queryForObject(
                                "SELECT ended_at = TIMESTAMPTZ '2026-10-29T01:00:00Z' FROM group_runs WHERE id=?",
                                Boolean.class,
                                group))
                .isTrue();
    }

    @Test
    void participantsWhoNeverStarted_areNotWaitedFor() throws Exception {
        long group = insertGroupRun("RUNNING", false);
        long mine = running(userId, watchId, phoneId);
        joinGroup(group, userId, mine);
        // Joined but never readied (no session), and readied without any START: neither holds the group.
        jdbc.update(
                "INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES (?,?,NULL)",
                group,
                otherUserId);
        long third = insertUser("AGREE");
        long idle = insertSession(third, "READY", 1, null, null, "PENDING", null);
        joinGroup(group, third, idle);

        finish(userId, watchId, mine);

        assertThat(groupStatus(group)).isEqualTo("COMPLETED");
    }

    @Test
    void nobodyStarted_isNotCompletedAutomatically() {
        long group = insertGroupRun("RUNNING", false);
        long idle = insertSession(userId, "READY", 1, null, null, "PENDING", null);
        joinGroup(group, userId, idle);

        assertThat(finisher.tryComplete(group)).isFalse();
        assertThat(groupStatus(group)).isEqualTo("RUNNING");
    }
}
