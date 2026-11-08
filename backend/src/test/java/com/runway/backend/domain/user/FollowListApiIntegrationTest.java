package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.*;
import static org.hamcrest.Matchers.nullValue;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.jayway.jsonpath.JsonPath;
import com.runway.backend.domain.auth.repository.SignupRepository;
import com.runway.backend.domain.user.repository.FollowRepository;
import com.runway.backend.domain.user.service.FollowService;
import com.runway.backend.domain.user.service.PrivacySettingsService;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedPostgres;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.webmvc.test.autoconfigure.AutoConfigureMockMvc;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

// U26 · U27 (S15P31E105-534): approved followers and followings of a runner, 20 per page.
@SpringBootTest
@AutoConfigureMockMvc
class FollowListApiIntegrationTest {
    static final SharedPostgres.Database DATABASE =
            SharedPostgres.database(FollowListApiIntegrationTest.class);

    @DynamicPropertySource
    static void properties(DynamicPropertyRegistry registry) {
        registry.add("spring.datasource.url", DATABASE::getJdbcUrl);
        registry.add("spring.datasource.username", DATABASE::getUsername);
        registry.add("spring.datasource.password", DATABASE::getPassword);
        registry.add("runway.security.jwt-secret-base64", () -> SecurityTestSupport.KEY);
    }

    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;
    @Autowired SignupRepository signup;
    @Autowired FollowService follows;
    @Autowired FollowRepository repository;
    @Autowired PrivacySettingsService privacy;
    long a, b, c, d, e;

    @BeforeEach
    void seed() {
        jdbc.execute("TRUNCATE users RESTART IDENTITY CASCADE");
        a = member("lista");
        b = member("listb");
        c = member("listc");
        d = member("listd");
        e = member("liste");
    }

