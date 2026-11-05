package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.image.ImageStorage;
import com.runway.backend.domain.user.service.PrivacySettingsService;
import com.runway.backend.domain.user.repository.UserAccountRepository;
import com.runway.backend.domain.user.repository.PrivacySettingsRepository;
import com.runway.backend.global.security.SecurityTestSupport;
import java.io.ByteArrayInputStream;
import java.nio.file.Path;
import java.util.UUID;
import java.util.concurrent.*;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@Testcontainers
class PrivacySettingsApiIntegrationTest {
    @Container static final PostgreSQLContainer DATABASE = new PostgreSQLContainer(
            DockerImageName.parse("postgis/postgis:17-3.6")
                    .asCompatibleSubstituteFor("postgres"));
    @TempDir static Path images;
    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.images.volume-path", () -> images.toString());
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired PrivacySettingsService service;
    @Autowired UserAccountRepository accounts;
    @Autowired PrivacySettingsRepository privacy;
    @Autowired PlatformTransactionManager transactions;
    @Autowired ImageStorage storage;
    @MockitoSpyBean AccountVisibilityRepository visibility;
    static final String URL = "/api/v1/users/me/privacy-settings";
    long owner;
    long viewer;
    long outsider;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM posts");
        jdbc.update("DELETE FROM running_sessions");
        jdbc.update("DELETE FROM crew_memberships");
        jdbc.update("DELETE FROM crews");
        jdbc.update("DELETE FROM user_follows");
        jdbc.update("DELETE FROM user_settings");
        jdbc.update("DELETE FROM users");
        owner = user("privowner");
        viewer = user("privviewer");
        outsider = user("privother");
    }

    long user(String name) {
        long id = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '01012345678', 'DISAGREE') RETURNING id
                """, Long.class, name, name);
        signup.insertSettings(id);
        return id;
    }

    void follow(long follower, long target, boolean approved) {
        jdbc.update("INSERT INTO user_follows(follower_id,followee_id,is_approved) VALUES (?,?,?)",
                follower, target, approved);
    }

    @Test
    void readsAndChangesOnlyOwnVisibilityAndKeepsAppSettings() throws Exception {
        mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.isPrivate").value(true));
        mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"isPrivate\":false}"))
                .andExpect(status().isOk()).andExpect(jsonPath("$.isPrivate").value(false))
                .andExpect(jsonPath("$.updatedAt").isNotEmpty());
        assertThat(service.read(viewer).isPrivate()).isTrue();
        assertThat(jdbc.queryForObject("SELECT voice_coaching_enabled FROM user_settings WHERE user_id=?",
                Boolean.class, owner)).isFalse();
        mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"isPrivate\":false,\"userId\":" + viewer + "}"))
                .andExpect(status().isUnprocessableContent());
    }

    @Test
    void authenticationAndMissingSettingsFailClosed() throws Exception {
        mvc.perform(get(URL)).andExpect(status().isUnauthorized());
        mvc.perform(patch(URL).contentType(MediaType.APPLICATION_JSON)
                .content("{\"isPrivate\":false}")).andExpect(status().isUnauthorized());
        jdbc.update("DELETE FROM user_settings WHERE user_id=?", owner);
        mvc.perform(get(URL).header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isServiceUnavailable());
        mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                .contentType(MediaType.APPLICATION_JSON).content("{\"isPrivate\":false}"))
                .andExpect(status().isServiceUnavailable());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_settings WHERE user_id=?",
                Integer.class, owner)).isZero();
    }

    @ParameterizedTest
    @ValueSource(strings = {"{", "{}", "[]", "null", "{} {}",
            "{\"isPrivate\":true,\"isPrivate\":false}"})
    void malformedOrMissingValueIs400(String body) throws Exception {
        mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        assertThat(service.read(owner).isPrivate()).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"null", "\"false\"", "0", "[]", "{}"})
    void wrongVisibilityTypeIs422(String value) throws Exception {
        mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                .contentType(MediaType.APPLICATION_JSON).content("{\"isPrivate\":" + value + "}"))
                .andExpect(status().isUnprocessableContent())
                .andExpect(jsonPath("$.code").value("INVALID_VISIBILITY"));
    }

    @Test
    void approvesCurrentPendingOnlyAndRepeatsWithoutDuplicateOrTimestampChange() {
        follow(viewer, owner, false);
        follow(user("privextra"), owner, false);
        follow(outsider, owner, true);
        follow(owner, viewer, false);
        var first = service.update(owner, false);
        var repeat = service.update(owner, false);
        assertThat(repeat).isEqualTo(first);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE followee_id=? AND is_approved",
                Integer.class, owner)).isEqualTo(3);
        assertThat(jdbc.queryForObject("SELECT is_approved FROM user_follows WHERE follower_id=? AND followee_id=?",
                Boolean.class, owner, viewer)).isFalse();
        service.update(owner, true);
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE followee_id=? AND is_approved",
                Integer.class, owner)).isEqualTo(3);
    }

    @Test
    void failedApprovalRollsBackVisibilityAndAllRelationships() {
        follow(viewer, owner, false);
        jdbc.execute("""
                CREATE FUNCTION privacy_test_fail() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN RAISE EXCEPTION 'synthetic failure'; END; $$
                """);
        jdbc.execute("CREATE TRIGGER privacy_test_fail BEFORE UPDATE ON user_follows"
                + " FOR EACH ROW EXECUTE FUNCTION privacy_test_fail()");
        try {
            assertThatThrownBy(() -> service.update(owner, false))
                    .isInstanceOf(org.springframework.dao.DataAccessException.class);
            assertThat(service.read(owner).isPrivate()).isTrue();
            assertThat(jdbc.queryForObject("SELECT is_approved FROM user_follows WHERE follower_id=? AND followee_id=?",
                    Boolean.class, viewer, owner)).isFalse();
        } finally {
            jdbc.execute("DROP TRIGGER privacy_test_fail ON user_follows");
            jdbc.execute("DROP FUNCTION privacy_test_fail()");
        }
    }

    // Uses the U22/U23 shared lock contract; those HTTP endpoints belong to Jira 249.
    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void concurrentCancellationAndPublicationNeverResurrectRelationship(boolean cancelFirst) throws Exception {
        follow(viewer, owner, false);
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                accounts.lock(owner);
                privacy.lock(owner);
                if (cancelFirst) {
                    jdbc.update("DELETE FROM user_follows WHERE follower_id=? AND followee_id=?", viewer, owner);
                } else {
                    service.update(owner, false);
                }
                locked.countDown();
                await(release);
            }));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                var second = pool.submit(() -> {
                    if (cancelFirst) {
                        service.update(owner, false);
                    } else {
                        new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                            accounts.lock(owner);
                            privacy.lock(owner);
                            jdbc.update("DELETE FROM user_follows WHERE follower_id=? AND followee_id=?", viewer, owner);
                        });
                    }
                });
                waitForBlockedConnection();
                release.countDown();
                first.get(10, TimeUnit.SECONDS);
                second.get(10, TimeUnit.SECONDS);
            } finally {
                release.countDown();
            }
        }
        assertThat(service.read(owner).isPrivate()).isFalse();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM user_follows WHERE followee_id=?",
                Integer.class, owner)).isZero();
    }

    void waitForBlockedConnection() throws Exception {
        long end = System.nanoTime() + TimeUnit.SECONDS.toNanos(1);
        while (System.nanoTime() < end) {
            int blocked = jdbc.queryForObject("SELECT count(*) FROM pg_stat_activity"
                    + " WHERE datname=current_database() AND wait_event_type='Lock'", Integer.class);
            if (blocked > 0) return;
            Thread.sleep(10);
        }
        throw new AssertionError("Expected a real DB lock wait");
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void concurrentNewFollowUsesVisibilityAfterSerialization(boolean publishFirst) throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        Runnable create = () -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
            accounts.lock(owner);
            boolean isPrivate = privacy.lock(owner).orElseThrow().isPrivate();
            follow(viewer, owner, !isPrivate);
        });
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                accounts.lock(owner);
                privacy.lock(owner);
                if (publishFirst) service.update(owner, false);
                else create.run();
                locked.countDown();
                await(release);
            }));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                var second = pool.submit(() -> {
                    if (publishFirst) create.run();
                    else service.update(owner, false);
                });
                waitForBlockedConnection();
                release.countDown();
                first.get(10, TimeUnit.SECONDS);
                second.get(10, TimeUnit.SECONDS);
            } finally {
                release.countDown();
            }
        }
        assertThat(jdbc.queryForObject("SELECT is_approved FROM user_follows WHERE follower_id=? AND followee_id=?",
                Boolean.class, viewer, owner)).isTrue();
        assertThat(service.read(owner).isPrivate()).isFalse();
    }

    @Test
    void lockTimeoutReturns503WithoutPublishing() throws Exception {
        CountDownLatch locked = new CountDownLatch(1);
        CountDownLatch release = new CountDownLatch(1);
        try (var pool = Executors.newSingleThreadExecutor()) {
            var holder = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                accounts.lock(owner);
                locked.countDown();
                await(release);
            }));
            try {
                assertThat(locked.await(5, TimeUnit.SECONDS)).isTrue();
                mvc.perform(patch(URL).header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON).content("{\"isPrivate\":false}"))
                        .andExpect(status().isServiceUnavailable())
                        .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
            } finally {
                release.countDown();
            }
            holder.get(10, TimeUnit.SECONDS);
        }
        assertThat(service.read(owner).isPrivate()).isTrue();
    }

    static void await(CountDownLatch latch) {
        try {
            if (!latch.await(5, TimeUnit.SECONDS)) throw new AssertionError("Latch timeout");
        } catch (InterruptedException ex) {
            Thread.currentThread().interrupt();
            throw new AssertionError(ex);
        }
    }

    String image(String purpose) {
        String id = UUID.randomUUID().toString();
        byte[] bytes = {1, 2, 3};
        storage.store("images/" + purpose + "/" + owner + "/" + id + ".png",
                new ByteArrayInputStream(bytes), bytes.length);
        storage.store("images/by-id/" + id + ".png", new ByteArrayInputStream(bytes), bytes.length);
        return id;
    }

    @Test
    void currentProfileIsVisibleButUnlinkedAndReplacedProfileAreOwnerOnly() throws Exception {
        String old = image("profile");
        String url = "/api/v1/images/" + old;
        mvc.perform(get(url)).andExpect(status().isNotFound());
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk()).andExpect(header().string("Cache-Control", "no-store"));
        jdbc.update("UPDATE users SET profile_image_key=? WHERE id=?",
                "images/profile/" + owner + "/" + old + ".png", owner);
        mvc.perform(get(url)).andExpect(status().isOk());
        mvc.perform(get(url).header("Authorization", "Bearer invalid"))
                .andExpect(status().isUnauthorized());
        jdbc.update("UPDATE users SET profile_image_key=NULL WHERE id=?", owner);
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isNotFound());
        mvc.perform(head(url)).andExpect(status().isNotFound());
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
    }

    @Test
    void postImageAndFeedTrackPendingApprovalRevocationAndVisibility() throws Exception {
        String id = image("post");
        long session = jdbc.queryForObject("INSERT INTO running_sessions(user_id,status)"
                + " VALUES (?,'COMPLETED') RETURNING id", Long.class, owner);
        long post = jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body,image_key)"
                + " VALUES (?,?,'synthetic',?) RETURNING id", Long.class,
                owner, session, "images/post/" + owner + "/" + id + ".png");
        String url = "/api/v1/images/" + id;
        follow(viewer, owner, false);
        follow(owner, outsider, true); // Reverse approval gives outsider no access.
        for (long denied : new long[] {viewer, outsider}) {
            mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(denied)))
                    .andExpect(status().isNotFound());
            mvc.perform(get("/api/v1/posts/" + post).header("Authorization", SecurityTestSupport.bearer(denied)))
                    .andExpect(status().isForbidden());
        }
        service.update(owner, false);
        mvc.perform(get(url)).andExpect(status().isOk());
        service.update(owner, true);
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk());
        jdbc.update("DELETE FROM user_follows WHERE follower_id=? AND followee_id=?", viewer, owner);
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(viewer))
                .header("If-None-Match", "*"))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/posts/" + post).header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/posts").header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
        mvc.perform(get(url).header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
    }

    @Test
    void crewImageReferenceSurvivesOwnershipTransfer() throws Exception {
        String id = image("crew");
        long crew = jdbc.queryForObject("INSERT INTO crews(owner_id,name,capacity,image_key)"
                + " VALUES (?,'synthetic crew',10,?) RETURNING id", Long.class,
                owner, "images/crew/" + owner + "/" + id + ".png");
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isOk());
        jdbc.update("UPDATE crews SET owner_id=? WHERE id=?", viewer, crew);
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isOk());
        mvc.perform(get("/api/v1/images/" + id)
                .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void concurrentContentReadUsesCommittedVisibilityAndApproval(boolean changeVisibility) throws Exception {
        String id = image("post");
        long session = jdbc.queryForObject("INSERT INTO running_sessions(user_id,status)"
                + " VALUES (?,'COMPLETED') RETURNING id", Long.class, owner);
        long post = jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body,image_key)"
                + " VALUES (?,?,'synthetic',?) RETURNING id", Long.class,
                owner, session, "images/post/" + owner + "/" + id + ".png");
        if (changeVisibility) service.update(owner, false);
        else follow(viewer, owner, true);
        CountDownLatch changed = new CountDownLatch(1);
        CountDownLatch commit = new CountDownLatch(1);
        try (var pool = Executors.newSingleThreadExecutor()) {
            var writer = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                accounts.lock(owner);
                privacy.lock(owner);
                if (changeVisibility) privacy.update(owner, true);
                else jdbc.update("DELETE FROM user_follows WHERE follower_id=? AND followee_id=?", viewer, owner);
                changed.countDown();
                await(commit);
            }));
            try {
                assertThat(changed.await(5, TimeUnit.SECONDS)).isTrue();
                // Uncommitted revocation cannot change a reader's statement snapshot.
                mvc.perform(get("/api/v1/images/" + id)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                        .andExpect(status().isOk());
                mvc.perform(get("/api/v1/posts/" + post)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                        .andExpect(status().isOk());
                mvc.perform(get("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                        .andExpect(status().isOk()).andExpect(jsonPath("$.items.length()").value(1));
            } finally {
                commit.countDown();
            }
            writer.get(10, TimeUnit.SECONDS);
        }
        mvc.perform(get("/api/v1/images/" + id)
                .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/posts/" + post)
                .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isForbidden());
        mvc.perform(get("/api/v1/posts")
                .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.items").isEmpty());
    }

    @ParameterizedTest
    @CsvSource({"true,true", "true,false", "false,true", "false,false"})
    void detailPermissionQueryOrdersAgainstCommittedRevocation(
            boolean changeVisibility, boolean queryAfterRevocation) throws Exception {
        long session = jdbc.queryForObject("INSERT INTO running_sessions(user_id,status)"
                + " VALUES (?,'COMPLETED') RETURNING id", Long.class, owner);
        long post = jdbc.queryForObject("INSERT INTO posts(author_id,session_id,body)"
                + " VALUES (?,?,'synthetic') RETURNING id", Long.class, owner, session);
        if (changeVisibility) service.update(owner, false);
        else follow(viewer, owner, true);
        CountDownLatch reachedPermissionQuery = new CountDownLatch(1);
        CountDownLatch revoked = new CountDownLatch(1);
        org.mockito.Mockito.doAnswer(invocation -> {
            Object result = null;
            if (!queryAfterRevocation) result = invocation.callRealMethod();
            reachedPermissionQuery.countDown();
            await(revoked);
            return queryAfterRevocation ? invocation.callRealMethod() : result;
        }).when(visibility).canAccess(viewer, owner);
        try (var pool = Executors.newSingleThreadExecutor()) {
            var read = pool.submit(() -> mvc.perform(get("/api/v1/posts/" + post)
                    .header("Authorization", SecurityTestSupport.bearer(viewer)))
                    .andExpect(status().is(queryAfterRevocation ? 403 : 200)));
            try {
                assertThat(reachedPermissionQuery.await(5, TimeUnit.SECONDS)).isTrue();
                // The real post SELECT has finished; only its permission query is paused.
                if (changeVisibility) service.update(owner, true);
                else new TransactionTemplate(transactions).executeWithoutResult(tx -> {
                    accounts.lock(owner);
                    privacy.lock(owner);
                    jdbc.update("DELETE FROM user_follows WHERE follower_id=? AND followee_id=?", viewer, owner);
                });
            } finally {
                revoked.countDown();
            }
            read.get(10, TimeUnit.SECONDS);
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"crew", "profile", "post", "traversal"})
    void forgedPublicReferenceCannotExposeProtectedByIdCopy(String kind) throws Exception {
        String id = image("post");
        String fakeKey = "images/" + kind + "/" + outsider + "/" + id + ".png";
        if (kind.equals("traversal")) {
            fakeKey = "images/crew/" + outsider + "/../../post/" + owner + "/" + id + ".png";
        }
        if (kind.equals("profile")) {
            jdbc.update("UPDATE users SET profile_image_key=? WHERE id=?", fakeKey, outsider);
        } else if (kind.equals("post")) {
            service.update(outsider, false);
            long session = jdbc.queryForObject("INSERT INTO running_sessions(user_id,status)"
                    + " VALUES (?,'COMPLETED') RETURNING id", Long.class, outsider);
            jdbc.update("INSERT INTO posts(author_id,session_id,image_key) VALUES (?,?,?)",
                    outsider, session, fakeKey);
        } else {
            jdbc.update("INSERT INTO crews(owner_id,name,capacity,image_key) VALUES (?,'fake crew',10,?)",
                    outsider, fakeKey);
        }
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/images/" + id)
                .header("Authorization", SecurityTestSupport.bearer(outsider)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/images/" + id)
                .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
    }

    @Test
    void byIdCopyCannotOverrideAuthorizedSource() throws Exception {
        String id = image("profile");
        byte[] wrongCopy = {9, 8, 7};
        storage.store("images/by-id/" + id + ".png", new ByteArrayInputStream(wrongCopy), wrongCopy.length);
        jdbc.update("UPDATE users SET profile_image_key=? WHERE id=?",
                "images/profile/" + owner + "/" + id + ".png", owner);
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isOk())
                .andExpect(content().bytes(new byte[] {1, 2, 3}));
    }

    @Test
    void crewCreationCannotStealRealUnlinkedUploadAndOwnCrewImageCanBeLinked() throws Exception {
        String id = image("crew");
        String key = "images/crew/" + owner + "/" + id + ".png";
        String body = "{\"name\":\"synthetic crew\",\"capacity\":10,\"imageKey\":\"" + key + "\"}";
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/crews").header("Authorization", SecurityTestSupport.bearer(outsider))
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_OWNED"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM crews", Integer.class)).isZero();
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isNotFound());
        mvc.perform(post("/api/v1/crews").header("Authorization", SecurityTestSupport.bearer(owner))
                .contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
        mvc.perform(get("/api/v1/images/" + id)).andExpect(status().isOk());
    }

    @ParameterizedTest
    @ValueSource(strings = {"profile", "missing", "traversal", "noncanonical"})
    void crewCreationRejectsWrongPurposeMissingOrMalformedUpload(String kind) throws Exception {
        String id = image("profile");
        String key = switch (kind) {
            case "profile" -> "images/profile/" + owner + "/" + id + ".png";
            case "missing" -> "images/crew/" + owner + "/" + UUID.randomUUID() + ".png";
            case "traversal" -> "images/crew/" + owner + "/../../profile/" + owner + "/" + id + ".png";
            default -> "images/crew/" + owner + "/not-a-uuid.png";
        };
        mvc.perform(post("/api/v1/crews").header("Authorization", SecurityTestSupport.bearer(owner))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"name\":\"synthetic crew\",\"capacity\":10,\"imageKey\":\"" + key + "\"}"))
                .andExpect(status().isForbidden()).andExpect(jsonPath("$.code").value("RESOURCE_NOT_OWNED"));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM crews", Integer.class)).isZero();
    }
}
