package com.runway.backend.domain.auth.repository;

import com.runway.backend.domain.auth.validation.SignupValidator.Input;
import com.runway.backend.domain.auth.service.RetiredLoginId;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class SignupRepository {
    private final JdbcTemplate jdbc;

    public SignupRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public boolean loginIdExists(String loginId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE login_id=? OR (account_status='WITHDRAWN' AND login_id=?))",
                        Boolean.class,
                        loginId, RetiredLoginId.digest(loginId)));
    }

    public boolean nicknameExists(String nickname) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE nickname=? AND account_status='ACTIVE')",
                        Boolean.class,
                        nickname));
    }

    /** pg_advisory_xact_lock(int,int)의 첫 번째 키. 다른 기능의 advisory lock과 구분한다(S15P31E105-560). */
    static final int PHONE_LOCK_NAMESPACE = 560_001;

    /**
     * 같은 전화번호의 가입을 트랜잭션 끝까지 한 줄로 세운다(users.md U15). 번호를 hashtext로 접어 키로 쓰므로 드물게 다른 번호끼리 같이 기다릴 수
     * 있으나 결과는 바뀌지 않는다. 번호는 SQL 인자로만 보내고 로그에 남기지 않는다.
     */
    public void lockPhone(String phoneNumber) {
        jdbc.query(
                "SELECT pg_advisory_xact_lock(?, hashtext(?))",
                rs -> {},
                PHONE_LOCK_NAMESPACE,
                phoneNumber);
    }

    /** 방금 넣은 회원 말고 같은 번호의 ACTIVE 회원이 있는지. 잠금 안에서 호출한다. */
    public boolean otherActivePhoneExists(String phoneNumber, long userId) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE phone_number=? AND account_status='ACTIVE' AND id<>?)",
                        Boolean.class,
                        phoneNumber,
                        userId));
    }

    public long insertUser(Input input, String hash) {
        return jdbc.queryForObject(
                """
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?,?,?,?,?::users_gender_enum,?,?::users_health_data_access_enum) RETURNING id
                """,
                Long.class,
                input.loginId(),
                hash,
                input.nickname(),
                input.birthDate(),
                input.gender(),
                input.phoneNumber(),
                input.healthGranted() ? "AGREEE" : "DISAGREE");
    }

    public void insertSettings(long userId) {
        jdbc.update(
                """
                INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,
                    group_notifications_enabled,community_notifications_enabled,
                    location_collection_mode,account_visibility)
                VALUES (?,false,false,false,false,'OFF','PRIVATE')
                """,
                userId);
    }
}
