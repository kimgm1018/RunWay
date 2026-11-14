package com.runway.backend.domain.auth.repository;

import com.runway.backend.domain.auth.validation.SignupValidator;
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

    /**
     * 대소문자 구분 없이 같은 아이디가 있거나 탈퇴로 예약됐는지(users.md U15·U16, S15P31E105-831). 사용자가 보낸 원래 값을 받는다.
     * 새 탈퇴는 소문자 아이디의 해시로 예약되고, 예전 탈퇴는 가입 당시 대소문자 그대로의 해시라 두 해시를 모두 본다. 대소문자만 다른 예전
     * 탈퇴 아이디는 해시를 되돌릴 수 없어 찾지 못한다(수용한 한계).
     */
    public boolean loginIdExists(String submittedLoginId) {
        String loginId = SignupValidator.normalizeLoginId(submittedLoginId);
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE lower(login_id)=?"
                                + " OR (account_status='WITHDRAWN' AND lower(login_id) IN (?,?)))",
                        Boolean.class,
                        loginId,
                        RetiredLoginId.digest(loginId),
                        RetiredLoginId.digest(submittedLoginId)));
    }

    /** ACTIVE 회원 가운데 대소문자만 다른 닉네임도 같은 닉네임으로 본다(uq_users_nickname과 같은 lower 식). */
    public boolean nicknameExists(String nickname) {
        return Boolean.TRUE.equals(
                jdbc.queryForObject(
                        "SELECT EXISTS(SELECT 1 FROM users WHERE lower(nickname)=lower(?) AND account_status='ACTIVE')",
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
                input.healthGranted() ? "AGREE" : "DISAGREE");
    }

    /** S15P31E105-801: group·community notifications start on so a new account receives its inbox rows. */
    public void insertSettings(long userId) {
        jdbc.update(
                """
                INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,
                    group_notifications_enabled,community_notifications_enabled,
                    location_collection_mode,account_visibility)
                VALUES (?,false,true,true,true,'OFF','PRIVATE')
                """,
                userId);
    }
}
