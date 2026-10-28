package com.runway.backend;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import java.nio.file.Files;
import java.nio.file.Path;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.SQLException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.testcontainers.junit.jupiter.Container;
import org.testcontainers.junit.jupiter.Testcontainers;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/** Executes the reference schema in a disposable DB, without installing service migrations. */
@Testcontainers
class SchemaIntegrityTest {

    @Container
    static final PostgreSQLContainer DATABASE =
            new PostgreSQLContainer(
                    DockerImageName.parse("postgis/postgis:17-3.6")
                            .asCompatibleSubstituteFor("postgres"));

    private Connection connection;
    private long user;
    private long otherUser;
    private long session;
    private long otherSession;
    private long course;
    private long crew;
    private long group;
    private long device;
    private long otherDevice;
    private long post;
    private long otherPost;
    private long plan;

    private static Connection connect() throws SQLException {
        return DriverManager.getConnection(
                DATABASE.getJdbcUrl(), DATABASE.getUsername(), DATABASE.getPassword());
    }

    @BeforeAll
    static void loadReferenceSchema() throws Exception {
        var path = Path.of("..", "docs", "design", "db", "schema.sql");
        try (var connection = connect();
                var statement = connection.createStatement()) {
            var sql = Files.readString(path);
            statement.execute(sql.startsWith("\uFEFF") ? sql.substring(1) : sql);
        }
    }

    @BeforeEach
    void createSyntheticFixtures() throws Exception {
        connection = connect();
        connection.setAutoCommit(false);
        user = insert(userSql("runner_a"));
        otherUser = insert(userSql("runner_b"));
        session = insert("INSERT INTO running_sessions(user_id) VALUES (" + user + ")");
        otherSession = insert("INSERT INTO running_sessions(user_id) VALUES (" + otherUser + ")");
        course =
                insert(
                        """
                INSERT INTO courses(route,start_position,distance)
                VALUES (ST_GeogFromText('LINESTRING(0 0,0 0.001)'),
                        ST_GeogFromText('POINT(0 0)'),100)
                """);
        crew = insert("INSERT INTO crews(owner_id,name,capacity) VALUES (" + user + ",'test',10)");
        group =
                insert(
                        "INSERT INTO group_runs(crew_id,host_id,title,scheduled_at) VALUES ("
                                + crew
                                + ","
                                + user
                                + ",'test',now())");
        device =
                insert(
                        "INSERT INTO user_devices(user_id,device_type,linked_at) VALUES ("
                                + user
                                + ",'WATCH',now())");
        otherDevice =
                insert(
                        "INSERT INTO user_devices(user_id,device_type,linked_at) VALUES ("
                                + otherUser
                                + ",'WATCH',now())");
        post =
                insert(
                        "INSERT INTO posts(author_id,session_id) VALUES ("
                                + user
                                + ","
                                + session
                                + ")");
        otherPost =
                insert(
                        "INSERT INTO posts(author_id,session_id) VALUES ("
                                + otherUser
                                + ","
                                + otherSession
                                + ")");
        plan =
                insert(
                        "INSERT INTO pace_plans(session_id,recommended_pace) VALUES ("
                                + session
                                + ",300)");
    }

    @AfterEach
    void rollbackFixtures() throws Exception {
        if (connection != null) {
            connection.rollback();
            connection.close();
        }
    }

    private static String userSql(String login) {
        return """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES ('%s','synthetic-hash','runner','2000-01-01','MALE','00000000000','AGREEE')
                """
                .formatted(login);
    }

    private long insert(String sql) throws SQLException {
        return number(sql + " RETURNING id");
    }

    private long number(String sql) throws SQLException {
        try (var statement = connection.createStatement();
                var result = statement.executeQuery(sql)) {
            assertThat(result.next()).isTrue();
            return result.getLong(1);
        }
    }

    private void execute(String sql) throws SQLException {
        try (var statement = connection.createStatement()) {
            statement.execute(sql);
        }
    }

    private void rejects(String state, String sql) throws SQLException {
        var savepoint = connection.setSavepoint();
        try {
            var exception = catchThrowable(() -> execute(sql));
            assertThat(exception)
                    .as("Expected SQLSTATE %s", state)
                    .isInstanceOfSatisfying(
                            SQLException.class,
                            error -> assertThat(error.getSQLState()).isEqualTo(state));
        } finally {
            connection.rollback(savepoint);
            connection.releaseSavepoint(savepoint);
        }
    }

