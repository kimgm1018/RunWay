package com.runway.backend.domain.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.service.RetiredLoginId;
import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.image.WithdrawnImageCleanup;
import com.runway.backend.domain.user.repository.WithdrawalRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.security.SecurityTestSupport;
import java.nio.file.Path;
import java.util.concurrent.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

class WithdrawalApiIntegrationTest extends RefreshIntegrationSupport {
    @TempDir static Path volume;
    @DynamicPropertySource
    static void images(DynamicPropertyRegistry registry) {
        registry.add("runway.images.volume-path", volume::toString);
    }
    @Autowired ImageService images;
    @MockitoSpyBean com.runway.backend.domain.session.service.RecordComparisonService comparisons;
    @Autowired com.runway.backend.domain.session.service.RunningSessionService runningSessions;
    @Autowired com.runway.backend.domain.session.service.SessionStreamQuery streamQuery;
    @Autowired com.runway.backend.domain.session.repository.RunningSessionRepository sessionRepository;
    @MockitoSpyBean com.runway.backend.domain.session.repository.SessionAnalysisRepository analysis;
    @MockitoSpyBean com.runway.backend.domain.user.repository.FollowRepository followRepository;
    @Autowired com.runway.backend.domain.user.service.FollowService follows;
    @Autowired com.runway.backend.domain.auth.repository.SignupRepository signup;
    @Autowired com.runway.backend.domain.crew.service.CrewService crews;
    @Autowired com.runway.backend.domain.grouprun.service.GroupRunService groups;
    @Autowired PlatformTransactionManager transactionManager;
    @MockitoSpyBean WithdrawnImageCleanup cleanup;
    @MockitoSpyBean WithdrawalRepository withdrawalRepository;
    @MockitoSpyBean com.runway.backend.domain.auth.repository.RefreshTokenStore tokenStore;

    @BeforeEach
    @Override void seedAuth() {
        jdbc.execute("TRUNCATE users CASCADE");
        super.seedAuth();
    }

