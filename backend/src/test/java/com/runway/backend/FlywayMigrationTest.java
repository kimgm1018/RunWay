package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;

/** Uses only disposable databases; never reads the developer's environment file. */
@Testcontainers
class FlywayMigrationTest {
    @Container
    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(
                    DockerImageName.parse("postgis/postgis:17-3.6")
                            .asCompatibleSubstituteFor("postgres"));

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
    void firstMigrationAndReapplicationPreserveData() throws Exception {
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(8);
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('migration_runner','synthetic-hash','runner','2000-01-01','MALE','00000000000','AGREEE')
                """);
        // A fresh Flyway instance models another application startup against the same DB.
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
        assertThat(number("SELECT count(*) FROM users WHERE login_id='migration_runner'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM flyway_schema_history")).isEqualTo(8);
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
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(7);
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
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(7);
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
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(5);
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