    private String row(String table) {
        return switch (table) {
            case "users" -> userSql("unique_runner");
            case "user_profiles" ->
                    "INSERT INTO user_profiles(user_id,running_level,average_pace) VALUES ("
                            + user
                            + ",'BEGINNER',300)";
            case "user_settings" ->
                    "INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,group_notifications_enabled,community_notifications_enabled,location_collection_mode,account_visibility) VALUES ("
                            + user
                            + ",false,false,false,false,'OFF','PRIVATE')";
            case "daily_health_metrics" ->
                    "INSERT INTO daily_health_metrics(user_id,metric_date) VALUES ("
                            + user
                            + ",'2026-01-01')";
            case "daily_readiness" ->
                    "INSERT INTO daily_readiness(user_id,readiness_date,readiness_score) VALUES ("
                            + user
                            + ",'2026-01-01',50)";
            case "course_bookmarks" ->
                    "INSERT INTO course_bookmarks(user_id,course_id) VALUES ("
                            + user
                            + ","
                            + course
                            + ")";
            case "post_likes" ->
                    "INSERT INTO post_likes(user_id,post_id) VALUES (" + user + "," + post + ")";
            case "user_follows" ->
                    "INSERT INTO user_follows(follower_id,followee_id) VALUES ("
                            + user
                            + ","
                            + otherUser
                            + ")";
            case "course_environment_tags" ->
                    "INSERT INTO course_environment_tags(course_id,environment_type) VALUES ("
                            + course
                            + ",'PARK')";
            case "group_run_participants" ->
                    "INSERT INTO group_run_participants(group_run_id,user_id) VALUES ("
                            + group
                            + ","
                            + user
                            + ")";
            case "pace_plan_segments" ->
                    "INSERT INTO pace_plan_segments(pace_plan_id,segment_sequence,start_distance,end_distance,recommended_pace) VALUES ("
                            + plan
                            + ",1,0,100,300)";
            case "crew_memberships" ->
                    "INSERT INTO crew_memberships(crew_id,user_id) VALUES ("
                            + crew
                            + ","
                            + user
                            + ")";
            case "sync_batches" -> batch(device);
            case "running_route_points" ->
                    "INSERT INTO running_route_points(running_session_id,measured_at,position) VALUES ("
                            + session
                            + ",now(),ST_GeogFromText('POINT(0 0)'))";
            case "running_metric_samples" ->
                    "INSERT INTO running_metric_samples(running_session_id,measured_at,elapsed_duration,is_hr_measured) VALUES ("
                            + session
                            + ",now(),0,false)";
            case "coaching_decisions" ->
                    "INSERT INTO coaching_decisions(session_id,elapsed_duration,recommended_pace) VALUES ("
                            + session
                            + ",0,300)";
            default -> throw new IllegalArgumentException(table);
        };
    }

    private String batch(long deviceId) {
        return "INSERT INTO sync_batches(client_batch_id,device_id,payload_version,payload_hash) VALUES ('batch-1',"
                + deviceId
                + ",'1','synthetic-hash')";
    }

    @Test
    void allPrimaryKeysGenerateIdsAndRejectExplicitValues() throws Exception {
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE' AND table_name<>'spatial_ref_sys'"))
                .isEqualTo(26);
        assertThat(
                        number(
                                "SELECT count(*) FROM information_schema.columns WHERE table_schema='public' AND column_name='id' AND is_identity='YES' AND identity_generation='ALWAYS'"))
                .isEqualTo(26);
        assertThat(user).isPositive();
        assertThat(otherUser).isGreaterThan(user);
        rejects(
                "428C9",
                "INSERT INTO regions(id,region_code,sido_name,sigungu_name) VALUES (999,'test','test','test')");
    }

    @ParameterizedTest
    @ValueSource(
            strings = {
                "users",
                "user_profiles",
                "user_settings",
                "daily_health_metrics",
                "daily_readiness",
                "course_bookmarks",
                "post_likes",
                "user_follows",
                "course_environment_tags",
                "group_run_participants",
                "pace_plan_segments",
                "crew_memberships",
                "sync_batches"
            })
    void duplicateLogicalKeysAreRejected(String table) throws Exception {
        execute(row(table));
        rejects("23505", row(table));
    }

    @Test
    void differentDevicesMayReuseBatchIdsAndDatesMayHaveSeparateMetrics() throws Exception {
        execute(batch(device));
        execute(batch(otherDevice));
        execute(row("daily_health_metrics"));
        execute(
                "INSERT INTO daily_health_metrics(user_id,metric_date) VALUES ("
                        + user
                        + ",'2026-01-02')");
        assertThat(number("SELECT count(*) FROM sync_batches")).isEqualTo(2);
        assertThat(number("SELECT count(*) FROM daily_health_metrics")).isEqualTo(2);
    }

