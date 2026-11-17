package com.runway.backend.domain.grouprun;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** S15P31E105-470: G03 myFit·comfortRange, G07 readinessScore. 최근 완료 세션과 최신 준비도만 근거로 쓴다. */
class GroupRunFitReadinessIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private JsonMapper mapper;

    private long hostId;
    private long memberId;
    private long outsiderId;
    private long crewId;

    @BeforeEach
    void seed() {
        hostId = insertUser("gr_fit_host", "호스트", "01055550001", "AGREE");
        memberId = insertUser("gr_fit_member", "멤버", "01055550002", "AGREE");
        outsiderId = insertUser("gr_fit_out", "미참가", "01055550003", "AGREE");
        crewId = insertCrew(hostId, "적합도 크루");
        approveMember(crewId, hostId);
        approveMember(crewId, memberId);
        approveMember(crewId, outsiderId);
    }

    @Test
    void detail_comfortRangeIsMinMaxOfParticipantRecentPaces_andMyFitIsCallerOnly()
            throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);
        // 호스트: 최근 2건 평균 310, 멤버: 360. 참가 전 요청자(outsider)는 comfortRange에 포함되지 않는다.
        insertCompleted(hostId, "300", 10);
        insertCompleted(hostId, "320", 20);
        insertCompleted(memberId, "360", 30);
        insertCompleted(outsiderId, "250", 40);
        insertReadiness(hostId, "2026-11-04", "70.00");
        insertReadiness(hostId, "2026-11-05", "82.40");

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(310);
        assertThat(host.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(360);
        assertThat(host.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(310);
        assertThat(host.get("myFit").get("readinessScore").asInt()).isEqualTo(82);

        JsonNode member = detail(groupRunId, memberId);
        assertThat(member.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(360);
        assertThat(member.get("myFit").get("readinessScore").isNull()).isTrue();

        // 참가 전 열람자도 자신의 페이스로 myFit을 받고, 범위는 참가자 기준 그대로다.
        JsonNode outsider = detail(groupRunId, outsiderId);
        assertThat(outsider.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(250);
        assertThat(outsider.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(310);
        assertThat(outsider.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(360);
    }

    @Test
    void recentPace_usesLatestFiveCompletedUndeletedSessionsWithPaceOnly() throws Exception {
        long groupRunId = createGroupRun();
        // 가장 오래된 900은 6번째라 제외. 삭제·미완료·페이스 없는 세션도 제외 → 평균 300.
        insertCompleted(hostId, "900", 60);
        for (int i = 1; i <= 5; i++) {
            insertCompleted(hostId, "300", i);
        }
        insertSession(hostId, "COMPLETED", "100", 0, true);
        insertSession(hostId, "CANCELLED", "100", 0, false);
        insertSession(hostId, "COMPLETED", null, 0, false);

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(300);
    }

    @Test
    void noCompletedSessions_usesProfilePaceForMyFitAndComfortRange() throws Exception {
        // S15P31E105-886: 유효 기록이 없으면 참가자 초기 설정(user_profiles.average_pace)을 그 사람 페이스로 쓴다.
        insertProfile(hostId, 300);
        insertProfile(memberId, 400);
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(300);
        assertThat(host.get("groupGuidePaceSecPerKm").asInt()).isEqualTo(350);
        assertThat(host.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(300);
        assertThat(host.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(400);
    }

    @Test
    void shortOrWalkSessionsOnly_fallBackToProfilePace() throws Exception {
        // S15P31E105-886 재현: 짧은 걷기·테스트 기록(1 km 미만 또는 이동 10분 미만)이 범위를 21'54"까지 벌렸다.
        insertProfile(hostId, 420);
        insertProfile(memberId, 380);
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);
        insertSession(hostId, "COMPLETED", "1314", 1, false, 500, 657); // 1 km 미만
        insertSession(hostId, "COMPLETED", "900", 2, false, 2000, 599); // 이동 10분 미만
        insertCompleted(memberId, "393", 1);

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(420);
        assertThat(host.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(393);
        assertThat(host.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(420);
    }

    @Test
    void validRecordsWin_overProfile_andShortRecordsAreIgnored() throws Exception {
        insertProfile(hostId, 420);
        long groupRunId = createGroupRun();
        insertCompleted(hostId, "360", 2);
        insertSession(hostId, "COMPLETED", "1314", 1, false, 999, 1800); // 최신이지만 1 km 미만
        insertSession(hostId, "COMPLETED", "300", 3, false, 1000, 600); // 경계값은 포함

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(330);
    }

    @Test
    void noRecordsAndNoProfile_participantExcluded() throws Exception {
        insertProfile(hostId, 300);
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);
        insertSession(memberId, "COMPLETED", "1314", 1, false, 500, 657);

        JsonNode member = detail(groupRunId, memberId);
        assertThat(member.get("myFit").isNull()).isTrue();
        // 참가자 페이스가 호스트 1명뿐이라 추천 공동 페이스±20 폴백.
        int guide = member.get("groupGuidePaceSecPerKm").asInt();
        assertThat(member.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(guide - 20);
        assertThat(member.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(guide + 20);
    }

    @Test
    void singleParticipantPace_fallsBackToGuidePaceSpread() throws Exception {
        insertProfile(hostId, 340);
        long groupRunId = createGroupRun();
        insertCompleted(hostId, "310", 1);

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.get("comfortRange").get("fastSecPerKm").asInt()).isEqualTo(320);
        assertThat(host.get("comfortRange").get("slowSecPerKm").asInt()).isEqualTo(360);
    }

    @Test
    void noPacesAndNoGuide_comfortRangeAndMyFitNull() throws Exception {
        long groupRunId = createGroupRun();

        JsonNode host = detail(groupRunId, hostId);
        assertThat(host.has("comfortRange")).isTrue();
        assertThat(host.get("comfortRange").isNull()).isTrue();
        assertThat(host.get("myFit").isNull()).isTrue();
    }

    @Test
    void participants_readinessScoreIsLatestPerUser_andSeparateFromReadyStatus() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);
        jdbc.update(
                "UPDATE group_run_participants SET ready = TRUE WHERE group_run_id=? AND user_id=?",
                groupRunId,
                hostId);
        // 호스트는 READY지만 준비도 없음, 멤버는 WAITING이지만 준비도 있음(최신 날짜 우선, 반올림).
        insertReadiness(memberId, "2026-11-03", "40.00");
        insertReadiness(memberId, "2026-11-05", "69.50");

        JsonNode body = participants(groupRunId, hostId);
        JsonNode items = body.get("items");
        JsonNode hostItem = byUser(items, hostId);
        JsonNode memberItem = byUser(items, memberId);
        assertThat(hostItem.get("readyStatus").asText()).isEqualTo("READY");
        assertThat(hostItem.get("readinessScore").isNull()).isTrue();
        assertThat(memberItem.get("readyStatus").asText()).isEqualTo("WAITING");
        assertThat(memberItem.get("readinessScore").asInt()).isEqualTo(70);
        // S15P31E105-499: session null 멤버도 대기방 인원에 포함하고 ready만 센다.
        assertThat(body.get("participantCount").asInt()).isEqualTo(2);
        assertThat(body.get("readyCount").asInt()).isEqualTo(1);
        assertThat(memberItem.get("sessionId").isNull()).isTrue();
    }

    @Test
    void participants_countsIncludeJoinOnlyRows_andIncreaseReadyAfterReadyTrue() throws Exception {
        long groupRunId = createGroupRun();
        join(groupRunId, memberId);

        JsonNode before = participants(groupRunId, hostId);
        assertThat(before.get("participantCount").asInt()).isEqualTo(2);
        assertThat(before.get("readyCount").asInt()).isEqualTo(0);
        assertThat(before.get("items")).hasSize(2);
        assertThat(byUser(before.get("items"), memberId).get("sessionId").isNull()).isTrue();

        jdbc.update(
                "UPDATE group_run_participants SET ready = TRUE WHERE group_run_id=? AND user_id=?",
                groupRunId,
                memberId);

        JsonNode after = participants(groupRunId, hostId);
        assertThat(after.get("participantCount").asInt()).isEqualTo(2);
        assertThat(after.get("readyCount").asInt()).isEqualTo(1);
    }

    @Test
    void readiness_isHiddenWithoutHealthConsent() throws Exception {
        long noConsent = insertUser("gr_fit_nc", "무동의", "01055550004", "DISAGREE");
        approveMember(crewId, noConsent);
        long groupRunId = createGroupRun();
        join(groupRunId, noConsent);
        insertReadiness(noConsent, "2026-11-05", "88.00");
        insertCompleted(noConsent, "330", 1);

        JsonNode item = byUser(participants(groupRunId, hostId).get("items"), noConsent);
        assertThat(item.get("readinessScore").isNull()).isTrue();
        JsonNode self = detail(groupRunId, noConsent);
        assertThat(self.get("myFit").get("recentPaceSecPerKm").asInt()).isEqualTo(330);
        assertThat(self.get("myFit").get("readinessScore").isNull()).isTrue();
    }

    // ---------------------------------------------------------------- helpers

    private JsonNode detail(long groupRunId, long userId) throws Exception {
        return mapper.readTree(
                mockMvc.perform(
                                get("/api/v1/group-runs/{id}", groupRunId)
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString());
    }

    private JsonNode participants(long groupRunId, long userId) throws Exception {
        return mapper.readTree(
                mockMvc.perform(
                                get("/api/v1/group-runs/{id}/participants", groupRunId)
                                        .header("Authorization", SecurityTestSupport.bearer(userId)))
                        .andExpect(status().isOk())
                        .andReturn()
                        .getResponse()
                        .getContentAsString());
    }

    private static JsonNode byUser(JsonNode items, long userId) {
        for (JsonNode item : items) {
            if (item.get("userId").asLong() == userId) {
                return item;
            }
        }
        throw new AssertionError("participant not found: " + userId);
    }

    private void join(long groupRunId, long userId) throws Exception {
        mockMvc.perform(
                        post("/api/v1/group-runs/{id}/join", groupRunId)
                                .header("Authorization", SecurityTestSupport.bearer(userId)))
                .andExpect(status().isOk());
    }

    private long createGroupRun() throws Exception {
        String body =
                """
                {
                  "title":"적합도 그룹런",
                  "crewId":%d,
                  "scheduledAt":"%s",
                  "meetingPosition":{"type":"Point","coordinates":[129.118,35.153]},
                  "meetingPlaceName":"집결지",
                  "targetDistanceM":5000,
                  "goalInputType":"TIME",
                  "targetDurationSec":1800
                }
                """
                        .formatted(crewId, GroupRunTestTimes.validScheduledAt());
        return mapper.readTree(
                        mockMvc.perform(
                                        post("/api/v1/group-runs")
                                                .header(
                                                        "Authorization",
                                                        SecurityTestSupport.bearer(hostId))
                                                .contentType(MediaType.APPLICATION_JSON)
                                                .content(body))
                                .andExpect(status().isCreated())
                                .andReturn()
                                .getResponse()
                                .getContentAsString())
                .get("id")
                .asLong();
    }

    /** daysAgo일 전에 끝난 완료 세션. 숫자가 작을수록 최근이다. */
    private void insertCompleted(long userId, String averagePace, int daysAgo) {
        insertSession(userId, "COMPLETED", averagePace, daysAgo, false);
    }

    private void insertSession(
            long userId, String status, String averagePace, int daysAgo, boolean deleted) {
        insertSession(userId, status, averagePace, daysAgo, deleted, 5000, 1800);
    }

    private void insertSession(
            long userId,
            String status,
            String averagePace,
            int daysAgo,
            boolean deleted,
            int distanceM,
            int movingSec) {
        Instant ended = Instant.now().minus(daysAgo, ChronoUnit.DAYS).truncatedTo(ChronoUnit.SECONDS);
        jdbc.update(
                """
                INSERT INTO running_sessions(user_id, status, started_at, ended_at,
                    total_distance, moving_duration, elapsed_duration, average_pace, deleted_at)
                VALUES (?, ?::running_sessions_status_enum, ?::timestamptz, ?::timestamptz,
                    ?, ?, ?, ?::numeric, ?::timestamptz)
                """,
                userId,
                status,
                ended.minusSeconds(movingSec).toString(),
                ended.toString(),
                distanceM,
                movingSec,
                movingSec,
                averagePace,
                deleted ? ended.toString() : null);
    }

    private void insertReadiness(long userId, String date, String score) {
        jdbc.update(
                """
                INSERT INTO daily_readiness(user_id, readiness_date, readiness_score)
                VALUES (?, ?::date, ?::numeric)
                """,
                userId,
                date,
                score);
    }

    private void insertProfile(long userId, int averagePaceSecPerKm) {
        jdbc.update(
                """
                INSERT INTO user_profiles(user_id, running_level, average_pace, distance, duraction)
                VALUES (?, 'INTERMEDIATE'::user_profiles_running_level_enum, ?, 5000, 1800)
                """,
                userId,
                averagePaceSecPerKm);
    }

    private long insertUser(String loginId, String nickname, String phone, String healthAccess) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, ?::users_health_data_access_enum)
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname,
                phone,
                healthAccess);
    }

    private long insertCrew(long ownerId, String name) {
        return jdbc.queryForObject(
                """
                INSERT INTO crews(owner_id, name, capacity, status)
                VALUES (?, ?, 20, 'ACTIVE'::crews_status_enum)
                RETURNING id
                """,
                Long.class,
                ownerId,
                name);
    }

    private void approveMember(long crewId, long userId) {
        jdbc.update(
                """
                INSERT INTO crew_memberships(crew_id, user_id, status, joined_at)
                VALUES (?, ?, 'APPROVED'::crew_memberships_status_enum, now())
                """,
                crewId,
                userId);
    }
}
