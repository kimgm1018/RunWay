package com.runway.backend.domain.crew.repository;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class RegionExistsRepository {

    private final JdbcTemplate jdbcTemplate;

    public RegionExistsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean existsByRegionCode(String regionCode) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM regions WHERE region_code = ?",
                        Integer.class,
                        regionCode);
        return count != null && count > 0;
    }
}