    @Test
    void crewRejoinUpdatesTheExistingRelation() throws Exception {
        long membership = insert(row("crew_memberships"));
        execute("UPDATE crew_memberships SET status='LEFT' WHERE id=" + membership);
        execute(
                "UPDATE crew_memberships SET status='PENDING',requested_at=now(),joined_at=NULL,left_at=NULL WHERE id="
                        + membership);
        assertThat(number("SELECT count(*) FROM crew_memberships")).isEqualTo(1);
    }

    @ParameterizedTest
    @ValueSource(ints = {1, 200})
    void crewCapacityAllowsInclusiveBoundaries(int capacity) throws Exception {
        long id =
                insert(
                        "INSERT INTO crews(owner_id,name,capacity) VALUES ("
                                + user
                                + ",'boundary',"
                                + capacity
                                + ")");
        assertThat(number("SELECT capacity FROM crews WHERE id=" + id)).isEqualTo(capacity);
        execute("UPDATE crews SET capacity=" + capacity + " WHERE id=" + crew);
        assertThat(number("SELECT capacity FROM crews WHERE id=" + crew)).isEqualTo(capacity);
    }

    @ParameterizedTest
    @ValueSource(ints = {-1, 0, 201})
    void crewCapacityRejectsValuesOutsideBounds(int capacity) throws Exception {
        rejects(
                "23514",
                "INSERT INTO crews(owner_id,name,capacity) VALUES ("
                        + user
                        + ",'invalid',"
                        + capacity
                        + ")");
        rejects("23514", "UPDATE crews SET capacity=" + capacity + " WHERE id=" + crew);
        assertThat(number("SELECT capacity FROM crews WHERE id=" + crew)).isEqualTo(10);
    }

    @Test
    void crewCapacityRemainsRequired() throws Exception {
        rejects(
                "23502",
                "INSERT INTO crews(owner_id,name,capacity) VALUES (" + user + ",'invalid',NULL)");
        rejects("23502", "UPDATE crews SET capacity=NULL WHERE id=" + crew);
        assertThat(number("SELECT capacity FROM crews WHERE id=" + crew)).isEqualTo(10);
    }

    @Test
    void commentsRequireParentsFromTheSamePost() throws Exception {
        long parent =
                insert(
                        "INSERT INTO comments(post_id,author_id,body) VALUES ("
                                + post
                                + ","
                                + user
                                + ",'parent')");
        execute(
                "INSERT INTO comments(post_id,parent_comment_id,author_id,body) VALUES ("
                        + post
                        + ","
                        + parent
                        + ","
                        + user
                        + ",'reply')");
        rejects(
                "23503",
                "INSERT INTO comments(post_id,parent_comment_id,author_id,body) VALUES ("
                        + otherPost
                        + ","
                        + parent
                        + ","
                        + otherUser
                        + ",'wrong post')");
        rejects("23514", "UPDATE comments SET parent_comment_id=id WHERE id=" + parent);
        rejects("23503", "UPDATE comments SET post_id=" + otherPost + " WHERE id=" + parent);
    }

    @ParameterizedTest
    @CsvSource({
        "running_sessions,goal_distance=0",
        "running_sessions,goal_duration=-1",
        "running_sessions,goal_pace=0",
        "running_sessions,total_distance=-1",
        "running_sessions,moving_duration=-1",
        "running_sessions,elapsed_duration=-1",
        "running_sessions,moving_duration_to_goal=-1",
        "running_sessions,average_pace=0",
        "group_runs,goal_distance=0",
        "group_runs,goal_duration=-1",
        "courses,distance=-1",
        "pace_plan_segments,start_distance=-1",
        "pace_plan_segments,end_distance=0",
        "pace_plan_segments,recommended_pace=0",
        "pace_plan_segments,segment_sequence=0",
        "running_route_points,accuracy=-1",
        "running_metric_samples,elapsed_duration=-1",
        "running_metric_samples,total_distance=-1",
        "running_metric_samples,route_progress=-1",
        "coaching_decisions,elapsed_duration=-1",
        "coaching_decisions,recommended_pace=0",
        "pace_plans,recommended_pace=0",
        "user_profiles,average_pace=0",
        "user_profiles,distance=0",
        "user_profiles,duraction=0"
    })
    void invalidRangesAreRejected(String table, String assignment) throws Exception {
        if (!java.util.Set.of("running_sessions", "group_runs", "courses", "pace_plans")
                .contains(table)) {
            execute(row(table));
        }
        rejects("23514", "UPDATE " + table + " SET " + assignment);
    }

