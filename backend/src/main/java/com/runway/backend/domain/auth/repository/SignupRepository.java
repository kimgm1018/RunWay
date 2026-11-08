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
