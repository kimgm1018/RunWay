package com.runway.backend.support;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.Test;

/** 격리 단위 DB가 마이그레이션 템플릿에서 복제되고, 빈 DB 요청은 마이그레이션 없이 만들어지는지 확인한다. */
class SharedPostgresTest {

    static final SharedPostgres.Database FIRST =
            SharedPostgres.database(SharedPostgresMigratedFirst.class);
    static final SharedPostgres.Database SECOND =
            SharedPostgres.database(SharedPostgresMigratedSecond.class);
    static final SharedPostgres.Database EMPTY =
            SharedPostgres.emptyDatabase(SharedPostgresEmptyOwner.class);

    @Test
    void 복제DB는_마이그레이션이_모두_적용돼_Flyway가_실행할_것이_없다() {
        Flyway flyway = flyway(FIRST);

        assertThat(flyway.info().pending()).isEmpty();
        assertThat(flyway.info().applied()).isNotEmpty();
        assertThat(flyway.validateWithResult().validationSuccessful).isTrue();
        // Spring 컨텍스트 기동 시와 같은 호출. 템플릿에서 복제했으므로 실행되는 마이그레이션이 없다.
        assertThat(flyway.migrate().migrationsExecuted).isZero();
    }

    @Test
    void 복제DB들은_같은_템플릿의_마이그레이션_기록을_공유한다() throws Exception {
        String history =
                "SELECT string_agg(version || ':' || checksum || ':' || installed_on, ','"
                        + " ORDER BY installed_rank) FROM flyway_schema_history";

        // DB마다 마이그레이션을 따로 실행했다면 적용 시각이 서로 다르다.
        assertThat(text(FIRST, history)).isNotBlank().isEqualTo(text(SECOND, history));
    }

    @Test
    void 복제DB끼리_데이터가_격리된다() throws Exception {
        execute(FIRST, "CREATE TABLE shared_postgres_isolation(id int)");
        try {
            assertThat(
                            number(
                                    SECOND,
                                    "SELECT count(*) FROM pg_tables WHERE"
                                            + " tablename='shared_postgres_isolation'"))
                    .isZero();
        } finally {
            execute(FIRST, "DROP TABLE shared_postgres_isolation");
        }
    }

    @Test
    void 빈DB는_PostGIS만_있고_마이그레이션_기록이_없다() throws Exception {
        assertThat(text(EMPTY, "SELECT postgis_version()")).startsWith("3.6");
        assertThat(
                        number(
                                EMPTY,
                                "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND"
                                        + " tablename NOT IN ('spatial_ref_sys')"))
                .isZero();
        assertThat(flyway(EMPTY).info().applied()).isEmpty();
    }

    @Test
    void 마이그레이션_템플릿은_접속할_수_없는_템플릿으로_고정된다() throws Exception {
        assertThat(
                        text(
                                FIRST,
                                "SELECT datistemplate || ':' || datallowconn FROM pg_database"
                                        + " WHERE datname='"
                                        + SharedPostgres.MIGRATED_TEMPLATE
                                        + "'"))
                .isEqualTo("true:false");
    }

    @Test
    void 같은_격리단위가_다른_종류의_DB를_요청하면_실패한다() {
        assertThatThrownBy(() -> SharedPostgres.emptyDatabase(SharedPostgresMigratedFirst.class))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> SharedPostgres.database(SharedPostgresEmptyOwner.class))
                .isInstanceOf(IllegalStateException.class);
    }

    private static Flyway flyway(SharedPostgres.Database database) {
        return Flyway.configure()
                .dataSource(database.getJdbcUrl(), database.getUsername(), database.getPassword())
                .locations(SharedPostgres.MIGRATION_LOCATION)
                .cleanDisabled(true)
                .baselineOnMigrate(false)
                .load();
    }

    private static Connection connect(SharedPostgres.Database database) throws SQLException {
        return DriverManager.getConnection(
                database.getJdbcUrl(), database.getUsername(), database.getPassword());
    }

    private static void execute(SharedPostgres.Database database, String sql) throws Exception {
        try (var connection = connect(database);
                var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private static String text(SharedPostgres.Database database, String sql) throws Exception {
        try (var connection = connect(database);
                var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getString(1);
        }
    }

    private static long number(SharedPostgres.Database database, String sql) throws Exception {
        try (var connection = connect(database);
                var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getLong(1);
        }
    }

    // 격리 단위 이름은 소유 클래스의 단순 이름에서 오므로 다른 테스트와 겹치지 않는 이름을 쓴다.
    private static final class SharedPostgresMigratedFirst {}

    private static final class SharedPostgresMigratedSecond {}

    private static final class SharedPostgresEmptyOwner {}
}