    String auth() { return SecurityTestSupport.bearer(user); }
    ResultActions withdraw() throws Exception { return withdraw("Runner9!",true); }
    ResultActions withdraw(String password,boolean agreed) throws Exception {
        return mvc.perform(delete("/api/v1/users/me").header("Authorization",auth())
                .contentType(MediaType.APPLICATION_JSON)
                .content(mapper.writeValueAsString(java.util.Map.of("password",password,"agreed",agreed))));
    }
    String state() { return jdbc.queryForObject("SELECT account_status::text FROM users WHERE id=?",String.class,user); }
    long session(String status) {
        return jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,analysis_status) VALUES (?,?::running_sessions_status_enum,'READY') RETURNING id",Long.class,user,status);
    }
    long other() {
        return jdbc.queryForObject("INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access) VALUES ('other','synthetic','다른회원','2000-01-01','MALE','01000000001','DISAGREE') RETURNING id",Long.class);
    }
    long crew(long owner) {
        long id=jdbc.queryForObject("INSERT INTO crews(owner_id,name,capacity) VALUES (?,'테스트크루',20) RETURNING id",Long.class,owner);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())",id,owner);
        return id;
    }
    long group(long crew,long host,String status) {
        return jdbc.queryForObject("INSERT INTO group_runs(crew_id,host_id,title,scheduled_at,status) VALUES (?,?,'테스트그룹',now()+interval '1 day',?::group_runs_status_enum) RETURNING id",Long.class,crew,host,status);
    }

    @Test void emptySummaryIsReadOnlyAndNoStore() throws Exception {
        mvc.perform(get("/api/v1/users/me/withdrawal-summary").header("Authorization",auth()))
            .andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store"))
            .andExpect(jsonPath("$.runningRecordCount").value(0)).andExpect(jsonPath("$.blockers").isEmpty());
        assertThat(state()).isEqualTo("ACTIVE");
    }
    @Test void anonymousCannotSummarizeOrWithdraw() throws Exception {
        mvc.perform(get("/api/v1/users/me/withdrawal-summary")).andExpect(status().isUnauthorized());
        mvc.perform(delete("/api/v1/users/me").contentType(MediaType.APPLICATION_JSON)
            .content("{\"password\":\"Runner9!\",\"agreed\":true}")).andExpect(status().isUnauthorized());
    }
    @Test void invalidCredentialsAndAgreementDoNotMutate() throws Exception {
        withdraw("Wrong99!",true).andExpect(status().isUnauthorized()).andExpect(jsonPath("$.code").value("INVALID_PASSWORD"));
        withdraw("Runner9!",false).andExpect(status().isUnprocessableContent());
        for (String body : new String[]{"{}","{\"password\":1,\"agreed\":true}","{\"password\":\"Runner9!\",\"agreed\":\"true\"}"})
            mvc.perform(delete("/api/v1/users/me").header("Authorization",auth()).contentType(MediaType.APPLICATION_JSON).content(body)).andExpect(status().isBadRequest());
        assertThat(state()).isEqualTo("ACTIVE");
    }
    // S15P31E105-831: 실제 U18 탈퇴는 소문자 저장 아이디의 해시로 예약하고 대소문자만 다른 재가입·U16도 막는다.
    @Test void withdrawnLoginIdStaysReservedRegardlessOfCase() throws Exception {
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT login_id FROM users WHERE id=?",String.class,user))
            .isEqualTo(RetiredLoginId.digest("runner01"));
        for (String id : new String[]{"RUNNER01","Runner01"}) {
            assertThat(signup.loginIdExists(id)).isTrue();
            mvc.perform(get("/api/v1/auth/login-id/availability").param("loginId",id))
                .andExpect(status().isOk()).andExpect(jsonPath("$.loginId").value(id))
                .andExpect(jsonPath("$.available").value(false));
            mvc.perform(post("/api/v1/auth/signup").contentType(MediaType.APPLICATION_JSON)
                    .content(mapper.writeValueAsString(SignupValidationTest.payload(id,"재가입",false))))
                .andExpect(status().isConflict()).andExpect(jsonPath("$.code").value("LOGIN_ID_DUPLICATED"));
        }
    }
    @Test void actualWithdrawalScrubsIdentityRevokesAllFamiliesAndIsIdempotent() throws Exception {
        var a=grant(); var b=grant();
        var response=withdraw().andExpect(status().isOk()).andExpect(header().string("Cache-Control","no-store")).andReturn();
        var at=mapper.readTree(response.getResponse().getContentAsString()).get("withdrawnAt").asString();
        var row=jdbc.queryForMap("SELECT login_id,password,nickname,birth_date::text,gender::text,phone_number FROM users WHERE id=?",user);
        assertThat(state()).isEqualTo("WITHDRAWN");
        assertThat(row).containsEntry("login_id",RetiredLoginId.digest("runner01")).containsEntry("password","!WITHDRAWN!")
            .containsEntry("nickname","탈퇴한 회원").containsEntry("birth_date","1970-01-01").containsEntry("phone_number","00000000000");
        assertThat(redis.opsForHash().get(key(a),"state")).isEqualTo("REVOKED");
        assertThat(redis.opsForHash().get(key(b),"state")).isEqualTo("REVOKED");
        withdraw("Other99!",true).andExpect(status().isOk()).andExpect(jsonPath("$.withdrawnAt").value(at));
        mvc.perform(get("/api/v1/users/me").header("Authorization",auth())).andExpect(status().isOk())
            .andExpect(jsonPath("$.nickname").value("탈퇴한 회원")).andExpect(jsonPath("$.loginId").isEmpty()).andExpect(jsonPath("$.birthDate").isEmpty());
        mvc.perform(get("/api/v1/users/me/withdrawal-summary").header("Authorization",auth())).andExpect(status().isUnauthorized());
    }
    /** S15P31E105-704: 탈퇴(U18)는 본인이 발급한 기록 공유 링크 행을 지우고, 타인의 링크는 남긴다. 지운 링크는 H09에서 404다. */
    @Test void withdrawalDeletesOwnRunShareLinks() throws Exception {
        String completed = "INSERT INTO running_sessions(user_id,status,analysis_status,started_at,ended_at)"
                + " VALUES (?,'COMPLETED','READY',now()-interval '2 hours',now()-interval '1 hour') RETURNING id";
        long mine=jdbc.queryForObject(completed,Long.class,user);
        long otherUser=other();
        long others=jdbc.queryForObject(completed,Long.class,otherUser);
        String token=mapper.readTree(mvc.perform(post("/api/v1/running-records/"+mine+"/share-link")
                .header("Authorization",auth()).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"자유 러닝\"}")).andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString()).get("token").asString();
        mvc.perform(post("/api/v1/running-records/"+others+"/share-link")
                .header("Authorization",SecurityTestSupport.bearer(otherUser)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"title\":\"다른 러닝\"}")).andExpect(status().isOk());
        mvc.perform(get("/api/v1/shared-runs/"+token)).andExpect(status().isOk());

        withdraw().andExpect(status().isOk());

        assertThat(jdbc.queryForObject("SELECT count(*) FROM run_share_links WHERE user_id=?",Integer.class,user)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM run_share_links WHERE user_id=?",Integer.class,otherUser)).isEqualTo(1);
        mvc.perform(get("/api/v1/shared-runs/"+token)).andExpect(status().isNotFound())
            .andExpect(jsonPath("$.code").value("SHARED_RUN_NOT_FOUND"));
    }

    /** S15P31E105-813 AC-4: 탈퇴는 만족도 응답 행과 의견을 보존하고, 남은 토큰의 새 제출은 저장하지 않는다. */
    @Test void withdrawalKeepsSatisfactionSurveyResponsesAndRejectsNewSubmission() throws Exception {
        mvc.perform(post("/api/v1/satisfaction-surveys").header("Authorization",auth())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"score\":4,\"comment\":\"좋아요\",\"source\":\"SETTINGS\"}"))
            .andExpect(status().isCreated());

        withdraw().andExpect(status().isOk());

        assertThat(jdbc.queryForMap("SELECT score,comment,source FROM satisfaction_survey_responses WHERE user_id=?",user))
            .containsEntry("comment","좋아요").containsEntry("source","SETTINGS");
        mvc.perform(post("/api/v1/satisfaction-surveys").header("Authorization",auth())
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"score\":1,\"source\":\"SETTINGS\"}"))
            .andExpect(status().isUnauthorized());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM satisfaction_survey_responses WHERE user_id=?",Integer.class,user)).isEqualTo(1);
    }

    @Test void missingRedisIndexCannotAllowRefreshOrLoginAfterWithdrawal() throws Exception {
        var token=grant(); redis.delete(com.runway.backend.domain.auth.repository.RefreshTokenStore.userKey(user));
        withdraw().andExpect(status().isOk());
        assertThat(redis.opsForHash().get(key(token),"state")).isEqualTo("ACTIVE");
        request("refresh",token.value()).andExpect(status().isUnauthorized());
        mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}")).andExpect(status().isUnauthorized());
    }
    @Test void withdrawalDeletesOwnPushTokensOnly() throws Exception {
        long otherUser=other();
        jdbc.update("INSERT INTO push_device_tokens(user_id,token,platform) VALUES (?,'mine-1','ANDROID'),(?,'mine-2','ANDROID')",user,user);
        jdbc.update("INSERT INTO push_device_tokens(user_id,token,platform) VALUES (?,'others-1','ANDROID')",otherUser);

        withdraw().andExpect(status().isOk());

        assertThat(jdbc.queryForObject("SELECT count(*) FROM push_device_tokens WHERE user_id=?",Integer.class,user)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM push_device_tokens WHERE user_id=?",Integer.class,otherUser)).isEqualTo(1);
    }

    @Test void runningPausedAndPendingAnalysisBlockWithoutRevocation() throws Exception {
        var token=grant();
        long id=session("RUNNING");
        for (String state : new String[]{"RUNNING","PAUSED"}) {
            jdbc.update("UPDATE running_sessions SET status=?::running_sessions_status_enum WHERE id=?",state,id);
            withdraw().andExpect(status().isConflict()).andExpect(jsonPath("$.details.blockers[0].code").value("ACTIVE_RUNNING_SESSION"));
        }
        jdbc.update("UPDATE running_sessions SET status='COMPLETED',started_at=now(),analysis_status='PROCESSING' WHERE id=?",id);
        withdraw().andExpect(status().isConflict()).andExpect(jsonPath("$.details.blockers[0].code").value("ANALYSIS_PENDING"));
        assertThat(this.state()).isEqualTo("ACTIVE"); assertThat(redis.opsForHash().get(key(token),"state")).isEqualTo("ACTIVE");
    }
    @Test void ownerMustResolveCrewAndGroupHostFirst() throws Exception {
        long c=crew(user); long g=group(c,user,"SCHEDULED");
        mvc.perform(get("/api/v1/users/me/withdrawal-summary").header("Authorization",auth()))
            .andExpect(status().isOk()).andExpect(jsonPath("$.ownedCrews[0].crewId").value(c)).andExpect(jsonPath("$.ownedGroupRuns[0].groupRunId").value(g));
        withdraw().andExpect(status().isConflict()).andExpect(jsonPath("$.details.blockers[0].code").value("CREW_OWNER"));
        assertThat(state()).isEqualTo("ACTIVE");
    }
    @Test void generalMembershipAndScheduledParticipationAreAutomaticallyRemoved() throws Exception {
        long o=other(); long c=crew(o); long g=group(c,o,"SCHEDULED"); long s=session("READY");
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())",c,user);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES (?,?,?)",g,user,s);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT status::text FROM crew_memberships WHERE crew_id=? AND user_id=?",String.class,c,user)).isEqualTo("LEFT");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM group_run_participants WHERE user_id=?",Long.class,user)).isZero();
        assertThat(jdbc.queryForObject("SELECT status::text FROM running_sessions WHERE id=?",String.class,s)).isEqualTo("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT status::text FROM group_runs WHERE id=?",String.class,g)).isEqualTo("SCHEDULED");
    }
    @Test void ongoingGroupParticipantCannotWithdraw() throws Exception {
        long o=other(); long c=crew(o); long g=group(c,o,"RUNNING");
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)",g,user);
        withdraw().andExpect(status().isConflict()).andExpect(jsonPath("$.details.blockers[0].code").value("ACTIVE_GROUP_RUN"));
    }
    @Test void readySessionsIncludingLegacyAreCancelled() throws Exception {
        long legacy=session("READY");
        jdbc.update("UPDATE running_sessions SET state_version=0 WHERE id=?",legacy);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForList("SELECT status::text FROM running_sessions WHERE user_id=?",String.class,user)).containsOnly("CANCELLED");
        assertThat(jdbc.queryForObject("SELECT state_version FROM running_sessions WHERE id=?",Long.class,legacy)).isZero();
    }
    @Test void modernReadySessionIsCancelled() throws Exception {
        long id=session("READY"); withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT status::text FROM running_sessions WHERE id=?",String.class,id)).isEqualTo("CANCELLED");
    }
    @Test void pendingStartCannotBeCancelledByWithdrawal() throws Exception {
        long id=session("READY");
        long device=jdbc.queryForObject("INSERT INTO user_devices(user_id,device_type,linked_at) VALUES (?,'WATCH',now()) RETURNING id",Long.class,user);
        jdbc.update("INSERT INTO session_control_events(session_id,device_id,action,expected_version,result) VALUES (?,?,'START',1,'PENDING')",id,device);
        withdraw().andExpect(status().isConflict()).andExpect(jsonPath("$.details.blockers[0].code").value("PENDING_START"));
        assertThat(state()).isEqualTo("ACTIVE");
    }
    @Test void redisFailureLeavesAccountAndRelationsUntouched() throws Exception {
        redis.opsForValue().set(com.runway.backend.domain.auth.repository.RefreshTokenStore.userKey(user),"synthetic-wrong-type");
        long id=session("READY");
        withdraw().andExpect(status().isServiceUnavailable());
        assertThat(state()).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT status::text FROM running_sessions WHERE id=?",String.class,id)).isEqualTo("READY");
    }
    @Test void publicCourseAndCompletedGroupResultSurviveWithNoHealthOriginals() throws Exception {
        long o=other(); long c=crew(o); long g=group(c,o,"COMPLETED"); long s=session("COMPLETED");
        jdbc.update("UPDATE running_sessions SET total_distance=5000,moving_duration=1500,average_heart_rate=150,started_at=now(),ended_at=now() WHERE id=?",s);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id,session_id) VALUES (?,?,?)",g,user,s);
        long course=jdbc.queryForObject("INSERT INTO courses(creator_id,source_session_id,route,start_position,distance) VALUES (?,?,ST_GeogFromText('LINESTRING(127 37,127.1 37.1)'),ST_GeogFromText('POINT(127 37)'),5000) RETURNING id",Long.class,user,s);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT status::text FROM courses WHERE id=?",String.class,course)).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT total_distance::int FROM running_sessions WHERE id=?",Integer.class,s)).isEqualTo(5000);
        assertThat(jdbc.queryForObject("SELECT average_heart_rate FROM running_sessions WHERE id=?",Integer.class,s)).isNull();
        assertThat(jdbc.queryForObject("SELECT session_id FROM group_run_participants WHERE group_run_id=? AND user_id=?",Long.class,g,user)).isEqualTo(s);
    }
    @Test void healthGpsPostsAndCommentOriginalsAreRemovedButOtherRepliesRemain() throws Exception {
        long s=session("COMPLETED"); long o=other();
        long post=jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body,image_key) VALUES (?,?,'private body','private.png') RETURNING id",Long.class,user,s);
        long comment=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,body) VALUES (?,?,'private comment') RETURNING id",Long.class,post,user);
        long reply=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,parent_comment_id,body) VALUES (?,?,?,'other reply') RETURNING id",Long.class,post,o,comment);
        jdbc.update("INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm) VALUES (?,current_date,60)",user);
        jdbc.update("INSERT INTO running_route_points(running_session_id,measured_at,position) VALUES (?,now(),ST_GeogFromText('POINT(127 37)'))",s);
        jdbc.update("INSERT INTO user_hr_personalization(user_id,personalization_version,schema_version,model_version,support_run_count,summary_u_json,history8_json,p4_json,hr0_sub_bpm) VALUES (?,1,'synthetic','synthetic',0,'{}','[]','[]',60)",user);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT body FROM comments WHERE id=?",String.class,comment)).isEqualTo("탈퇴한 회원의 댓글입니다");
        assertThat(jdbc.queryForObject("SELECT body FROM comments WHERE id=?",String.class,reply)).isEqualTo("other reply");
        var p=jdbc.queryForMap("SELECT body,image_key,deleted_at FROM posts WHERE id=?",post);
        assertThat(p.get("body")).isEqualTo("탈퇴한 회원의 게시물입니다."); assertThat(p.get("image_key")).isNull(); assertThat(p.get("deleted_at")).isNotNull();
        for (String table : new String[]{"daily_health_metrics","user_hr_personalization"})
            assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE user_id=?",Long.class,user)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM running_route_points WHERE running_session_id=?",Long.class,s)).isZero();
        mvc.perform(get("/api/v1/posts/"+post).header("Authorization",SecurityTestSupport.bearer(o))).andExpect(status().isGone()).andExpect(jsonPath("$.code").value("WITHDRAWN_POST"));
        assertThatThrownBy(() -> jdbc.update("INSERT INTO daily_health_metrics(user_id,metric_date) VALUES (?,current_date)",user)).hasRootCauseInstanceOf(java.sql.SQLException.class);
    }
    @Test void ownPostLikesCommentLikesAndBookmarksAreRemovedButOthersRemain() throws Exception {
        long o=other();
        long os=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,analysis_status) VALUES (?,'COMPLETED','READY') RETURNING id",Long.class,o);
        long otherPost=jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body) VALUES (?,?,'other post') RETURNING id",Long.class,o,os);
        long otherComment=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,body) VALUES (?,?,'other comment') RETURNING id",Long.class,otherPost,o);
        long ownPost=jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body) VALUES (?,?,'own post') RETURNING id",Long.class,user,session("COMPLETED"));
        long ownComment=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,body) VALUES (?,?,'own comment') RETURNING id",Long.class,otherPost,user);
        for (long liker : new long[]{user,o}) {
            jdbc.update("INSERT INTO post_likes(post_id,user_id) VALUES (?,?)",otherPost,liker);
            jdbc.update("INSERT INTO comment_likes(comment_id,user_id) VALUES (?,?)",otherComment,liker);
            jdbc.update("INSERT INTO post_bookmarks(post_id,user_id) VALUES (?,?)",otherPost,liker);
        }
        jdbc.update("INSERT INTO post_likes(post_id,user_id) VALUES (?,?)",ownPost,o);
        jdbc.update("INSERT INTO comment_likes(comment_id,user_id) VALUES (?,?)",ownComment,o);
        jdbc.update("INSERT INTO post_bookmarks(post_id,user_id) VALUES (?,?)",ownPost,o);
        withdraw().andExpect(status().isOk());
        for (String table : new String[]{"post_likes","comment_likes","post_bookmarks"}) {
            assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE user_id=?",Long.class,user)).as(table).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM "+table+" WHERE user_id=?",Long.class,o)).as(table).isEqualTo(2L);
        }
        assertThatThrownBy(() -> jdbc.update("INSERT INTO comment_likes(comment_id,user_id) VALUES (?,?)",otherComment,user))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(() -> jdbc.update("INSERT INTO post_bookmarks(post_id,user_id) VALUES (?,?)",otherPost,user))
                .hasRootCauseInstanceOf(java.sql.SQLException.class);
    }
    @Test void previouslyDeletedPostRemainsNotFoundAfterWithdrawal() throws Exception {
        long id=session("COMPLETED"); long o=other();
        long post=jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body,deleted_at) VALUES (?,?,'private deleted original',now()) RETURNING id",Long.class,user,id);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT body FROM posts WHERE id=?",String.class,post)).isNull();
        mvc.perform(get("/api/v1/posts/"+post).header("Authorization",SecurityTestSupport.bearer(o)))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
    }
    @Test
    @org.junit.jupiter.api.extension.ExtendWith(org.springframework.boot.test.system.OutputCaptureExtension.class)
    void externalPostCommentsShowTombstonePreserveRepliesAndNeverReviveDeletedComments(
            org.springframework.boot.test.system.CapturedOutput output) throws Exception {
        long o=other();
        long session=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,analysis_status) VALUES (?,'COMPLETED','READY') RETURNING id",Long.class,o);
        long post=jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body) VALUES (?,?,'other post') RETURNING id",Long.class,o,session);
        long comment=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,body) VALUES (?,?,'synthetic-private-comment-marker') RETURNING id",Long.class,post,user);
        long deleted=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,body,deleted_at) VALUES (?,?,'synthetic-deleted-comment-marker',now()) RETURNING id",Long.class,post,user);
        long reply=jdbc.queryForObject("INSERT INTO comments(post_id,author_id,parent_comment_id,body) VALUES (?,?,?,'other reply') RETURNING id",Long.class,post,o,comment);
        withdraw().andExpect(status().isOk());
        mvc.perform(get("/api/v1/posts/"+post+"/comments").header("Authorization",SecurityTestSupport.bearer(o)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(2))
            .andExpect(jsonPath("$.items[0].id").value(comment))
            .andExpect(jsonPath("$.items[0].body").value("탈퇴한 회원의 댓글입니다"))
            .andExpect(jsonPath("$.items[1].id").value(reply))
            .andExpect(jsonPath("$.items[1].body").value("other reply"));
        assertThat(jdbc.queryForObject("SELECT deleted_at IS NOT NULL FROM comments WHERE id=?",Boolean.class,deleted)).isTrue();
        assertThat(output.getAll()).doesNotContain("synthetic-private-comment-marker","synthetic-deleted-comment-marker","Runner9!");
    }
    @Test void actualFilesAreDeletedAndFailureIsRetryableAfterCommit() throws Exception {
        byte[] png={(byte)0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a};
        String id=images.upload(user,new MockMultipartFile("file","x.png","image/png",png),"PROFILE").imageId();
        doThrow(new ApiException(ErrorCode.UPLOAD_UNAVAILABLE)).when(cleanup).clean(user);
        withdraw().andExpect(status().isServiceUnavailable()).andExpect(jsonPath("$.code").value("IMAGE_CLEANUP_PENDING"))
            .andExpect(jsonPath("$.details.withdrawalCompleted").value(true));
        assertThat(state()).isEqualTo("WITHDRAWN");
        assertThat(volume.resolve("images/by-id/"+id+".png")).exists();
        doCallRealMethod().when(cleanup).clean(user);
        withdraw().andExpect(status().isOk());
        assertThat(volume.resolve("images/by-id/"+id+".png")).doesNotExist();
        assertThat(volume.resolve("images/profile/"+user+"/"+id+".png")).doesNotExist();
    }
    @Test void inconsistentWithdrawalStateFailsWithoutRevokingOrOverwritingTimestamp() throws Exception {
        var token=grant();
        jdbc.update("UPDATE users SET withdrawn_at=now() WHERE id=?",user);
        var at=jdbc.queryForObject("SELECT withdrawn_at FROM users WHERE id=?",java.sql.Timestamp.class,user);
        withdraw().andExpect(status().isServiceUnavailable());
        assertThat(state()).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT withdrawn_at FROM users WHERE id=?",java.sql.Timestamp.class,user)).isEqualTo(at);
        assertThat(redis.opsForHash().get(key(token),"state")).isEqualTo("ACTIVE");
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=NULL WHERE id=?",user);
        withdraw().andExpect(status().isServiceUnavailable());
        verify(cleanup,never()).clean(user);
    }
    @Test void databaseFailureRollsBackPrivacyWritesEvenAfterTokenRevocation() throws Exception {
        var token=grant(); long s=session("COMPLETED");
        long o=other(); long c=crew(o); long g=group(c,o,"SCHEDULED");
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())",c,user);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)",g,user);
        doThrow(new IllegalStateException("synthetic failure")).when(withdrawalRepository).markWithdrawn(eq(user),anyString(),any());
        withdraw().andExpect(status().isServiceUnavailable());
        assertThat(state()).isEqualTo("ACTIVE");
        assertThat(jdbc.queryForObject("SELECT deleted_at IS NULL FROM running_sessions WHERE id=?",Boolean.class,s)).isTrue();
        assertThat(redis.opsForHash().get(key(token),"state")).isEqualTo("REVOKED");
        assertThat(jdbc.queryForObject("SELECT status::text FROM crew_memberships WHERE crew_id=? AND user_id=?",String.class,c,user)).isEqualTo("APPROVED");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM group_run_participants WHERE group_run_id=? AND user_id=?",Long.class,g,user)).isEqualTo(1);
        verify(cleanup,never()).clean(user);
    }
    void waitForDatabaseLock() {
        long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
        while(System.nanoTime()<until) {
            if(jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'",Integer.class)>0) return;
            Thread.onSpinWait();
        }
        fail("Expected a real PostgreSQL lock wait");
    }
    void await(CountDownLatch latch) {
        try { if(!latch.await(10,TimeUnit.SECONDS)) throw new IllegalStateException("latch timeout"); }
        catch(InterruptedException e) { Thread.currentThread().interrupt(); throw new IllegalStateException(e); }
    }
    long readyHost(long host,long group) {
        long device=jdbc.queryForObject("INSERT INTO user_devices(user_id,device_type,linked_at) VALUES (?,'WATCH',now()) RETURNING id",Long.class,host);
        long session=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,control_device_id,goal_distance) VALUES (?,'READY',?,5000) RETURNING id",Long.class,host,device);
        jdbc.update("UPDATE group_runs SET goal_distance=5000 WHERE id=?",group);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id,session_id,ready) VALUES (?,?,?,true)",group,host,session);
        return session;
    }
    @Test void committedCrewTransferMakesWithdrawalRecheckOwnerAndReject() throws Exception {
        long o=other(); long c=crew(o);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())",c,user);
        var changed=new CountDownLatch(1); var release=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var transfer=pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
                crews.leave(o,c,user); jdbc.queryForObject("SELECT 1",Integer.class);
                // Flush the actual JPA transfer before holding the transaction open.
                entityManager.flush(); changed.countDown(); await(release);
            }));
            assertThat(changed.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isConflict()));
            waitForDatabaseLock(); release.countDown(); transfer.get(15,TimeUnit.SECONDS); retirement.get(15,TimeUnit.SECONDS);
            assertThat(state()).isEqualTo("ACTIVE");
            assertThat(jdbc.queryForObject("SELECT owner_id FROM crews WHERE id=?",Long.class,c)).isEqualTo(user);
        } finally { release.countDown(); }
    }
    @Autowired jakarta.persistence.EntityManager entityManager;
    @Test void withdrawalWinningCrewTransferCannotInstallRetiredOwner() throws Exception {
        long o=other(); long c=crew(o);
        jdbc.update("INSERT INTO crew_memberships(crew_id,user_id,status,joined_at) VALUES (?,?,'APPROVED',now())",c,user);
        var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            // Other requests still see APPROVED until withdrawal commits, but the write guard rejects the transfer.
            var transfer=pool.submit(() -> crews.leave(o,c,user));
            waitForDatabaseLock(); release.countDown(); retirement.get(15,TimeUnit.SECONDS);
            assertThatThrownBy(() -> transfer.get(10,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);
            assertThat(state()).isEqualTo("WITHDRAWN");
            assertThat(jdbc.queryForObject("SELECT owner_id FROM crews WHERE id=?",Long.class,c)).isEqualTo(o);
        } finally {release.countDown();}
    }
    @Test void groupStartWinningRaceBlocksWithdrawal() throws Exception {
        long o=other(); long c=crew(o); long g=group(c,o,"SCHEDULED"); readyHost(o,g);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)",g,user);
        var started=new CountDownLatch(1); var release=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var start=pool.submit(() -> new TransactionTemplate(transactionManager).executeWithoutResult(tx -> {
                groups.start(o,g); entityManager.flush(); started.countDown(); await(release);
            }));
            assertThat(started.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isConflict()));
            waitForDatabaseLock(); release.countDown(); start.get(15,TimeUnit.SECONDS); retirement.get(15,TimeUnit.SECONDS);
            assertThat(state()).isEqualTo("ACTIVE");
            assertThat(jdbc.queryForObject("SELECT status::text FROM group_runs WHERE id=?",String.class,g)).isEqualTo("RUNNING");
        } finally {release.countDown();}
    }
    @Test void withdrawalWinningRaceRemovesParticipantBeforeGroupStarts() throws Exception {
        long o=other(); long c=crew(o); long g=group(c,o,"SCHEDULED"); readyHost(o,g);
        jdbc.update("INSERT INTO group_run_participants(group_run_id,user_id) VALUES (?,?)",g,user);
        var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            var start=pool.submit(() -> groups.start(o,g));
            waitForDatabaseLock(); release.countDown(); retirement.get(15,TimeUnit.SECONDS); start.get(15,TimeUnit.SECONDS);
            assertThat(state()).isEqualTo("WITHDRAWN");
            assertThat(jdbc.queryForObject("SELECT count(*) FROM group_run_participants WHERE group_run_id=? AND user_id=?",Long.class,g,user)).isZero();
            assertThat(jdbc.queryForObject("SELECT status::text FROM group_runs WHERE id=?",String.class,g)).isEqualTo("RUNNING");
        } finally {release.countDown();}
    }
    @Test void refreshWinningRaceIsStillRevokedBySubsequentWithdrawal() throws Exception {
        var token=grant(); var rotated=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> { Object result=call.callRealMethod(); rotated.countDown(); await(release); return result; })
            .when(tokenStore).rotate(any(),any(),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var refreshing=pool.submit(() -> request("refresh",token.value()).andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            assertThat(rotated.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            waitForDatabaseLock(); release.countDown();
            String newToken=mapper.readTree(refreshing.get(15,TimeUnit.SECONDS)).get("refreshToken").asString();
            retirement.get(15,TimeUnit.SECONDS);
            request("refresh",newToken).andExpect(status().isUnauthorized());
            assertThat(state()).isEqualTo("WITHDRAWN");
        } finally {release.countDown();}
    }
    @Test void withdrawalWinningRaceRejectsWaitingRefresh() throws Exception {
        var token=grant(); var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            // The candidate may already be REVOKED before the user lock, so both denial paths are valid.
            var refreshing=pool.submit(() -> request("refresh",token.value()).andExpect(status().isUnauthorized()));
            release.countDown(); retirement.get(15,TimeUnit.SECONDS); refreshing.get(15,TimeUnit.SECONDS);
        } finally {release.countDown();}
    }
    ResultActions login() throws Exception {
        return mvc.perform(post("/api/v1/auth/login").contentType(MediaType.APPLICATION_JSON)
            .content("{\"loginId\":\"runner01\",\"password\":\"Runner9!\"}"));
    }
    @Test void loginWinningRaceHasItsNewFamilyRevoked() throws Exception {
        var created=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> { Object result=call.callRealMethod(); created.countDown(); await(release); return result; })
            .when(tokenStore).createForLogin(any(),eq("runner01"));
        try(var pool=Executors.newFixedThreadPool(2)) {
            var loggingIn=pool.submit(() -> login().andExpect(status().isOk()).andReturn().getResponse().getContentAsString());
            assertThat(created.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            waitForDatabaseLock(); release.countDown();
            String newToken=mapper.readTree(loggingIn.get(15,TimeUnit.SECONDS)).get("refreshToken").asString();
            retirement.get(15,TimeUnit.SECONDS); request("refresh",newToken).andExpect(status().isUnauthorized());
        } finally {release.countDown();}
    }
    @Test void withdrawalWinningRaceRejectsLoginWithoutIssuingFamily() throws Exception {
        var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            var loggingIn=pool.submit(() -> login().andExpect(status().isUnauthorized()));
            waitForDatabaseLock(); release.countDown(); retirement.get(15,TimeUnit.SECONDS); loggingIn.get(15,TimeUnit.SECONDS);
            verify(tokenStore,never()).createForLogin(any(),anyString());
        } finally {release.countDown();}
    }
    @Test void withdrawalRemovesCurrentFollowsAndPreservesDevRequestHistory() throws Exception {
        long o=other(); signup.insertSettings(user); signup.insertSettings(o);
        jdbc.update("UPDATE user_settings SET account_visibility='PRIVATE' WHERE user_id=?",o);
        follows.follow(user,o);
        long request=jdbc.queryForObject("SELECT id FROM user_follows WHERE follower_id=? AND followee_id=?",Long.class,user,o);
        follows.decide(o,user,request,"APPROVE");
        assertThat(jdbc.queryForObject("SELECT result FROM follow_request_history WHERE request_id=?",String.class,request)).isEqualTo("APPROVED");
        follows.follow(o,user);
        withdraw().andExpect(status().isOk());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE follower_id=? OR followee_id=?",Long.class,user,user)).isZero();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM follow_request_history",Long.class)).isEqualTo(1);
        assertThat(jdbc.queryForObject("SELECT result FROM follow_request_history WHERE request_id=?",String.class,request)).isEqualTo("CANCELLED");
        assertThatThrownBy(() -> follows.decide(o,user,request,"APPROVE")).isInstanceOfSatisfying(ApiException.class,
                ex -> assertThat(ex.code()).isEqualTo("REQUEST_STATE_CONFLICT"));
        assertThatThrownBy(() -> follows.follow(user,o)).isInstanceOf(ApiException.class);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE follower_id=? OR followee_id=?",Long.class,user,user)).isZero();
    }
    @Test void newDevFollowCannotCreateRelationWhileWithdrawalIsCommitting() throws Exception {
        long o=other(); signup.insertSettings(user); signup.insertSettings(o);
        var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            var follow=pool.submit(() -> follows.follow(user,o));
            try {assertThatThrownBy(() -> follow.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);}
            finally {release.countDown();}
            retirement.get(15,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE follower_id=? OR followee_id=?",Long.class,user,user)).isZero();
        } finally {release.countDown();}
    }
    long pendingFollow(long target) {
        signup.insertSettings(user); signup.insertSettings(target);
        jdbc.update("UPDATE user_settings SET account_visibility='PRIVATE' WHERE user_id=?",target);
        follows.follow(user,target);
        return jdbc.queryForObject("SELECT id FROM user_follows WHERE follower_id=? AND followee_id=?",Long.class,user,target);
    }
    @Test void approvalWinningRaceIsCancelledByWithdrawal() throws Exception {
        long target=other(); long request=pendingFollow(target);
        var remembered=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {Object result=call.callRealMethod();remembered.countDown();await(release);return result;})
            .when(followRepository).remember(eq(request),eq(user),eq(target),eq("APPROVED"));
        try(var pool=Executors.newFixedThreadPool(2)) {
            var approval=pool.submit(() -> follows.decide(target,user,request,"APPROVE"));
            assertThat(remembered.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            waitForDatabaseLock();release.countDown();approval.get(15,TimeUnit.SECONDS);retirement.get(15,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT result FROM follow_request_history WHERE request_id=?",String.class,request)).isEqualTo("CANCELLED");
            assertThatThrownBy(() -> follows.decide(target,user,request,"APPROVE")).isInstanceOfSatisfying(ApiException.class,
                    ex -> assertThat(ex.code()).isEqualTo("REQUEST_STATE_CONFLICT"));
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE id=?",Long.class,request)).isZero();
        } finally {release.countDown();}
    }
    @Test void withdrawalWinningRaceRejectsLateApprovalHistoryInsert() throws Exception {
        long target=other();long request=pendingFollow(target);
        var retiring=new CountDownLatch(1);var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown();await(release);return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            var approval=pool.submit(() -> follows.decide(target,user,request,"APPROVE"));
            try {assertThatThrownBy(() -> approval.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);}
            finally {release.countDown();}
            retirement.get(15,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM follow_request_history WHERE request_id=?",Long.class,request)).isZero();
            assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE id=?",Long.class,request)).isZero();
        } finally {release.countDown();}
    }
    com.runway.backend.domain.session.entity.RunningSession comparisonFixture(long owner) {
        long past=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,analysis_status,started_at,ended_at) VALUES (?,'COMPLETED','READY',now()-interval '2 minutes',now()-interval '1 minute') RETURNING id",Long.class,owner);
        jdbc.update("INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,total_distance,is_hr_measured) SELECT id,started_at,0,0,false FROM running_sessions WHERE id=?",past);
        jdbc.update("INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,total_distance,is_hr_measured) SELECT id,ended_at,60,200,false FROM running_sessions WHERE id=?",past);
        long current=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status,comparison_session_id) VALUES (?,'READY',?) RETURNING id",Long.class,owner,past);
        return sessionRepository.findById(current).orElseThrow();
    }
    java.util.Map<?,?> comparisonCache() {
        return (java.util.Map<?,?>)org.springframework.test.util.ReflectionTestUtils.getField(comparisons,"pastTracks");
    }
    @Test void withdrawalRemovesOnlyOwnComparisonCacheAndLaterCompareCannotRefill() throws Exception {
        var current=comparisonFixture(user);var others=comparisonFixture(other());
        comparisons.compare(current,java.time.Instant.now());comparisons.compare(others,java.time.Instant.now());
        assertThat(comparisonCache().containsKey(current.getComparisonSessionId())).isTrue();
        withdraw().andExpect(status().isOk());
        assertThat(comparisonCache().containsKey(current.getComparisonSessionId())).isFalse();
        assertThat(comparisonCache().containsKey(others.getComparisonSessionId())).isTrue();
        comparisons.compare(current,java.time.Instant.now());
        assertThat(comparisonCache().containsKey(current.getComparisonSessionId())).isFalse();
        comparisons.forgetUser(others.getUserId());
    }
    @Test void failedWithdrawalDoesNotRemoveComparisonCache() throws Exception {
        var current=comparisonFixture(user);comparisons.compare(current,java.time.Instant.now());
        doThrow(new IllegalStateException("synthetic failure")).when(withdrawalRepository).markWithdrawn(eq(user),anyString(),any());
        withdraw().andExpect(status().isServiceUnavailable());
        assertThat(state()).isEqualTo("ACTIVE");
        assertThat(comparisonCache().containsKey(current.getComparisonSessionId())).isTrue();
        comparisons.forgetUser(user);
    }
    @Test void inFlightComparisonCannotRefillCacheAfterWithdrawalSucceeds() throws Exception {
        var current=comparisonFixture(user);long past=current.getComparisonSessionId();
        var loaded=new CountDownLatch(1);var release=new CountDownLatch(1);
        doAnswer(call -> {Object result=call.callRealMethod();loaded.countDown();await(release);return result;})
            .when(analysis).findDistanceSamples(past);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var compare=pool.submit(() -> comparisons.compare(current,java.time.Instant.now()));
            assertThat(loaded.await(10,TimeUnit.SECONDS)).isTrue();
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            long deadline=System.nanoTime()+TimeUnit.SECONDS.toNanos(5);
            while(!state().equals("WITHDRAWN") && System.nanoTime()<deadline) Thread.onSpinWait();
            assertThat(state()).isEqualTo("WITHDRAWN");assertThat(retirement.isDone()).isFalse();
            release.countDown();compare.get(15,TimeUnit.SECONDS);retirement.get(15,TimeUnit.SECONDS);
            assertThat(comparisonCache().containsKey(past)).isFalse();
            comparisons.compare(current,java.time.Instant.now());
            assertThat(comparisonCache().containsKey(past)).isFalse();
        } finally {release.countDown();}
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans={false,true})
    void oldS02OrS10SnapshotCannotRepopulateCacheAfterWithdrawal(boolean stream) throws Exception {
        var current=comparisonFixture(user);long past=current.getComparisonSessionId();
        comparisons.compare(current,java.time.Instant.now());
        assertThat(comparisonCache().containsKey(past)).isTrue();
        var snapshot=new CountDownLatch(1);var release=new CountDownLatch(1);
        doAnswer(call -> {
            snapshot.countDown();await(release);
            // These real S02/S10 transactions still see the row from before withdrawal.
            assertThat(jdbc.queryForObject("SELECT deleted_at IS NULL FROM running_sessions WHERE id=?",Boolean.class,past)).isTrue();
            return call.callRealMethod();
        }).when(comparisons).compare(argThat(value -> value.getId().equals(current.getId())),any());
        try(var pool=Executors.newSingleThreadExecutor()) {
            var read=pool.submit(() -> stream ? streamQuery.current(user,current.getId())
                    : runningSessions.get(user,current.getId(),java.time.Instant.now()));
            assertThat(snapshot.await(10,TimeUnit.SECONDS)).isTrue();
            withdraw().andExpect(status().isOk());
            assertThat(comparisonCache().containsKey(past)).isFalse();
            release.countDown();assertThat(read.get(15,TimeUnit.SECONDS)).isNotNull();
            assertThat(comparisonCache().containsKey(past)).isFalse();
        } finally {release.countDown();}
    }
    @Test void concurrentWithdrawalReturnsSameTimestamp() throws Exception {
        try(var pool=Executors.newFixedThreadPool(2)) {
            var gate=new CountDownLatch(1);
            Callable<String> request=() -> { gate.await(); return withdraw().andExpect(status().isOk()).andReturn().getResponse().getContentAsString(); };
            var a=pool.submit(request); var b=pool.submit(request); gate.countDown();
            assertThat(mapper.readTree(a.get(20,TimeUnit.SECONDS)).get("withdrawnAt").asString())
                .isEqualTo(mapper.readTree(b.get(20,TimeUnit.SECONDS)).get("withdrawnAt").asString());
        }
    }
    @Test void sessionlessLegacyBatchCannotBeRecreatedAfterWithdrawal() throws Exception {
        long device=jdbc.queryForObject("INSERT INTO user_devices(user_id,device_type,linked_at) VALUES (?,'WATCH',now()) RETURNING id",Long.class,user);
        withdraw().andExpect(status().isOk());
        assertThatThrownBy(() -> jdbc.update("INSERT INTO sync_batches(client_batch_id,device_id,session_id,payload_version,payload_hash,status,committed_at) VALUES (?::uuid,?,NULL,1,?,'COMMITTED',now())",java.util.UUID.randomUUID().toString(),device,"0".repeat(64)))
            .hasRootCauseInstanceOf(java.sql.SQLException.class)
            .hasStackTraceContaining("Resource owner is not active");
        assertThat(jdbc.queryForObject("SELECT count(*) FROM sync_batches WHERE device_id=?",Long.class,device)).isZero();
    }
    @Test void lateSessionGpsWriteWaitsOnSessionThenCannotRecreatePrivateData() throws Exception {
        long session=session("COMPLETED");
        var retiring=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(call -> {retiring.countDown(); await(release); return call.callRealMethod();}).when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(retiring.await(10,TimeUnit.SECONDS)).isTrue();
            var write=pool.submit(() -> jdbc.update("INSERT INTO running_route_points(running_session_id,measured_at,position) VALUES (?,now(),ST_GeogFromText('POINT(127 37)'))",session));
            waitForDatabaseLock(); release.countDown(); retirement.get(15,TimeUnit.SECONDS);
            assertThatThrownBy(() -> write.get(10,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM running_route_points WHERE running_session_id=?",Long.class,session)).isZero();
        } finally {release.countDown();}
    }
    @Test void lateHealthWriteFailsDuringWithdrawalAndCannotRecreateData() throws Exception {
        var locked=new CountDownLatch(1); var release=new CountDownLatch(1);
        doAnswer(invocation -> { locked.countDown(); if(!release.await(10,TimeUnit.SECONDS)) throw new IllegalStateException(); return invocation.callRealMethod(); })
            .when(withdrawalRepository).scrub(eq(user),any());
        try(var pool=Executors.newFixedThreadPool(2)) {
            var retirement=pool.submit(() -> withdraw().andExpect(status().isOk()));
            assertThat(locked.await(10,TimeUnit.SECONDS)).isTrue();
            var write=pool.submit(() -> jdbc.update("INSERT INTO daily_health_metrics(user_id,metric_date) VALUES (?,current_date)",user));
            try { assertThatThrownBy(() -> write.get(5,TimeUnit.SECONDS)).isInstanceOf(ExecutionException.class); }
            finally { release.countDown(); }
            retirement.get(20,TimeUnit.SECONDS);
            assertThat(jdbc.queryForObject("SELECT count(*) FROM daily_health_metrics WHERE user_id=?",Long.class,user)).isZero();
        } finally { release.countDown(); }
    }
}
