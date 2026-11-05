package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.support.SharedPostgres;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Uses only disposable databases; never reads the developer's environment file. */
class FlywayMigrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.emptyDatabase(FlywayMigrationTest.class);

    private String databaseUrl;

    @BeforeEach
    void createEmptyDatabase() throws Exception {
        databaseUrl = createDatabase();
    }

    private String createDatabase() throws Exception {
        String name = "migration_" + UUID.randomUUID().toString().replace("-", "");
        try (var connection = connect(DATABASE.getJdbcUrl());
                var statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE " + name);
        }
        return DATABASE.getJdbcUrl().replace("/" + DATABASE.getDatabaseName(), "/" + name);
    }

    private Connection connect(String url) throws Exception {
        return DriverManager.getConnection(url, DATABASE.getUsername(), DATABASE.getPassword());
    }

    private Flyway flyway(String location) {
        return Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations(location)
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .load();
    }

    private void execute(String sql) throws Exception {
        try (var connection = connect(databaseUrl);
                var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private int number(String sql) throws Exception {
        try (var connection = connect(databaseUrl);
                var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getInt(1);
        }
    }

    @Test
    void v10AddsPreferencesToPopulatedV9AndPreservesExistingData() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("9")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('prefs_migrate','synthetic','prefmig','2000-01-01','MALE','00000000000','DISAGREE')
                """);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(4);
        assertThat(number("SELECT count(*) FROM users WHERE login_id='prefs_migrate'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM user_recommendation_preferences")).isZero();
        execute(
                """
                INSERT INTO user_recommendation_preferences(user_id)
                SELECT id FROM users WHERE login_id='prefs_migrate'
                """);
        assertThat(
                        number(
                                "SELECT count(*) FROM user_recommendation_preferences WHERE id>0"
                                    + " AND shape='loop' AND flat=false"))
                .isEqualTo(1);
        assertThatThrownBy(
                        () ->
                                execute(
                                        "INSERT INTO user_recommendation_preferences(user_id)"
                                            + " SELECT id FROM users WHERE"
                                            + " login_id='prefs_migrate'"))
                .isInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(
                        () -> execute("UPDATE user_recommendation_preferences SET shape='invalid'"))
                .isInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(() -> execute("UPDATE user_recommendation_preferences SET flat=NULL"))
                .isInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(
                        () ->
                                execute(
                                        "INSERT INTO user_recommendation_preferences(user_id)"
                                            + " VALUES(-1)"))
                .isInstanceOf(java.sql.SQLException.class);
        execute("DELETE FROM users WHERE login_id='prefs_migrate'");
        assertThat(number("SELECT count(*) FROM user_recommendation_preferences")).isZero();
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
    }

    @Test
    void v11AddsRunningSessionUserEndedIndexAndPreservesData() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("10")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('v10_runner','synthetic','v10run','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO running_sessions(user_id,status,started_at,ended_at,total_distance,elapsed_duration,moving_duration)
                SELECT id,'COMPLETED','2026-10-28T01:00:00Z','2026-10-28T01:10:00Z',2000,600,600
                FROM users WHERE login_id='v10_runner';
                INSERT INTO running_sessions(user_id,status,started_at)
                SELECT id,'RUNNING','2026-10-29T01:00:00Z' FROM users WHERE login_id='v10_runner';
                """);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_indexes WHERE"
                                    + " indexname='idx_running_sessions_user_ended'"))
                .isZero();
        assertThat(
                        Flyway.configure()
                                .dataSource(
                                        databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                                .locations("classpath:db/migration")
                                .target("11")
                                .load()
                                .migrate()
                                .migrationsExecuted)
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM running_sessions s JOIN users u ON"
                                    + " s.user_id=u.id WHERE u.login_id='v10_runner' AND"
                                    + " ((s.status='COMPLETED' AND"
                                    + " s.ended_at='2026-10-28T01:10:00Z') OR (s.status='RUNNING'"
                                    + " AND s.ended_at IS NULL))"))
                .isEqualTo(2);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND"
                                    + " tablename='running_sessions' AND"
                                    + " indexname='idx_running_sessions_user_ended' AND indexdef ="
                                    + " 'CREATE INDEX idx_running_sessions_user_ended ON"
                                    + " public.running_sessions USING btree (user_id, ended_at"
                                    + " DESC)'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='11' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(2);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
    }

    @Test
    void v12AddsUserHrPersonalizationAndPreservesExistingData() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("11")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('hr_pers_migrate','synthetic','hrpers','2000-01-01','MALE','00000000000','AGREEE')
                """);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.tables WHERE"
                                    + " table_schema='public' AND"
                                    + " table_name='user_hr_personalization'"))
                .isZero();
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(2);
        assertThat(number("SELECT count(*) FROM users WHERE login_id='hr_pers_migrate'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM user_hr_personalization")).isZero();
        execute(
                """
                INSERT INTO user_hr_personalization(
                    user_id, personalization_version, schema_version, model_version,
                    support_run_count, summary_u_json, history8_json, p4_json, hr0_sub_bpm,
                    hr_danger_bpm, hr_sustain_bpm, hr_threshold_run_count)
                SELECT id, 1, 'runway.ode.personalization.v1', 'ode_test',
                       2, '{}'::jsonb, '[]'::jsonb, '[1,2,3,4]'::jsonb, 85.0,
                       170.0, 150.0, 2
                FROM users WHERE login_id='hr_pers_migrate'
                """);
        assertThat(
                        number(
                                "SELECT count(*) FROM user_hr_personalization WHERE"
                                    + " personalization_version=1 AND hr0_sub_bpm=85"))
                .isEqualTo(1);
        assertThatThrownBy(
                        () ->
                                execute(
                                        """
                                        INSERT INTO user_hr_personalization(
                                            user_id, personalization_version, schema_version,
                                            model_version, support_run_count, summary_u_json,
                                            history8_json, p4_json, hr0_sub_bpm)
                                        SELECT id, 1, 'runway.ode.personalization.v1', 'ode_test',
                                               1, '{}'::jsonb, '[]'::jsonb, '[1,2,3,4]'::jsonb, 85
                                        FROM users WHERE login_id='hr_pers_migrate'
                                        """))
                .isInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(
                        () ->
                                execute(
                                        "UPDATE user_hr_personalization SET hr0_sub_bpm=10 WHERE"
                                            + " personalization_version=1"))
                .isInstanceOf(java.sql.SQLException.class);
        assertThatThrownBy(
                        () ->
                                execute(
                                        "UPDATE user_hr_personalization SET"
                                            + " hr_threshold_run_count=21 WHERE"
                                            + " personalization_version=1"))
                .isInstanceOf(java.sql.SQLException.class);
        execute("DELETE FROM users WHERE login_id='hr_pers_migrate'");
        assertThat(number("SELECT count(*) FROM user_hr_personalization")).isZero();
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='12' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
    }

    /** V13 인덱스가 정의대로 있는지(S15P31E105-421). */
    private static final String METRIC_SAMPLES_INDEX =
            "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND"
                    + " tablename='running_metric_samples' AND"
                    + " indexname='idx_running_metric_samples_session_elapsed' AND indexdef ="
                    + " 'CREATE INDEX idx_running_metric_samples_session_elapsed ON"
                    + " public.running_metric_samples USING btree (running_session_id,"
                    + " elapsed_duration)'";

    @Test
    void v13AddsRunningMetricSamplesSessionElapsedIndexAndPreservesData() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("12")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('v12_runner','synthetic','v12run','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO running_sessions(user_id,status,started_at)
                SELECT id,'RUNNING','2026-10-29T01:00:00Z' FROM users WHERE login_id='v12_runner';
                INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,heart_rate,speed,is_hr_measured)
                SELECT s.id,'2026-10-29T01:00:05Z',5,140,2.5,true
                FROM running_sessions s JOIN users u ON s.user_id=u.id WHERE u.login_id='v12_runner';
                """);
        assertThat(number(METRIC_SAMPLES_INDEX)).isZero();
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM running_metric_samples m JOIN running_sessions s ON"
                                    + " m.running_session_id=s.id JOIN users u ON s.user_id=u.id"
                                    + " WHERE u.login_id='v12_runner' AND m.elapsed_duration=5 AND"
                                    + " m.heart_rate=140"))
                .isEqualTo(1);
        assertThat(number(METRIC_SAMPLES_INDEX)).isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='13' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
    }

    @Test
    void firstMigrationAndReapplicationPreserveData() throws Exception {
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(13);
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('migration_runner','synthetic-hash','runner','2000-01-01','MALE','00000000000','AGREEE')
                """);
        // A fresh Flyway instance models another application startup against the same DB.
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
        assertThat(number("SELECT count(*) FROM users WHERE login_id='migration_runner'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM flyway_schema_history")).isEqualTo(13);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='1' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='2' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='4' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='5' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='6' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='7' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='8' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='9' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='11' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='12' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='13' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(number(METRIC_SAMPLES_INDEX)).isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_indexes WHERE schemaname='public' AND"
                                    + " tablename='running_sessions' AND"
                                    + " indexname='idx_running_sessions_user_ended' AND indexdef ="
                                    + " 'CREATE INDEX idx_running_sessions_user_ended ON"
                                    + " public.running_sessions USING btree (user_id, ended_at"
                                    + " DESC)'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='running_session_splits'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                    + " table_schema='public' AND table_name='group_run_participants'"
                                    + " AND column_name='ready' AND data_type='boolean'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM regions")).isGreaterThan(0);
    }

    @Test
    void nonEmptyDatabaseWithoutHistoryIsRejectedWithoutLosingData() throws Exception {
        execute(
                "CREATE TABLE existing_data (value integer); INSERT INTO existing_data VALUES"
                    + " (42)");
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class)
                .hasMessageContaining("non-empty");
        assertThat(number("SELECT value FROM existing_data")).isEqualTo(42);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='users'"))
                .isZero();
    }

    @Test
    void changedAppliedMigrationIsRejectedWithoutExecutingIt(@TempDir Path directory)
            throws Exception {
        flyway("classpath:db/migration").migrate();
        execute(
                "CREATE TABLE preserved_data (value integer); INSERT INTO preserved_data VALUES"
                    + " (42)");
        String original =
                Files.readString(Path.of("src/main/resources/db/migration/V1__initial_schema.sql"));
        Files.writeString(
                directory.resolve("V1__initial_schema.sql"),
                original + "\nCREATE TABLE checksum_probe (value integer);\n");
        var changed =
                flyway("filesystem:" + directory.toAbsolutePath().toString().replace('\\', '/'));
        var validation = changed.validateWithResult();
        assertThat(validation.validationSuccessful).isFalse();
        assertThat(validation.invalidMigrations).isNotEmpty();
        assertThatThrownBy(changed::migrate).isInstanceOf(FlywayException.class);
        assertThat(number("SELECT value FROM preserved_data")).isEqualTo(42);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='1' AND"
                                    + " success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='checksum_probe'"))
                .isZero();
    }

    @Test
    void failedTransactionalMigrationDoesNotLeavePartialTables(@TempDir Path directory)
            throws Exception {
        Files.writeString(
                directory.resolve("V1__invalid.sql"),
                "CREATE TABLE partial_table (value integer);\nSELECT * FROM missing_relation;\n");
        assertThatThrownBy(
                        () ->
                                flyway(
                                                "filesystem:"
                                                        + directory
                                                                .toAbsolutePath()
                                                                .toString()
                                                                .replace('\\', '/'))
                                        .migrate())
                .isInstanceOf(FlywayException.class);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='partial_table'"))
                .isZero();
        assertThat(number("SELECT count(*) FROM flyway_schema_history WHERE success")).isZero();
    }

    private void installV1WithBatch(String batchId) throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("1")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('uuid_runner','synthetic','runner','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'WATCH',now() FROM users;
                INSERT INTO sync_batches(client_batch_id,device_id,payload_version,payload_hash,status,committed_at)
                SELECT '%s',id,'1','synthetic-hash','COMMITTED',now() FROM user_devices;
                """
                        .formatted(batchId));
    }

    @Test
    void v3ConvertsExistingBatchUuidWithoutLosingData() throws Exception {
        installV1WithBatch("ABCDEFAB-0000-4000-8000-000000000101");
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(12);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                    + " table_schema='public' AND table_name='sync_batches' AND"
                                    + " column_name='client_batch_id' AND data_type='uuid'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM sync_batches WHERE"
                                    + " client_batch_id='abcdefab-0000-4000-8000-000000000101'::uuid"
                                    + " AND payload_hash='synthetic-hash' AND status='COMMITTED'"
                                    + " AND committed_at IS NOT NULL"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='running_session_splits'"))
                .isEqualTo(1);
    }

    @Test
    void equivalentLegacyUuidSpellingsAbortWithoutDeletingBatches() throws Exception {
        installV1WithBatch("ABCDEFAB-0000-4000-8000-000000000101");
        execute(
                """
                INSERT INTO sync_batches(client_batch_id,device_id,payload_version,payload_hash)
                SELECT 'abcdefab-0000-4000-8000-000000000101',id,'1','another-synthetic-hash' FROM user_devices
                """);
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class);
        assertThat(number("SELECT count(*) FROM sync_batches")).isEqualTo(2);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                    + " table_schema='public' AND table_name='sync_batches' AND"
                                    + " column_name='client_batch_id' AND data_type='character"
                                    + " varying'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM flyway_schema_history WHERE version='3'")).isZero();
    }

    @Test
    void invalidLegacyBatchUuidRollsBackEntireV3() throws Exception {
        installV1WithBatch("legacy-not-a-uuid");
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class);
        assertThat(
                        number(
                                "SELECT count(*) FROM sync_batches WHERE"
                                    + " client_batch_id='legacy-not-a-uuid' AND"
                                    + " status='COMMITTED'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                    + " table_schema='public' AND table_name='sync_batches' AND"
                                    + " column_name='client_batch_id' AND data_type='character"
                                    + " varying'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE"
                                    + " table_schema='public' AND table_name='running_sessions' AND"
                                    + " column_name='state_version'"))
                .isZero();
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='session_control_events'"))
                .isZero();
        assertThat(number("SELECT count(*) FROM flyway_schema_history WHERE version='3'")).isZero();
    }

    @Test
    void installedSchemaMatchesReferenceIncludingConstraintsAndTriggers() throws Exception {
        flyway("classpath:db/migration").migrate();
        String referenceUrl = createDatabase();
        try (var connection = connect(referenceUrl);
                var statement = connection.createStatement()) {
            var sql = Files.readString(Path.of("..", "docs/design/db/schema.sql"));
            statement.execute(sql.startsWith("\uFEFF") ? sql.substring(1) : sql);
        }
        assertThat(snapshot(databaseUrl)).containsExactlyElementsOf(snapshot(referenceUrl));
    }

    @Test
    void v3UpgradesPopulatedV1WithoutChangingLegacyCoaching() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("1")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('v1_runner','synthetic','runner','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO running_sessions(user_id,status,started_at,ended_at,total_distance,elapsed_duration,moving_duration) SELECT id,'COMPLETED','2026-10-28T01:00:00Z','2026-10-28T01:10:00Z',2000,600,600 FROM users WHERE login_id='v1_runner';
                INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace,cue_bpm)
                SELECT id,10,300,160 FROM running_sessions;
                """);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(12);
        assertThat(
                        number(
                                "SELECT count(*) FROM coaching_decisions WHERE cue_bpm=160 AND"
                                    + " based_on_state_version IS NULL AND expires_at IS NULL"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM running_sessions WHERE state_version=0 AND"
                                    + " current_bpm IS NULL AND analysis_status='LEGACY' AND"
                                    + " status='COMPLETED' AND total_distance=2000 AND"
                                    + " elapsed_duration=600"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version IN"
                                    + " ('1','2','3','4','5','6','7') AND success"))
                .isEqualTo(7);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
        assertThatThrownBy(
                        () ->
                                execute(
                                        "UPDATE running_sessions SET status='RUNNING' WHERE"
                                            + " state_version=0"))
                .isInstanceOf(java.sql.SQLException.class);
        execute(
                "INSERT INTO running_sessions(user_id,status) SELECT id,'RUNNING' FROM users WHERE"
                    + " login_id='v1_runner'");
        assertThat(
                        number(
                                "SELECT count(*) FROM running_sessions WHERE status='RUNNING' AND"
                                    + " state_version=1 AND analysis_status='PENDING'"))
                .isEqualTo(1);
    }

    @Test
    void v3RejectsActiveV1WorkoutWithoutChangingItsStateOrTimestamp() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("1")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('active_v1','synthetic','runner','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO running_sessions(user_id,status,started_at)
                SELECT id,'RUNNING','2026-10-28T01:00:00Z' FROM users WHERE login_id='active_v1';
                """);
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class)
                .hasMessageContaining("active V1 sessions");
        assertThat(
                        number(
                                "SELECT count(*) FROM running_sessions WHERE status='RUNNING' AND"
                                    + " started_at='2026-10-28T01:00:00Z' AND ended_at IS NULL"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                    + " tablename='session_control_events'"))
                .isZero();
    }

    @Test
    void v9AddsRhrRevisionWithoutChangingExistingHealthMetrics() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("8")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('v8_health','synthetic','health','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO daily_health_metrics(user_id,metric_date,rhr_bpm,sleep_duration_min)
                SELECT id,'2026-10-30',58.4,420 FROM users WHERE login_id='v8_health';
                """);
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(5);
        assertThat(
                        number(
                                "SELECT count(*) FROM daily_health_metrics WHERE rhr_bpm=58.4 AND"
                                    + " sleep_duration_min=420 AND rhr_revision IS NULL"))
                .isEqualTo(1);
        execute("UPDATE daily_health_metrics SET rhr_revision=1");
        assertThatThrownBy(() -> execute("UPDATE daily_health_metrics SET rhr_revision=0"))
                .isInstanceOf(java.sql.SQLException.class)
                .extracting(e -> ((java.sql.SQLException) e).getSQLState())
                .isEqualTo("23514");
        assertThat(number("SELECT count(*) FROM daily_health_metrics WHERE rhr_revision=1"))
                .isEqualTo(1);
    }

    private void migrateThroughV3() {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("3")
                .baselineOnMigrate(false)
                .cleanDisabled(true)
                .load()
                .migrate();
    }

    @Test
    void signupMigrationPreservesExistingMembersAndEnforcesNicknameUniqueness() throws Exception {
        migrateThroughV3();
        execute(
                "INSERT INTO"
                    + " users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)"
                    + " VALUES"
                    + " ('before_signup','hash','before','2000-01-01','MALE','01012345678','DISAGREE')");
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(10);
        assertThat(number("SELECT count(*) FROM users WHERE login_id='before_signup'"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname=\'public\' AND"
                                        + " tablename=\'user_consent_events\'"))
                .isZero();
        assertThatThrownBy(
                        () ->
                                execute(
                                        "INSERT INTO"
                                            + " users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)"
                                            + " VALUES"
                                            + " ('after_signup','hash','before','2000-01-01','MALE','01012345678','DISAGREE')"))
                .isInstanceOf(java.sql.SQLException.class);
        assertThat(number("SELECT count(*) FROM users")).isEqualTo(1);
    }

    @Test
    void signupMigrationRefusesDuplicateNicknamesWithoutChangingExistingData() throws Exception {
        migrateThroughV3();
        execute(
                "INSERT INTO"
                    + " users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)"
                    + " VALUES"
                    + " ('before_a','hash','duplicate','2000-01-01','MALE','01012345678','DISAGREE'),"
                    + "('before_b','hash','duplicate','2000-01-01','MALE','01012345678','DISAGREE')");
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class);
        assertThat(number("SELECT count(*) FROM users WHERE nickname='duplicate'")).isEqualTo(2);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                        + " tablename='user_consent_events'"))
                .isZero();
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='4' AND"
                                        + " success"))
                .isZero();
    }

    @Test
    void v5AllowsOneLinkedDevicePerUserAndType() throws Exception {
        flyway("classpath:db/migration").migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('device_runner','synthetic','runner','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO user_devices(user_id,device_type,linked_at,unlinked_at)
                SELECT id,'WATCH',now(),now() FROM users;
                INSERT INTO user_devices(user_id,device_type,linked_at,unlinked_at)
                SELECT id,'WATCH',now(),now() FROM users;
                INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'WATCH',now() FROM users;
                INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'PHONE',now() FROM users;
                """);
        assertThatThrownBy(
                        () ->
                                execute(
                                        "INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'WATCH',now() FROM users"))
                .isInstanceOf(java.sql.SQLException.class)
                .hasMessageContaining("uq_user_devices_active");
        assertThat(number("SELECT count(*) FROM user_devices")).isEqualTo(4);
    }

    @Test
    void v5RejectsDuplicateLinkedDevicesWithoutChangingThem() throws Exception {
        Flyway.configure()
                .dataSource(databaseUrl, DATABASE.getUsername(), DATABASE.getPassword())
                .locations("classpath:db/migration")
                .target("4")
                .load()
                .migrate();
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('duplicate_runner','synthetic','runner','2000-01-01','MALE','00000000000','AGREEE');
                INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'WATCH',now() FROM users;
                INSERT INTO user_devices(user_id,device_type,linked_at) SELECT id,'WATCH',now() FROM users;
                """);
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class);
        assertThat(number("SELECT count(*) FROM user_devices WHERE unlinked_at IS NULL"))
                .isEqualTo(2);
        assertThat(number("SELECT count(*) FROM pg_indexes WHERE indexname='uq_user_devices_active'"))
                .isZero();
        assertThat(number("SELECT count(*) FROM flyway_schema_history WHERE version='5'")).isZero();
    }

    private List<String> snapshot(String url) throws Exception {
        List<String> definitions = new ArrayList<>();
        // Compare actual PostgreSQL definitions, not formatting of the input SQL files.
        String sql =
                """
                SELECT 'column:' || table_name || ':' || column_name || ':' || ordinal_position || ':' ||
                       udt_name || ':' || is_nullable || ':' || coalesce(column_default,'') || ':' ||
                       coalesce(character_maximum_length::text,'') || ':' || coalesce(numeric_precision::text,'') || ':' ||
                       coalesce(numeric_scale::text,'') || ':' || coalesce(identity_generation,'') AS definition
                FROM information_schema.columns
                WHERE table_schema='public' AND table_name <> 'flyway_schema_history'
                UNION ALL
                SELECT 'type:' || c.relname || ':' || a.attname || ':' || format_type(a.atttypid,a.atttypmod)
                FROM pg_attribute a JOIN pg_class c ON a.attrelid=c.oid
                JOIN pg_namespace n ON c.relnamespace=n.oid
                WHERE n.nspname='public' AND c.relkind IN ('r','v') AND a.attnum>0 AND NOT a.attisdropped
                  AND c.relname <> 'flyway_schema_history'
                UNION ALL
                SELECT 'constraint:' || c.relname || ':' || con.conname || ':' || pg_get_constraintdef(con.oid)
                FROM pg_constraint con JOIN pg_class c ON con.conrelid=c.oid
                JOIN pg_namespace n ON c.relnamespace=n.oid
                WHERE n.nspname='public' AND c.relname <> 'flyway_schema_history'
                UNION ALL
                SELECT 'enum:' || t.typname || ':' || e.enumsortorder || ':' || e.enumlabel
                FROM pg_enum e JOIN pg_type t ON e.enumtypid=t.oid
                JOIN pg_namespace n ON t.typnamespace=n.oid WHERE n.nspname='public'
                UNION ALL
                SELECT 'index:' || tablename || ':' || indexdef FROM pg_indexes
                WHERE schemaname='public' AND tablename <> 'flyway_schema_history'
                UNION ALL
                SELECT 'trigger:' || pg_get_triggerdef(t.oid) FROM pg_trigger t
                JOIN pg_class c ON t.tgrelid=c.oid JOIN pg_namespace n ON c.relnamespace=n.oid
                WHERE n.nspname='public' AND NOT t.tgisinternal
                UNION ALL
                SELECT 'function:' || pg_get_functiondef(p.oid) FROM pg_proc p
                JOIN pg_namespace n ON p.pronamespace=n.oid
                WHERE n.nspname='public' AND p.proname='set_updated_at'
                ORDER BY definition
                """;
        try (var connection = connect(url);
                var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            while (result.next()) {
                definitions.add(
                        result.getString(1)
                                .replace("\r", "")
                                .lines()
                                .map(String::strip)
                                .collect(java.util.stream.Collectors.joining("\n")));
            }
        }
        assertThat(definitions).isNotEmpty();
        return definitions;
    }
}