    @ParameterizedTest
    @CsvSource(
            value = {
                "user_profiles,average_pace",
                "running_sessions,goal_pace",
                "running_sessions,total_distance",
                "running_sessions,average_pace",
                "courses,distance",
                "pace_plans,recommended_pace",
                "pace_plans,route_progress",
                "pace_plan_segments,start_distance",
                "pace_plan_segments,end_distance",
                "pace_plan_segments,recommended_pace",
                "running_route_points,accuracy",
                "running_metric_samples,total_distance",
                "running_metric_samples,route_progress",
                "coaching_decisions,recommended_pace",
                "coaching_decisions,route_progress"
            })
    void nonNumericValuesCannotBypassRangeChecks(String table, String column) throws Exception {
        if (!java.util.Set.of("running_sessions", "courses", "pace_plans").contains(table)) {
            execute(row(table));
        }
        rejects("23514", "UPDATE " + table + " SET " + column + "='NaN'");
    }

    @Test
    void likesAndTagsAllowEachComponentToVaryIndependently() throws Exception {
        execute(row("post_likes"));
        execute("INSERT INTO post_likes(user_id,post_id) VALUES (" + otherUser + "," + post + ")");
        execute("INSERT INTO post_likes(user_id,post_id) VALUES (" + user + "," + otherPost + ")");
        execute(row("course_environment_tags"));
        execute(
                "INSERT INTO course_environment_tags(course_id,environment_type) VALUES ("
                        + course
                        + ",'TRACK')");
        long otherCourse =
                insert(
                        """
                INSERT INTO courses(route,start_position,distance)
                VALUES (ST_GeogFromText('LINESTRING(0 0,0 0.002)'),
                        ST_GeogFromText('POINT(0 0)'),200)
                """);
        execute(
                "INSERT INTO course_environment_tags(course_id,environment_type) VALUES ("
                        + otherCourse
                        + ",'PARK')");
        assertThat(number("SELECT count(*) FROM post_likes")).isEqualTo(3);
        assertThat(number("SELECT count(*) FROM course_environment_tags")).isEqualTo(3);
    }

    @Test
    void nullGoalsZeroCumulativeValuesAndNegativeAltitudeRemainAllowed() throws Exception {
        execute(
                "UPDATE running_sessions SET goal_distance=NULL,goal_duration=NULL,goal_pace=NULL,total_distance=0,moving_duration=0,elapsed_duration=0,moving_duration_to_goal=0");
        execute("UPDATE running_sessions SET goal_distance=1000,goal_duration=300,goal_pace=300");
        execute(row("running_route_points"));
        execute("UPDATE running_route_points SET accuracy=0,altitude=-10");
        execute(row("running_metric_samples"));
        execute(
                "UPDATE running_metric_samples SET elapsed_duration=0,total_distance=0,route_progress=0,grade=-5");
        execute(row("pace_plan_segments"));
        execute("UPDATE pace_plan_segments SET start_distance=0,end_distance=1");
    }

    @Test
    void selfFollowIsRejectedButReverseFollowIsIndependent() throws Exception {
        rejects(
                "23514",
                "INSERT INTO user_follows(follower_id,followee_id) VALUES ("
                        + user
                        + ","
                        + user
                        + ")");
        execute(row("user_follows"));
        execute(
                "INSERT INTO user_follows(follower_id,followee_id) VALUES ("
                        + otherUser
                        + ","
                        + user
                        + ")");
        assertThat(number("SELECT count(*) FROM user_follows")).isEqualTo(2);
    }

    @Test
    void everyUpdatedAtColumnHasATriggerAndRawSqlRefreshesTheTimestamp() throws Exception {
        assertThat(
                        number(
                                """
                SELECT count(*) FROM information_schema.columns c
                WHERE c.table_schema='public' AND c.column_name='updated_at'
                AND NOT EXISTS (SELECT 1 FROM information_schema.triggers t
                  WHERE t.event_object_schema=c.table_schema AND t.event_object_table=c.table_name
                  AND t.action_timing='BEFORE' AND t.event_manipulation='UPDATE')
                """))
                .isZero();
        long id =
                insert(
                        "INSERT INTO course_bookmarks(user_id,course_id,updated_at) VALUES ("
                                + user
                                + ","
                                + course
                                + ",'2000-01-01T00:00:00Z')");
        execute("UPDATE course_bookmarks SET custom_name='changed' WHERE id=" + id);
        assertThat(
                        number(
                                "SELECT count(*) FROM course_bookmarks WHERE id="
                                        + id
                                        + " AND updated_at>'2000-01-01T00:00:00Z'"))
                .isEqualTo(1);
    }
}
