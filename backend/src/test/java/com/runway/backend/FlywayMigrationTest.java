package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

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
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isEqualTo(1);
        execute(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('migration_runner','synthetic-hash','runner','2000-01-01','MALE','00000000000','AGREEE')
                """);
        // A fresh Flyway instance models another application startup against the same DB.
        assertThat(flyway("classpath:db/migration").migrate().migrationsExecuted).isZero();
        assertThat(number("SELECT count(*) FROM users WHERE login_id='migration_runner'"))
                .isEqualTo(1);
        assertThat(number("SELECT count(*) FROM flyway_schema_history")).isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM flyway_schema_history WHERE version='1' AND success"))
                .isEqualTo(1);
    }

    @Test
    void nonEmptyDatabaseWithoutHistoryIsRejectedWithoutLosingData() throws Exception {
        execute(
                "CREATE TABLE existing_data (value integer); INSERT INTO existing_data VALUES (42)");
        assertThatThrownBy(() -> flyway("classpath:db/migration").migrate())
                .isInstanceOf(FlywayException.class)
                .hasMessageContaining("non-empty");
        assertThat(number("SELECT value FROM existing_data")).isEqualTo(42);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='users'"))
                .isZero();
    }

    @Test
    void changedAppliedMigrationIsRejectedWithoutExecutingIt(@TempDir Path directory)
            throws Exception {
        flyway("classpath:db/migration").migrate();
        execute(
                "CREATE TABLE preserved_data (value integer); INSERT INTO preserved_data VALUES (42)");
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
                                "SELECT count(*) FROM flyway_schema_history WHERE version='1' AND success"))
                .isEqualTo(1);
        assertThat(
                        number(
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='checksum_probe'"))
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
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='partial_table'"))
                .isZero();
        assertThat(number("SELECT count(*) FROM flyway_schema_history WHERE success")).isZero();
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
