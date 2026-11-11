package com.runway.backend.domain.crew.repository;

import com.runway.backend.domain.image.ImageService;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

@Repository
public class UserExistsRepository {

    private final JdbcTemplate jdbcTemplate;

    public UserExistsRepository(JdbcTemplate jdbcTemplate) {
        this.jdbcTemplate = jdbcTemplate;
    }

    public boolean existsById(long userId) {
        Integer count =
                jdbcTemplate.queryForObject(
                        "SELECT COUNT(*) FROM users WHERE id = ?", Integer.class, userId);
        return count != null && count > 0;
    }

    public Optional<String> findNickname(long userId) {
        return jdbcTemplate
                .query(
                        "SELECT nickname FROM users WHERE id = ?",
                        (rs, rowNum) -> rs.getString("nickname"),
                        userId)
                .stream()
                .findFirst();
    }

    /**
     * 목록 표시용 닉네임과 프로필 사진 주소(S15P31E105-636). 사진 주소는 U21·커뮤니티 작성자와 같은 규칙
     * (users.profile_image_key → {@link ImageService#publicUrlFromKey})이고 없으면 null이다. 탈퇴 처리는 키를
     * 지우므로 탈퇴 회원도 null이다. 한 번의 IN 조회로 읽는다.
     */
    public record UserDisplay(String nickname, String profileImageUrl) {}

    public Map<Long, UserDisplay> findDisplaysByIds(Collection<Long> userIds) {
        Map<Long, UserDisplay> displays = new HashMap<>();
        if (userIds == null || userIds.isEmpty()) {
            return displays;
        }
        Object[] args = userIds.toArray();
        String placeholders = String.join(",", Collections.nCopies(args.length, "?"));
        jdbcTemplate.query(
                "SELECT id, nickname, profile_image_key FROM users WHERE id IN ("
                        + placeholders
                        + ")",
                rs -> {
                    displays.put(
                            rs.getLong("id"),
                            new UserDisplay(
                                    rs.getString("nickname"),
                                    ImageService.publicUrlFromKey(
                                            rs.getString("profile_image_key"))));
                },
                args);
        return displays;
    }
}
