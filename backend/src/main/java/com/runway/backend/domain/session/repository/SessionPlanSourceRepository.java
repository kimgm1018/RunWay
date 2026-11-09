package com.runway.backend.domain.session.repository;

import lombok.RequiredArgsConstructor;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

import java.math.BigDecimal;
import java.util.Optional;

/** Unlocked snapshots for the remote planning stage; no JDBC connection is held during HTTP. */
@Repository
@RequiredArgsConstructor
public class SessionPlanSourceRepository {
    private final JdbcTemplate jdbc;

    public record Course(BigDecimal distance, String stamp, String status) {}

    public record Consent(boolean granted, String stamp) {}

    public Optional<Course> course(long id) {
        return jdbc
                .query(
                        "SELECT distance, status::text AS status, status::text || ':' ||"
                                + " distance::text || ':' || updated_at::text || ':' ||"
                                + " COALESCE(md5(elevation_profile::text),'') AS stamp FROM courses"
                                + " WHERE id=?",
                        (rs, n) ->
                                new Course(
                                        rs.getBigDecimal("distance"),
                                        rs.getString("stamp"),
                                        rs.getString("status")),
                        id)
                .stream()
                .findFirst();
    }

    public Optional<Consent> consent(long userId) {
        return jdbc
                .query(
                        "SELECT health_data_access='AGREE' AS granted, health_data_access::text ||"
                                + " ':' || updated_at::text AS stamp FROM users WHERE id=? AND"
                                + " account_status='ACTIVE'",
                        (rs, n) -> new Consent(rs.getBoolean("granted"), rs.getString("stamp")),
                        userId)
                .stream()
                .findFirst();
    }

    public BigDecimal averagePace(long userId) {
        return jdbc
                .query(
                        "SELECT average_pace FROM user_profiles WHERE user_id=?",
                        (rs, n) -> rs.getBigDecimal(1),
                        userId)
                .stream()
                .findFirst()
                .orElse(null);
    }

    public String courseProfile(long courseId) {
        return jdbc.queryForObject(
                "SELECT elevation_profile::text FROM courses WHERE id=?", String.class, courseId);
    }
}
