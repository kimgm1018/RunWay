package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.user.service.*;
import com.runway.backend.domain.user.repository.*;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.util.*;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.event.ApplicationEvents;
import org.springframework.test.context.event.RecordApplicationEvents;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@AutoConfigureMockMvc
@RecordApplicationEvents
class FollowApiIntegrationTest {
    static final SharedPostgres.Database DATABASE = SharedPostgres.database(FollowApiIntegrationTest.class);
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired FollowService follows;
    @MockitoSpyBean FollowRepository repository;
    @Autowired PrivacySettingsService privacy;
    @MockitoSpyBean UserAccountRepository accounts;
    @MockitoSpyBean com.runway.backend.domain.community.repository.AccountVisibilityRepository visibility;
    @Autowired RunnerProfileService profiles;
    @Autowired PlatformTransactionManager manager;
    @Autowired ApplicationEvents events;
    long a, b, outsider;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        a = member("followa"); b = member("followb"); outsider = member("followc");
    }
    long member(String name) {
        long id = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '00000000000', 'DISAGREE') RETURNING id
                """, Long.class, name, name);
        signup.insertSettings(id);
        return id;
    }
    String auth(long id) { return SecurityTestSupport.bearer(id); }
    String relation(long target) { return "/api/v1/users/" + target + "/follow"; }
    String profile(long target) { return "/api/v1/users/" + target + "/profile"; }

    @Test
    void restrictedAndAccessibleProfilesDoNotExposeProtectedFields() throws Exception {
        mvc.perform(get(profile(b)).header("Authorization", auth(a)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.profileAccessible").value(false))
                .andExpect(jsonPath("$.nickname").value("followb"))
                .andExpect(jsonPath("$.runningLevel").doesNotExist())
                .andExpect(jsonPath("$.posts").doesNotExist())
                .andExpect(jsonPath("$.followerCount").doesNotExist())
                .andExpect(jsonPath("$.monthlySummary").doesNotExist());
        mvc.perform(get(profile(a)).header("Authorization", auth(a)))
                .andExpect(jsonPath("$.profileAccessible").value(true))
                .andExpect(jsonPath("$.followStatus").value("NONE"))
                .andExpect(jsonPath("$.posts").isArray());
        privacy.update(b, false);
        mvc.perform(get(profile(b)).header("Authorization", auth(a)))
                .andExpect(jsonPath("$.profileAccessible").value(true))
                .andExpect(jsonPath("$.followerCount").value(0));
    }

    @Test
    void profileReturnsAllPostsAndCancellationRevokesAccess() throws Exception {
        for (int i=0;i<12;i++) {
            long session=jdbc.queryForObject("INSERT INTO running_sessions(user_id,status) VALUES (?,'COMPLETED') RETURNING id",
                    Long.class,b);
            jdbc.update("INSERT INTO posts(author_id,session_id,body) VALUES (?,?,?)",b,session,"synthetic"+i);
        }
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        follows.decide(b,a,id,"APPROVE");
        mvc.perform(get(profile(b)).header("Authorization",auth(a)))
                .andExpect(jsonPath("$.posts.length()").value(12))
                .andExpect(jsonPath("$.followerCount").value(1));
        follows.cancel(a,b);
        mvc.perform(get(profile(b)).header("Authorization",auth(a)))
                .andExpect(jsonPath("$.posts").doesNotExist())
                .andExpect(jsonPath("$.profileAccessible").value(false));
        mvc.perform(get("/api/v1/posts").param("authorId",Long.toString(b))
                .header("Authorization",auth(a))).andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void publicAndPrivateFollowAreIdempotentAndEmitOnlyNewEvents() throws Exception {
        privacy.update(b, false);
        mvc.perform(put(relation(b)).header("Authorization", auth(a)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.followStatus").value("FOLLOWING"))
                .andExpect(jsonPath("$.followerCount").value(1));
        follows.follow(a,b);
        assertThat(events.stream(FollowNotificationEvent.class).count()).isEqualTo(1);
        follows.follow(a,outsider);
        assertThat(repository.followerCount(outsider)).isZero();
        assertThat(follows.pending(outsider,null,null).items()).hasSize(1);
        assertThat(events.stream(FollowNotificationEvent.class).map(FollowNotificationEvent::kind))
                .containsExactly(FollowNotificationEvent.Kind.NEW_FOLLOWER,
                        FollowNotificationEvent.Kind.FOLLOW_REQUEST);
    }

    @Test
    void decisionsAndCancellationKeepHistoryAndRejectStaleGeneration() {
        follows.follow(a,b);
        long first = repository.find(a,b).orElseThrow().id();
        assertThat(follows.decide(b,a,first,"REJECT").followStatus()).isEqualTo("NONE");
        assertThat(follows.decide(b,a,first,"REJECT").followStatus()).isEqualTo("NONE");
        assertThatThrownBy(() -> follows.decide(b,a,first,"APPROVE")).isInstanceOf(ApiException.class);
        follows.follow(a,b);
        long second = repository.find(a,b).orElseThrow().id();
        assertThat(second).isGreaterThan(first);
        assertThatThrownBy(() -> follows.decide(b,a,first,"APPROVE")).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> follows.decide(b,a,first,"REJECT")).isInstanceOf(ApiException.class);
        assertThat(repository.find(a,b).orElseThrow().approved()).isFalse();
        assertThat(follows.decide(b,a,second,"APPROVE").followStatus()).isEqualTo("FOLLOWING");
        follows.decide(b,a,second,"APPROVE");
        assertThat(repository.followerCount(b)).isEqualTo(1);
        follows.cancel(a,b); follows.cancel(a,b);
        assertThat(repository.find(a,b)).isEmpty();
        assertThat(repository.history(first).orElseThrow().result()).isEqualTo("REJECTED");
        assertThat(repository.history(second).orElseThrow().result()).isEqualTo("CANCELLED");
        assertThatThrownBy(() -> follows.decide(b,a,second,"APPROVE")).isInstanceOf(ApiException.class);
    }

    @Test
    void pendingPagesHaveStableTieBreakAndOnlyOwnedPendingRows() {
        for(int i=0;i<12;i++) follows.follow(member("page"+i), b);
        jdbc.update("UPDATE user_follows SET created_at='2026-01-01T00:00:00Z'");
        var first = follows.pending(b,null,10);
        assertThat(first.items()).hasSize(10); assertThat(first.hasNext()).isTrue();
        var second = follows.pending(b,first.nextCursor(),10);
        assertThat(second.items()).hasSize(2); assertThat(second.hasNext()).isFalse();
        assertThat(second.nextCursor()).isNull();
        assertThat(first.items()).noneMatch(second.items()::contains);
        assertThat(follows.pending(a,null,10).items()).isEmpty();
        assertThatThrownBy(() -> follows.pending(a,first.nextCursor(),10)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> follows.pending(b,"bad",10)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> follows.pending(b,null,11)).isInstanceOf(ApiException.class);
    }

    @Test
    void validatesInputAndHidesOtherOwnersRequests() throws Exception {
        mvc.perform(put(relation(b))).andExpect(status().isUnauthorized());
        mvc.perform(put(relation(a)).header("Authorization",auth(a)))
                .andExpect(status().isUnprocessableContent()).andExpect(jsonPath("$.code").value("CANNOT_FOLLOW_SELF"));
        mvc.perform(get(profile(99999)).header("Authorization",auth(a))).andExpect(status().isNotFound());
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        String url="/api/v1/users/me/follow-requests/"+a;
        mvc.perform(patch(url).header("Authorization",auth(outsider)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"requestId\":"+id+",\"decision\":\"APPROVE\"}"))
                .andExpect(status().isNotFound());
        for(String body: List.of("{}", "{\"requestId\":1.5,\"decision\":\"APPROVE\"}",
                "{\"requestId\":9223372036854775808,\"decision\":\"APPROVE\"}")) {
            mvc.perform(patch(url).header("Authorization",auth(b)).contentType(MediaType.APPLICATION_JSON)
                    .content(body)).andExpect(status().isBadRequest());
        }
        mvc.perform(patch(url).header("Authorization",auth(b)).contentType(MediaType.APPLICATION_JSON)
                .content("{\"requestId\":"+id+",\"decision\":\"BAD\"}"))
                .andExpect(status().isUnprocessableContent());
        assertThat(repository.find(a,b).orElseThrow().approved()).isFalse();
    }

    @Test
    void inactiveRequesterIsMissingResourceNotOwnersAuthenticationFailure() throws Exception {
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?",a);
        mvc.perform(patch("/api/v1/users/me/follow-requests/"+a).header("Authorization",auth(b))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"requestId\":"+id+",\"decision\":\"APPROVE\"}"))
                .andExpect(status().isNotFound()).andExpect(jsonPath("$.code").value("REQUEST_NOT_FOUND"));
        assertThat(repository.find(a,b).orElseThrow().approved()).isFalse();
        assertThat(repository.history(id)).isEmpty();
    }

    @Test
    void outOfRangeCursorReturnsInvalidFilter() throws Exception {
        for(String time:List.of("+1000000000-12-31T23:59:59Z","+300000-01-01T00:00:00Z",
                "0000-01-01T00:00:00Z")) {
            String cursor=Base64.getUrlEncoder().withoutPadding().encodeToString(
                    (b+"|"+time+"|1").getBytes(java.nio.charset.StandardCharsets.UTF_8));
            mvc.perform(get("/api/v1/users/me/follow-requests").header("Authorization",auth(b))
                    .param("cursor",cursor)).andExpect(status().isBadRequest())
                    .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        }
    }

    @Test
    void rollbackDoesNotPersistRelationOrHistory() {
        var tx=new TransactionTemplate(manager);
        tx.executeWithoutResult(status -> { follows.follow(a,b); status.setRollbackOnly(); });
        assertThat(repository.find(a,b)).isEmpty();
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        tx.executeWithoutResult(status -> { follows.decide(b,a,id,"APPROVE"); status.setRollbackOnly(); });
        assertThat(repository.find(a,b).orElseThrow().approved()).isFalse();
        assertThat(repository.history(id)).isEmpty();
    }

    @Test
    void concurrentDuplicateRequestsCreateOneRelation() throws Exception {
        parallel(() -> follows.follow(a,b), () -> follows.follow(a,b));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows",Integer.class)).isEqualTo(1);
    }

    @Test
    void approveAndCancelCannotResurrectRelation() throws Exception {
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        parallel(() -> {try {follows.decide(b,a,id,"APPROVE");} catch(ApiException expected) {
            assertThat(expected.code()).isEqualTo("REQUEST_STATE_CONFLICT");
        }}, () -> follows.cancel(a,b));
        assertThat(repository.find(a,b)).isEmpty();
        assertThat(repository.followerCount(b)).isZero();
    }

    @Test
    void publicTransitionAndCreationUseSameLock() throws Exception {
        parallel(() -> privacy.update(b,false), () -> follows.follow(a,b));
        assertThat(repository.find(a,b).orElseThrow().approved()).isTrue();
        assertThat(repository.followerCount(b)).isEqualTo(1);
    }

    @Test
    void reciprocalFollowsDoNotDeadlock() throws Exception {
        parallel(() -> follows.follow(a,b), () -> follows.follow(b,a));
        assertThat(repository.find(a,b)).isPresent(); assertThat(repository.find(b,a)).isPresent();
    }

    @Test
    void bothLockOrdersOfPublicTransitionAndRequestAreSerialized() throws Exception {
        ordered(() -> privacy.update(b,false), () -> follows.follow(a,b));
        assertThat(repository.find(a,b).orElseThrow().approved()).isTrue();
        follows.cancel(a,b); privacy.update(b,true);
        ordered(() -> follows.follow(a,b), () -> privacy.update(b,false));
        assertThat(repository.find(a,b).orElseThrow().approved()).isTrue();
    }

    @Test
    void bothLockOrdersOfCancelAndApprovalDoNotRestoreRelationship() throws Exception {
        follows.follow(a,b); long first=repository.find(a,b).orElseThrow().id();
        ordered(() -> follows.decide(b,a,first,"APPROVE"), () -> follows.cancel(a,b));
        assertThat(repository.find(a,b)).isEmpty();
        follows.follow(a,b); long second=repository.find(a,b).orElseThrow().id();
        ordered(() -> follows.cancel(a,b), () -> {
            assertThatThrownBy(() -> follows.decide(b,a,second,"APPROVE"))
                    .isInstanceOfSatisfying(ApiException.class,
                            ex -> assertThat(ex.code()).isEqualTo("REQUEST_STATE_CONFLICT"));
        });
        assertThat(repository.find(a,b)).isEmpty();
    }

    @Test
    void profileDecisionAndPayloadUseSameSnapshotDuringCancellation() throws Exception {
        follows.follow(a,b); long id=repository.find(a,b).orElseThrow().id();
        follows.decide(b,a,id,"APPROVE");
        var decided=new CountDownLatch(1);var resume=new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            boolean allowed=(boolean)invocation.callRealMethod();
            decided.countDown(); await(resume); return allowed;
        }).when(visibility).canAccess(a,b);
        try(var pool=Executors.newSingleThreadExecutor()) {
            var response=pool.submit(() -> profiles.read(a,b));
            assertThat(decided.await(5,TimeUnit.SECONDS)).isTrue();
            try {follows.cancel(a,b);} finally {resume.countDown();}
            var snapshot=response.get(5,TimeUnit.SECONDS);
            assertThat(snapshot.profileAccessible()).isTrue();
            assertThat(snapshot.followerCount()).isEqualTo(1);
            assertThat(profiles.read(a,b).profileAccessible()).isFalse();
        } finally {resume.countDown();org.mockito.Mockito.reset(visibility);}
    }

    void ordered(Runnable first, Runnable second) throws Exception {
        var locked=new CountDownLatch(1);var release=new CountDownLatch(1);
        var secondStarted=new CountDownLatch(1);
        var gate=new java.util.concurrent.atomic.AtomicBoolean(true);
        org.mockito.stubbing.Answer<Object> afterRealLock=invocation -> {
            Object value=invocation.callRealMethod();
            if(gate.compareAndSet(true,false)){locked.countDown();await(release);}
            return value;
        };
        org.mockito.Mockito.doAnswer(afterRealLock).when(repository).lockTarget(b);
        org.mockito.Mockito.doAnswer(afterRealLock).when(accounts).lock(b);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var left=pool.submit(first);
            assertThat(locked.await(5,TimeUnit.SECONDS)).isTrue();
            var right=pool.submit(() -> {secondStarted.countDown();second.run();});
            assertThat(secondStarted.await(5,TimeUnit.SECONDS)).isTrue();
            try {
                assertThatThrownBy(() -> right.get(150,TimeUnit.MILLISECONDS))
                        .isInstanceOf(TimeoutException.class);
            } finally {release.countDown();}
            left.get(5,TimeUnit.SECONDS);right.get(5,TimeUnit.SECONDS);
        } finally {
            release.countDown();org.mockito.Mockito.reset(repository,accounts);
        }
    }

    void parallel(Runnable left, Runnable right) throws Exception {
        var start=new CountDownLatch(1);
        try(var pool=Executors.newFixedThreadPool(2)) {
            var f1=pool.submit(() -> {await(start);left.run();});
            var f2=pool.submit(() -> {await(start);right.run();});
            start.countDown(); f1.get(10,TimeUnit.SECONDS); f2.get(10,TimeUnit.SECONDS);
        }
    }
    static void await(CountDownLatch latch) {
        try {if(!latch.await(5,TimeUnit.SECONDS)) throw new AssertionError("start timeout");}
        catch(InterruptedException ex){Thread.currentThread().interrupt();throw new AssertionError(ex);}
    }
}
