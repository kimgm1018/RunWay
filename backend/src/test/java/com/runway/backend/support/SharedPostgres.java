package com.runway.backend.support;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.flywaydb.core.Flyway;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 테스트 JVM 하나가 함께 쓰는 PostGIS 서버. 컨테이너는 처음 요청될 때 한 번만 띄우고 JVM 종료 시 Testcontainers가 정리한다.
 *
 * <p>격리 단위(지원 클래스 또는 단독 테스트 클래스)마다 전용 데이터베이스를 만들어 준다. 데이터 정리 범위와 Spring 컨텍스트 구성은 컨테이너를
 * 따로 띄우던 때와 같고 컨테이너 기동 비용만 줄어든다. 컨테이너를 일시정지·중지하는 장애 테스트는 이 서버를 쓰지 않는다.
 *
 * <p>{@link #database}는 Flyway 마이그레이션을 JVM당 한 번 적용한 템플릿에서 복제하므로 Spring 컨텍스트의 Flyway는 적용 완료 상태를
 * 확인만 한다. 템플릿은 컨테이너와 함께 매 실행 새로 만들어 현재 클래스패스의 마이그레이션만 담는다. 빈 DB부터 마이그레이션·스키마를 검증하는
 * 테스트는 {@link #emptyDatabase}를 쓴다.
 */
public final class SharedPostgres {

    /**
     * 살아 있는 Spring 컨텍스트(캐시 최대 32개) × Hikari 기본 최대 10개와 직접 JDBC 연결 여유. 테스트의 풀 크기나 컨텍스트 캐시
     * 크기를 늘리면 이 값을 다시 계산한다.
     */
    static final int MAX_CONNECTIONS = 400;

    /** 이미지가 준비한 PostGIS 확장 포함 빈 템플릿. */
    static final String EMPTY_TEMPLATE = "template_postgis";

    /** 마이그레이션을 적용한 템플릿. 격리 단위 이름은 클래스 이름에서 오므로 밑줄 접두어로 충돌을 피한다. */
    static final String MIGRATED_TEMPLATE = "_runway_migrated_template";

    static final String MIGRATION_LOCATION = "classpath:db/migration";

    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_]{0,62}");
    private static final Map<String, Database> DATABASES = new ConcurrentHashMap<>();

    private SharedPostgres() {}

    /**
     * 클래스 단순 이름을 소문자로 바꾼 이름의 전용 데이터베이스. 마이그레이션 완료 템플릿에서 복제한다. 다른 클래스가 같은 이름을 요청하면 격리가
     * 깨지므로 실패시킨다.
     */
    public static Database database(Class<?> owner) {
        return database(owner, true);
    }

    /** {@link #database}와 같지만 마이그레이션 전 빈 상태(PostGIS 확장만 있음)로 만든다. */
    public static Database emptyDatabase(Class<?> owner) {
        return database(owner, false);
    }

    private static Database database(Class<?> owner, boolean migrated) {
        String name = owner.getSimpleName().toLowerCase(Locale.ROOT);
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("데이터베이스 이름 형식: " + name);
        }
        Database database = DATABASES.computeIfAbsent(name, key -> create(key, owner, migrated));
        if (database.owner != owner) {
            throw new IllegalStateException(
                    "데이터베이스 이름 충돌: "
                            + name
                            + " ("
                            + database.owner.getName()
                            + ", "
                            + owner.getName()
                            + ")");
        }
        if (database.migrated != migrated) {
            throw new IllegalStateException("같은 격리 단위가 빈 DB와 마이그레이션 DB를 함께 요청했습니다: " + name);
        }
        return database;
    }

    private static Database create(String name, Class<?> owner, boolean migrated) {
        String template = migrated ? MigratedTemplate.NAME : EMPTY_TEMPLATE;
        createFromTemplate(name, template);
        return new Database(Server.INSTANCE, name, owner, migrated);
    }

    private static void createFromTemplate(String name, String template) {
        PostgreSQLContainer server = Server.INSTANCE;
        try (var connection =
                        DriverManager.getConnection(
                                server.getJdbcUrl(), server.getUsername(), server.getPassword());
                var statement = connection.createStatement()) {
            statement.execute("CREATE DATABASE \"" + name + "\" TEMPLATE \"" + template + "\"");
        } catch (SQLException e) {
            throw new IllegalStateException("테스트 데이터베이스 생성 실패: " + name, e);
        }
    }

    private static final class Server {
        static final PostgreSQLContainer INSTANCE = start();

        private static PostgreSQLContainer start() {
            PostgreSQLContainer container =
                    new PostgreSQLContainer(
                                    DockerImageName.parse("postgis/postgis:17-3.6")
                                            .asCompatibleSubstituteFor("postgres"))
                            // fsync=off는 PostgreSQLContainer의 기본 명령이다. 명령을 바꾸므로 다시 지정한다.
                            .withCommand(
                                    "postgres",
                                    "-c",
                                    "fsync=off",
                                    "-c",
                                    "max_connections=" + MAX_CONNECTIONS);
            container.start();
            return container;
        }
    }

    /** 처음 요청될 때 한 번 만든다. 클래스 초기화가 끝나기 전 다른 스레드는 기다리므로 마이그레이션은 JVM당 한 번만 실행된다. */
    private static final class MigratedTemplate {
        static final String NAME = build();

        private static String build() {
            PostgreSQLContainer server = Server.INSTANCE;
            createFromTemplate(MIGRATED_TEMPLATE, EMPTY_TEMPLATE);
            // application.yml의 spring.flyway 설정과 같게 둔다. 다르면 컨텍스트 기동 시 Flyway 검증이 실패한다.
            Flyway.configure()
                    .dataSource(
                            jdbcUrl(server, MIGRATED_TEMPLATE),
                            server.getUsername(),
                            server.getPassword())
                    .locations(MIGRATION_LOCATION)
                    .cleanDisabled(true)
                    .baselineOnMigrate(false)
                    .load()
                    .migrate();
            try (var connection =
                            DriverManager.getConnection(
                                    server.getJdbcUrl(),
                                    server.getUsername(),
                                    server.getPassword());
                    var statement = connection.createStatement()) {
                // 복제 중 접속이 있으면 CREATE DATABASE가 실패하므로 템플릿 접속을 막는다.
                statement.execute(
                        "ALTER DATABASE \""
                                + MIGRATED_TEMPLATE
                                + "\" WITH IS_TEMPLATE true ALLOW_CONNECTIONS false");
            } catch (SQLException e) {
                throw new IllegalStateException("마이그레이션 템플릿 고정 실패", e);
            }
            return MIGRATED_TEMPLATE;
        }
    }

    private static String jdbcUrl(PostgreSQLContainer server, String databaseName) {
        String base = server.getJdbcUrl();
        String marker = "/" + server.getDatabaseName();
        int at = base.indexOf(marker, base.indexOf("//") + 2);
        if (at < 0) {
            throw new IllegalStateException("JDBC URL에서 데이터베이스 이름을 찾지 못했습니다.");
        }
        return base.substring(0, at) + "/" + databaseName + base.substring(at + marker.length());
    }

    /** 전용 데이터베이스 접속 정보. 기존 컨테이너 필드와 같은 이름의 조회 메서드를 둔다. */
    public static final class Database {
        private final String jdbcUrl;
        private final String username;
        private final String password;
        private final String databaseName;
        private final Class<?> owner;
        private final boolean migrated;

        private Database(
                PostgreSQLContainer server, String databaseName, Class<?> owner, boolean migrated) {
            this.owner = owner;
            this.migrated = migrated;
            this.jdbcUrl = SharedPostgres.jdbcUrl(server, databaseName);
            this.username = server.getUsername();
            this.password = server.getPassword();
            this.databaseName = databaseName;
        }

        public String getJdbcUrl() {
            return jdbcUrl;
        }

        public String getUsername() {
            return username;
        }

        public String getPassword() {
            return password;
        }

        public String getDatabaseName() {
            return databaseName;
        }
    }
}
