package com.runway.backend.support;

import java.sql.DriverManager;
import java.sql.SQLException;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.regex.Pattern;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 테스트 JVM 하나가 함께 쓰는 PostGIS 서버. 컨테이너는 처음 요청될 때 한 번만 띄우고 JVM 종료 시 Testcontainers가 정리한다.
 *
 * <p>격리 단위(지원 클래스 또는 단독 테스트 클래스)마다 전용 데이터베이스를 만들어 준다. 데이터 정리 범위와 Spring 컨텍스트 구성은 컨테이너를
 * 따로 띄우던 때와 같고 컨테이너 기동 비용만 줄어든다. 컨테이너를 일시정지·중지하는 장애 테스트는 이 서버를 쓰지 않는다.
 */
public final class SharedPostgres {

    /**
     * 살아 있는 Spring 컨텍스트(캐시 최대 32개) × Hikari 기본 최대 10개와 직접 JDBC 연결 여유. 테스트의 풀 크기나 컨텍스트 캐시
     * 크기를 늘리면 이 값을 다시 계산한다.
     */
    static final int MAX_CONNECTIONS = 400;

    private static final Pattern NAME = Pattern.compile("[a-z][a-z0-9_]{0,62}");
    private static final Map<String, Database> DATABASES = new ConcurrentHashMap<>();

    private SharedPostgres() {}

    /**
     * 클래스 단순 이름을 소문자로 바꾼 이름의 전용 데이터베이스. 다른 클래스가 같은 이름을 요청하면 격리가 깨지므로 실패시킨다.
     */
    public static Database database(Class<?> owner) {
        String name = owner.getSimpleName().toLowerCase(Locale.ROOT);
        if (!NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("데이터베이스 이름 형식: " + name);
        }
        Database database = DATABASES.computeIfAbsent(name, key -> create(key, owner));
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
        return database;
    }

    private static Database create(String name, Class<?> owner) {
        PostgreSQLContainer server = Server.INSTANCE;
        try (var connection =
                        DriverManager.getConnection(
                                server.getJdbcUrl(), server.getUsername(), server.getPassword());
                var statement = connection.createStatement()) {
            // 기본 DB와 같은 PostGIS 확장 구성을 갖도록 이미지가 준비한 template_postgis에서 복제한다.
            statement.execute("CREATE DATABASE \"" + name + "\" TEMPLATE template_postgis");
        } catch (SQLException e) {
            throw new IllegalStateException("테스트 데이터베이스 생성 실패: " + name, e);
        }
        return new Database(server, name, owner);
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

    /** 전용 데이터베이스 접속 정보. 기존 컨테이너 필드와 같은 이름의 조회 메서드를 둔다. */
    public static final class Database {
        private final String jdbcUrl;
        private final String username;
        private final String password;
        private final String databaseName;
        private final Class<?> owner;

        private Database(PostgreSQLContainer server, String databaseName, Class<?> owner) {
            this.owner = owner;
            String base = server.getJdbcUrl();
            String marker = "/" + server.getDatabaseName();
            int at = base.indexOf(marker, base.indexOf("//") + 2);
            if (at < 0) {
                throw new IllegalStateException("JDBC URL에서 데이터베이스 이름을 찾지 못했습니다.");
            }
            this.jdbcUrl =
                    base.substring(0, at) + "/" + databaseName + base.substring(at + marker.length());
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
