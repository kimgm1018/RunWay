package com.runway.backend.domain.auth.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.util.List;

/** 전화번호로 ACTIVE 회원을 찾는다(users.md U15·U29·U30). 전화번호는 로그·예외에 남기지 않는다. */
@Repository
public class PhoneAccountRepository {
    private final JdbcTemplate jdbc;

    public PhoneAccountRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    /** 그 번호의 ACTIVE 회원 id. 둘 이상인지만 알면 되므로 최대 2개만 읽는다. */
    public List<Long> activeUserIds(String phoneNumber) {
        return jdbc.queryForList(
                "SELECT id FROM users WHERE phone_number=? AND account_status='ACTIVE' ORDER BY id LIMIT 2",
                Long.class,
                phoneNumber);
    }
}
