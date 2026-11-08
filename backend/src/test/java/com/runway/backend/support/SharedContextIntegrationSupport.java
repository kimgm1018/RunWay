package com.runway.backend.support;

import com.runway.backend.domain.grouprun.repository.GroupRunParticipantJdbcRepository;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 별도 설정이 필요 없는 통합 테스트가 함께 쓰는 Spring 컨텍스트와 전용 DB. 테스트 JVM마다 컨텍스트를 한 번만 띄운다.
 *
 * <p>여러 클래스가 DB를 함께 쓰므로 매 테스트 전에 마이그레이션 시드(regions)와 Flyway 이력, PostGIS 확장 테이블을 뺀 모든 테이블을
 * 비운다. 그래서 각 테스트는 클래스 실행 순서와 관계없이 빈 업무 데이터에서 시작하며, 하위 클래스는 필요한 seed만 준비한다.
 *
 * <p>속성·Mock·{@code @Import}를 따로 두면 컨텍스트가 갈리므로 하위 클래스는 선언하지 않는다. 필요한 테스트는 이 클래스를 쓰지 않는다.
 * Spy는 스텁하지 않으면 실제 빈과 같게 동작하고 테스트마다 초기화된다.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@AutoConfigureMockMvc
@MockitoSpyBean(types = GroupRunParticipantJdbcRepository.class)
public abstract class SharedContextIntegrationSupport {

    protected static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(SharedContextIntegrationSupport.class);

    /** 마이그레이션이 넣는 시드와 이력. 테스트가 바꾸지 않는다. */
    private static final List<String> PRESERVED = List.of("flyway_schema_history", "regions");

    private static volatile String truncate;

    @DynamicPropertySource
    static void sharedDatabaseProperties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
    }

    @Autowired private JdbcTemplate sharedJdbc;

    @BeforeEach
    void truncateSharedDatabase() {
        sharedJdbc.execute(truncateStatement());
    }

    private String truncateStatement() {
        String statement = truncate;
        if (statement == null) {
            // 확장(PostGIS 등)이 소유한 테이블은 업무 데이터가 아니므로 제외한다.
            List<String> tables =
                    sharedJdbc.queryForList(
                            """
                            SELECT quote_ident(c.relname) FROM pg_class c
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
                              AND NOT EXISTS (SELECT 1 FROM pg_depend d
                                              WHERE d.objid = c.oid AND d.deptype = 'e')
                              AND c.relname <> ALL (?)
                            ORDER BY c.relname
                            """,
                            String.class,
                            (Object) PRESERVED.toArray(String[]::new));
            if (tables.isEmpty()) {
                throw new IllegalStateException("비울 테이블이 없습니다. 마이그레이션 템플릿을 확인하세요.");
            }
            statement = "TRUNCATE " + String.join(", ", tables) + " CASCADE";
            truncate = statement;
        }
        return statement;
    }
}