    long member(String name) {
        long id = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'synthetic', ?, '2000-01-01', 'MALE', '00000000000', 'DISAGREE') RETURNING id
                """, Long.class, name, name);
        signup.insertSettings(id);
        return id;
    }

    void approve(long follower, long followee) {
        follows.follow(follower, followee);
        var row = repository.find(follower, followee).orElseThrow();
        if (!row.approved()) follows.decide(followee, follower, row.id(), "APPROVE");
    }

    ResultActions list(long viewer, long target, String kind, String cursor, String limit)
            throws Exception {
        var request = get("/api/v1/users/" + target + "/" + kind)
                .header("Authorization", SecurityTestSupport.bearer(viewer));
        if (cursor != null) request.param("cursor", cursor);
        if (limit != null) request.param("limit", limit);
        return mvc.perform(request);
    }

    ResultActions list(long viewer, long target, String kind) throws Exception {
        return list(viewer, target, kind, null, null);
    }

    @Test
    void listsOnlyApprovedRelationsWithMinimalFields() throws Exception {
        // Settings rows start private: c's request to b stays PENDING.
        approve(a, b);
        follows.follow(c, b);
        approve(b, d);
        jdbc.update("UPDATE users SET profile_image_key=? WHERE id=?",
                "images/profile/" + a + "/photo.jpg", a);

        list(b, b, "followers").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(a))
                .andExpect(jsonPath("$.items[0].nickname").value("lista"))
                .andExpect(jsonPath("$.items[0].profileImageUrl").isString())
                .andExpect(jsonPath("$.items[0].length()").value(3))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
        list(b, b, "following").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(d))
                .andExpect(jsonPath("$.items[0].profileImageUrl").value((Object) null));
        // c's own following list does not show the request still waiting.
        list(c, c, "following").andExpect(jsonPath("$.items").isEmpty());
    }

    @Test
    void pagesTwentyNewestFirstWithoutDuplicates() throws Exception {
        privacy.update(b, false);
        List<Long> fans = new ArrayList<>();
        for (int i = 0; i < 25; i++) {
            long fan = member("fan" + i);
            follows.follow(fan, b);
            fans.add(fan);
        }
        // Half share one timestamp so the id breaks the tie.
        jdbc.update("UPDATE user_follows SET created_at='2026-01-01T00:00:00Z' WHERE follower_id<=?",
                fans.get(12));
        jdbc.update("""
                UPDATE user_follows SET created_at='2026-02-01T00:00:00Z'::timestamptz
                    + (follower_id || ' seconds')::interval WHERE follower_id>?
                """, fans.get(12));

        String first = list(a, b, "followers").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(20))
                .andExpect(jsonPath("$.hasNext").value(true))
                .andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(first, "$.nextCursor");
        String second = list(a, b, "followers", cursor, "20").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(5))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()))
                .andReturn().getResponse().getContentAsString();
        List<Number> ids = new ArrayList<>(JsonPath.read(first, "$.items[*].userId"));
        ids.addAll(JsonPath.read(second, "$.items[*].userId"));
        List<Long> seen = ids.stream().map(Number::longValue).toList();
        // Newest relation first: the later timestamps by descending id, then the tied ones by id.
        assertThat(seen).containsExactlyElementsOf(fans.reversed());
    }

    @Test
    void exactlyTwentyIsOnePage() throws Exception {
        privacy.update(b, false);
        for (int i = 0; i < 20; i++) follows.follow(member("twenty" + i), b);
        list(a, b, "followers").andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(20))
                .andExpect(jsonPath("$.hasNext").value(false))
                .andExpect(jsonPath("$.nextCursor").value(nullValue()));
    }

    @Test
    void privateListsAreLimitedToOwnerAndApprovedFollowers() throws Exception {
        approve(a, b);
        follows.follow(c, b);
        list(b, b, "followers").andExpect(status().isOk());
        list(a, b, "followers").andExpect(status().isOk());
        list(a, b, "following").andExpect(status().isOk());
        for (long viewer : List.of(c, e)) {
            for (String kind : List.of("followers", "following")) {
                list(viewer, b, kind).andExpect(status().isForbidden())
                        .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"))
                        .andExpect(jsonPath("$.items").doesNotExist());
            }
        }
        // A garbage cursor still answers 403, so a hidden list cannot be probed through it.
        list(e, b, "followers", "bad", null).andExpect(status().isForbidden());
        // Going public would approve c's waiting request (U14), so c takes it back first.
        follows.cancel(c, b);
        privacy.update(b, false);
        list(e, b, "followers").andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].userId").value(a));
        privacy.update(b, true);
        follows.cancel(a, b);
        list(a, b, "followers").andExpect(status().isForbidden());
    }

    @Test
    void excludesInactiveMembersAndRejectsMissingTarget() throws Exception {
        privacy.update(b, false);
        approve(a, b);
        approve(c, b);
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?", c);
        list(b, b, "followers").andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].userId").value(a));
        list(a, c, "followers").andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("USER_NOT_FOUND"));
        list(a, 99999, "following").andExpect(status().isNotFound());
    }

    @Test
    void rejectsInvalidLimitCursorAndPath() throws Exception {
        privacy.update(b, false);
        privacy.update(a, false);
        for (int i = 0; i < 21; i++) {
            long fan = member("many" + i);
            follows.follow(fan, b);
            follows.follow(fan, a);
            follows.follow(b, fan);
        }
        String body = list(a, b, "followers").andReturn().getResponse().getContentAsString();
        String cursor = JsonPath.read(body, "$.nextCursor");
        list(a, b, "followers", null, "10").andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        list(a, b, "followers", "bad", null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        // Another runner's cursor, and the followers cursor on the following list.
        list(b, a, "followers", cursor, null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        // The same cursor reads page 2 over the real microsecond created_at values: the oldest one left.
        list(a, b, "followers", cursor, null).andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].nickname").value("many0"))
                .andExpect(jsonPath("$.hasNext").value(false));
        list(a, b, "following", cursor, null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        String outOfRange = Base64.getUrlEncoder().withoutPadding().encodeToString(
                (b + "|FOLLOWERS|0000-01-01T00:00:00Z|1").getBytes(StandardCharsets.UTF_8));
        // Year 0000 parses as an Instant, so only the supported-range check refuses it.
        list(a, b, "followers", outOfRange, null).andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("INVALID_FILTER"));
        mvc.perform(get("/api/v1/users/0/followers")
                        .header("Authorization", SecurityTestSupport.bearer(a)))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.code").value("VALIDATION_ERROR"));
        mvc.perform(get("/api/v1/users/" + b + "/followers")).andExpect(status().isUnauthorized());
        jdbc.update("UPDATE users SET account_status='WITHDRAWN',withdrawn_at=now() WHERE id=?", e);
        list(e, b, "followers").andExpect(status().isUnauthorized());
    }
}
