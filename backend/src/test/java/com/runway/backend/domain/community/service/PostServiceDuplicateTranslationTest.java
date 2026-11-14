package com.runway.backend.domain.community.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;

import com.runway.backend.support.SharedContextIntegrationSupport;
import java.sql.SQLException;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * S15P31E105-830. CMT01은 uq_posts_session_active 위반(23505)만 409 POST_ALREADY_EXISTS로 바꾸고, 다른 UNIQUE 제약이나 다른
 * SQLState의 무결성 오류는 그대로 둔다. 판정은 실제 PostgreSQL 드라이버 예외로 확인한다.
 */
class PostServiceDuplicateTranslationTest extends SharedContextIntegrationSupport {
    @Autowired private JdbcTemplate jdbc;

    private long userId;
    private long sessionId;

    @BeforeEach
    void seed() {
        userId = insertUser("translate_user", "번역검사");
        sessionId =
                jdbc.queryForObject(
                        """
                        INSERT INTO running_sessions(user_id, status)
                        VALUES (?, 'COMPLETED'::running_sessions_status_enum)
                        RETURNING id
                        """,
                        Long.class,
                        userId);
        jdbc.update(
                "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, '기존 글')",
                userId,
                sessionId);
    }

    @Test
    void 같은기록_미삭제글_중복만_409로_바꾼다() {
        Throwable duplicate =
                catchThrowable(
                        () ->
                                jdbc.update(
                                        "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, '중복')",
                                        userId,
                                        sessionId));

        assertThat(duplicate).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(PostService.isActivePostConflict(duplicate)).isTrue();
    }

    @Test
    void 다른_UNIQUE제약과_다른_SQLState는_그대로_둔다() {
        Throwable otherUnique = catchThrowable(() -> insertUser("translate_user", "다른닉네임"));
        assertThat(otherUnique).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlState(otherUnique)).isEqualTo("23505");
        assertThat(PostService.isActivePostConflict(otherUnique)).isFalse();

        Throwable foreignKey =
                catchThrowable(
                        () ->
                                jdbc.update(
                                        "INSERT INTO posts(author_id, session_id, body) VALUES (?, ?, '없는 기록')",
                                        userId,
                                        sessionId + 1000));
        assertThat(foreignKey).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(sqlState(foreignKey)).isEqualTo("23503");
        assertThat(PostService.isActivePostConflict(foreignKey)).isFalse();

        assertThat(PostService.isActivePostConflict(new SQLException("x", "23505"))).isFalse();
        assertThat(PostService.isActivePostConflict(new IllegalStateException())).isFalse();
        assertThat(PostService.isActivePostConflict(null)).isFalse();
    }

    private long insertUser(String loginId, String nickname) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', '01028312831', 'AGREE')
                RETURNING id
                """,
                Long.class,
                loginId,
                nickname);
    }

    private static String sqlState(Throwable exception) {
        for (Throwable current = exception; current != null; current = current.getCause()) {
            if (current instanceof SQLException sql) {
                return sql.getSQLState();
            }
        }
        return null;
    }
}
