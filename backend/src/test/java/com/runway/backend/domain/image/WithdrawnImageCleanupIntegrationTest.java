package com.runway.backend.domain.image;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.dao.DataAccessException;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.support.TransactionTemplate;

@SpringBootTest
@AutoConfigureMockMvc
class WithdrawnImageCleanupIntegrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(WithdrawnImageCleanupIntegrationTest.class);
    @TempDir static Path volume;
    static final byte[] PNG = new byte[] {(byte) 0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A};

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.images.volume-path", volume::toString);
    }

    @Autowired JdbcTemplate jdbc;
    @Autowired ImageService images;
    @Autowired WithdrawnImageCleanup cleanup;
    @Autowired WithdrawnImageCleanupRepository accounts;
    @Autowired PlatformTransactionManager transactions;
    @Autowired MockMvc mvc;
    @MockitoSpyBean VolumeImageStorage storage;
    long user;

    @BeforeEach
    void seed() {
        jdbc.update("DELETE FROM crews");
        jdbc.update("DELETE FROM users");
        user = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('imagecleanup','synthetic','정리회원','2000-01-01','MALE','00000000000','DISAGREE')
                RETURNING id
                """, Long.class);
    }

    MockMultipartFile file() {
        return new MockMultipartFile("file", "synthetic.png", MediaType.IMAGE_PNG_VALUE, PNG);
    }

    void withdraw() {
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?", user);
    }

    Path source(String purpose, String id) {
        return volume.resolve("images/" + purpose + "/" + user + "/" + id + ".png");
    }

    Path copy(String id) {
        return volume.resolve("images/by-id/" + id + ".png");
    }

    @Test
    void uncommittedWithdrawalAndRollbackNeverDeleteFiles() {
        var id = images.upload(user, file(), "PROFILE").imageId();
        assertThat(cleanup.clean(user)).isFalse();
        var tx = new TransactionTemplate(transactions);
        tx.executeWithoutResult(status -> {
            withdraw();
            // REQUIRES_NEW must see the committed ACTIVE row, not this transaction's write.
            assertThat(cleanup.clean(user)).isFalse();
            assertThat(source("profile", id)).exists();
            assertThat(copy(id)).exists();
            status.setRollbackOnly();
        });
        assertThat(jdbc.queryForObject("SELECT account_status::text FROM users WHERE id=?",
                String.class, user)).isEqualTo("ACTIVE");
        assertThat(source("profile", id)).exists();
        assertThat(copy(id)).exists();
    }

    @Test
    void committedWithdrawalBlocksRemainingTokenBeforeCleanupAndNewWorkerRecoversFiles() throws Exception {
        var profile = images.upload(user, file(), "PROFILE").imageId();
        var post = images.upload(user, file(), "POST").imageId();
        var crew = images.upload(user, file(), "CREW").imageId();
        jdbc.update("INSERT INTO crews(owner_id,name,capacity,image_key) VALUES (?, '이양크루', 10, ?)",
                user, "images/crew/" + user + "/" + crew + ".png");
        withdraw();
        // File bytes still exist: access denial cannot rely only on successful deletion.
        assertThat(source("profile", profile)).exists();
        mvc.perform(get("/api/v1/images/" + profile)
                        .header("Authorization", SecurityTestSupport.bearer(user)))
                .andExpect(status().isNotFound());
        mvc.perform(multipart("/api/v1/images").file(file()).param("purpose", "PROFILE")
                        .header("Authorization", SecurityTestSupport.bearer(user)))
                .andExpect(status().isUnauthorized());
        mvc.perform(get("/api/v1/images/" + crew)).andExpect(status().isOk());
        new WithdrawnImageCleanupWorker(accounts, cleanup).retryBatch();
        assertThat(source("profile", profile)).doesNotExist();
        assertThat(copy(profile)).doesNotExist();
        assertThat(source("post", post)).doesNotExist();
        assertThat(copy(post)).doesNotExist();
        assertThat(source("crew", crew)).exists();
        assertThat(copy(crew)).exists();
        assertThat(cleanup.clean(user)).isTrue();
        assertThat(jdbc.queryForObject("SELECT count(*) FROM information_schema.tables"
                + " WHERE table_schema='public' AND table_name='withdrawal_cleanup'", Integer.class)).isZero();
    }

    @Test
    void repositoryPagesDoNotIncludeWithdrawalsBeyondTheCapturedUpperBound() {
        withdraw();
        long upper = accounts.maxWithdrawnId();
        long later = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,
                    health_data_access,account_status,withdrawn_at)
                VALUES ('laterimage','synthetic','후속탈퇴','2000-01-01','MALE','00000000000',
                    'DISAGREE','WITHDRAWN',now()) RETURNING id
                """, Long.class);
        assertThat(later).isGreaterThan(upper);
        assertThat(accounts.findAfter(0, upper, 100)).containsExactly(user);
        assertThat(accounts.findAfter(user, upper, 100)).isEmpty();
        assertThat(accounts.findAfter(0, accounts.maxWithdrawnId(), 100)).containsExactly(user, later);
    }

    @Test
    void uploadFirstHoldsUserLockUntilBothCopiesAreWritten() throws Exception {
        var writing = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        doAnswer(call -> {
            writing.countDown();
            if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("synthetic timeout");
            return call.callRealMethod();
        }).when(storage).store(startsWith("images/profile/"), any(), anyLong());
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var pending = pool.submit(() -> images.upload(user, file(), "PROFILE"));
            try {
                assertThat(writing.await(10, TimeUnit.SECONDS)).isTrue();
                assertThatThrownBy(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                    jdbc.execute("SET LOCAL lock_timeout = '200ms'");
                    withdraw();
                })).isInstanceOf(DataAccessException.class);
            } finally {
                release.countDown();
            }
            var response = pending.get(10, TimeUnit.SECONDS);
            assertThat(source("profile", response.imageId())).exists();
            assertThat(copy(response.imageId())).exists();
            withdraw();
            assertThat(cleanup.clean(user)).isTrue();
            assertThat(source("profile", response.imageId())).doesNotExist();
        }
    }

    @Test
    void withdrawalFirstRejectsWaitingUploadWithoutWritingFiles() throws Exception {
        var locked = new CountDownLatch(1);
        var release = new CountDownLatch(1);
        try (var pool = Executors.newVirtualThreadPerTaskExecutor()) {
            var withdrawal = pool.submit(() -> new TransactionTemplate(transactions).executeWithoutResult(status -> {
                withdraw();
                locked.countDown();
                try {
                    if (!release.await(10, TimeUnit.SECONDS)) throw new IllegalStateException("synthetic timeout");
                } catch (InterruptedException exception) {
                    Thread.currentThread().interrupt();
                    throw new IllegalStateException("synthetic interruption");
                }
            }));
            try {
                assertThat(locked.await(10, TimeUnit.SECONDS)).isTrue();
                var uploading = pool.submit(() -> images.upload(user, file(), "PROFILE"));
                org.awaitility.Awaitility.await().atMost(1, TimeUnit.SECONDS).untilAsserted(() ->
                        assertThat(jdbc.queryForObject("""
                                SELECT count(*) FROM pg_stat_activity
                                WHERE datname=current_database() AND wait_event_type='Lock'
                                """, Integer.class)).isGreaterThan(0));
                release.countDown();
                withdrawal.get(10, TimeUnit.SECONDS);
                assertThatThrownBy(() -> uploading.get(10, TimeUnit.SECONDS))
                        .hasCauseInstanceOf(ApiException.class)
                        .satisfies(error -> assertThat(((ApiException) error.getCause()).code()).isEqualTo("UNAUTHORIZED"));
                verify(storage, never()).store(anyString(), any(), anyLong());
            } finally {
                release.countDown();
            }
        }
    }
}
