package com.runway.backend.domain.course;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.patch;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import com.runway.backend.domain.course.recommend.StubElevationSource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

class RunCourseIntegrationTest extends SharedContextIntegrationSupport {
    @DynamicPropertySource
    static void routeStub(DynamicPropertyRegistry registry) {
        registry.add("runway.course.route.mode", () -> "stub");
    }
    @Autowired MockMvc mvc;
    @Autowired JdbcTemplate jdbc;

    @Test
    void 자유러닝은_명시적으로_저장하고_공유전에는_타인이_볼수없다() throws Exception {
        long owner = user("run_course_owner", "01090001001");
        long other = user("run_course_other", "01090001002");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);

        mvc.perform(put("/api/v1/running-records/{id}/course", session)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isForbidden());
        assertThat(jdbc.queryForObject("SELECT count(*) FROM courses WHERE source_session_id=?",
                Integer.class, session)).isZero();

        var first = mvc.perform(put("/api/v1/running-records/{id}/course", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk()).andReturn();
        long id = new tools.jackson.databind.json.JsonMapper().readTree(
                first.getResponse().getContentAsString()).get("courseId").asLong();
        mvc.perform(put("/api/v1/running-records/{id}/course", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk()).andExpect(jsonPath("$.courseId").value(id));
        mvc.perform(get("/api/v1/users/me/bookmarked-courses")
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(id));
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_bookmarks WHERE user_id=? AND course_id=?",
                Integer.class, owner, id)).isEqualTo(1);
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/courses/{id}/bookmark", id)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unmeasuredEdges.length()").value(0));
        assertThat(jdbc.queryForObject("SELECT distance FROM courses WHERE id=?",
                java.math.BigDecimal.class, id)).isPositive();
    }

    @Test
    void 공유게시글에서_코스를_생성하고_저장한_뒤_공유를_꺼도_저장본은_남는다() throws Exception {
        long owner = user("run_share_owner", "01090001003");
        long other = user("run_share_other", "01090001004");
        long newcomer = user("run_share_new", "01090001005");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"body\":\"공유\",\"courseShared\":true}"))
                .andExpect(status().isCreated()).andExpect(jsonPath("$.courseShared").value(true));
        long id = jdbc.queryForObject("SELECT id FROM courses WHERE source_session_id=?",
                Long.class, session);
        mvc.perform(put("/api/v1/courses/{id}/bookmark", id)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isOk());
        long postId = jdbc.queryForObject("SELECT id FROM posts WHERE session_id=?", Long.class, session);
        mvc.perform(patch("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"courseShared\":false}"))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(newcomer)))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/courses/{id}/bookmark", id)
                        .header("Authorization", SecurityTestSupport.bearer(newcomer)))
                .andExpect(status().isNotFound());
        mvc.perform(delete("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(other)))
                .andExpect(status().isOk());
    }

    @Test
    void 공유게시글을_삭제하면_새사용자에게_코스가_숨겨지고_기존저장자는_유지된다() throws Exception {
        long owner = user("run_del_owner", "01090001006");
        long saved = user("run_del_saved", "01090001007");
        long newcomer = user("run_del_new", "01090001008");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"courseShared\":true}"))
                .andExpect(status().isCreated());
        long courseId = jdbc.queryForObject("SELECT id FROM courses WHERE source_session_id=?",
                Long.class, session);
        long postId = jdbc.queryForObject("SELECT id FROM posts WHERE session_id=?", Long.class, session);
        mvc.perform(put("/api/v1/courses/{id}/bookmark", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(saved)))
                .andExpect(status().isOk());
        mvc.perform(delete("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/courses/{id}", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(saved)))
                .andExpect(status().isOk());
        mvc.perform(get("/api/v1/courses/{id}", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(newcomer)))
                .andExpect(status().isNotFound());
        mvc.perform(put("/api/v1/courses/{id}/bookmark", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(newcomer)))
                .andExpect(status().isNotFound());
    }

    @Test
    void 비공개계정과_탈퇴작성자의_공유코스는_승인된_팔로워만_저장하고_반복저장은_멱등이다() throws Exception {
        long owner = user("run_priv_owner", "01090001011");
        long follower = user("run_priv_follow", "01090001012");
        long stranger = user("run_priv_stranger", "01090001013");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"courseShared\":true}"))
                .andExpect(status().isCreated());
        long courseId = jdbc.queryForObject("SELECT id FROM courses WHERE source_session_id=?",
                Long.class, session);
        jdbc.update("UPDATE user_settings SET account_visibility='PRIVATE' WHERE user_id=?", owner);
        jdbc.update("INSERT INTO user_follows(follower_id,followee_id,is_approved) VALUES (?,?,true)",
                follower, owner);

        mvc.perform(put("/api/v1/courses/{id}/bookmark", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(stranger)))
                .andExpect(status().isNotFound());
        for (int i = 0; i < 2; i++) {
            mvc.perform(put("/api/v1/courses/{id}/bookmark", courseId)
                            .header("Authorization", SecurityTestSupport.bearer(follower)))
                    .andExpect(status().isOk());
        }
        assertThat(jdbc.queryForObject("SELECT count(*) FROM course_bookmarks WHERE user_id=? AND course_id=?",
                Integer.class, follower, courseId)).isEqualTo(1);
        mvc.perform(get("/api/v1/users/me/bookmarked-courses")
                        .header("Authorization", SecurityTestSupport.bearer(follower)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(1))
                .andExpect(jsonPath("$.items[0].id").value(courseId));

        // 작성자가 탈퇴하면 새 독자에게는 코스가 사라지고, 이미 저장한 독자는 유지한다.
        jdbc.update("UPDATE user_settings SET account_visibility='PUBLIC' WHERE user_id=?", owner);
        jdbc.update("UPDATE users SET withdrawn_at=now() WHERE id=?", owner);
        mvc.perform(put("/api/v1/courses/{id}/bookmark", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(stranger)))
                .andExpect(status().isNotFound());
        mvc.perform(get("/api/v1/courses/{id}", courseId)
                        .header("Authorization", SecurityTestSupport.bearer(follower)))
                .andExpect(status().isOk());
    }

    @Test
    void 일시정지중_이동은_회색연결부로_남기고_거리와_경사에서_제외한다() throws Exception {
        long owner = user("run_pause_owner", "01090001009");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 12, 127.001);
        point(session, 48, 127.010);
        point(session, 50, 127.011);
        long device = jdbc.queryForObject("""
                INSERT INTO user_devices(user_id,device_type,linked_at)
                VALUES (?,'WATCH',now()) RETURNING id
                """, Long.class, owner);
        control(session, device, "PAUSE", 1, 15);
        control(session, device, "RESUME", 2, 45);

        mvc.perform(put("/api/v1/running-records/{id}/course", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
        long id = jdbc.queryForObject("SELECT id FROM courses WHERE source_session_id=?",
                Long.class, session);
        mvc.perform(get("/api/v1/courses/{id}", id)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.unmeasuredEdges[0]").value(1))
                .andExpect(jsonPath("$.unmeasuredEdges.length()").value(1))
                .andExpect(jsonPath("$.route.coordinates.length()").value(4));
        BigDecimal distance = jdbc.queryForObject("SELECT distance FROM courses WHERE id=?",
                BigDecimal.class, id);
        assertThat(distance.doubleValue()).isBetween(170.0, 190.0);
        double z0 = new StubElevationSource().elevationAt(127.000, 37.5);
        double z1 = new StubElevationSource().elevationAt(127.001, 37.5);
        double z2 = new StubElevationSource().elevationAt(127.010, 37.5);
        double z3 = new StubElevationSource().elevationAt(127.011, 37.5);
        BigDecimal expectedGain = BigDecimal.valueOf(Math.max(0, z1 - z0) + Math.max(0, z3 - z2))
                .setScale(2, RoundingMode.HALF_UP);
        assertThat(jdbc.queryForObject("SELECT elevation_gain FROM courses WHERE id=?",
                BigDecimal.class, id)).isEqualByComparingTo(expectedGain);
        var profile = new tools.jackson.databind.json.JsonMapper().readTree(
                jdbc.queryForObject("SELECT elevation_profile::text FROM courses WHERE id=?",
                        String.class, id));
        double profileRise = 0;
        for (var segment : profile) {
            double length = segment.get("endDistanceM").asDouble()
                    - segment.get("startDistanceM").asDouble();
            profileRise += segment.get("gradePercent").asDouble() * length / 100;
        }
        assertThat(profileRise).isCloseTo((z1 - z0) + (z3 - z2),
                org.assertj.core.data.Offset.offset(0.1));
    }

    @Test
    void 공유한_자유러닝_게시글은_목록과_상세에서_courseFromFreeRun이_true이다() throws Exception {
        long owner = user("run_ffr_owner", "01090001021");
        long viewer = user("run_ffr_viewer", "01090001022");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"courseShared\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.courseFromFreeRun").value(true));
        long courseId = jdbc.queryForObject("SELECT id FROM courses WHERE source_session_id=?",
                Long.class, session);
        long postId = jdbc.queryForObject("SELECT id FROM posts WHERE session_id=?", Long.class, session);

        mvc.perform(get("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].courseId").value(courseId))
                .andExpect(jsonPath("$.items[0].courseFromFreeRun").value(true));
        mvc.perform(get("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseFromFreeRun").value(true));
        mvc.perform(get("/api/v1/running-records/{id}", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseId").value(courseId))
                .andExpect(jsonPath("$.courseFromFreeRun").value(true));
    }

    @Test
    void 일반_코스를_쓴_러닝_게시글은_courseFromFreeRun이_false이다() throws Exception {
        long owner = user("run_ffr_reg_owner", "01090001023");
        long viewer = user("run_ffr_reg_viewer", "01090001024");
        long session = session(owner);
        long regular = jdbc.queryForObject("""
                INSERT INTO courses(route, start_position, distance)
                VALUES (ST_GeogFromText('LINESTRING(127 37,127.1 37.1)'),
                        ST_GeogFromText('POINT(127 37)'), 5000) RETURNING id
                """, Long.class);
        jdbc.update("UPDATE running_sessions SET course_id=? WHERE id=?", regular, session);
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"courseShared\":true}"))
                .andExpect(status().isCreated())
                .andExpect(jsonPath("$.courseId").value(regular))
                .andExpect(jsonPath("$.courseFromFreeRun").value(false));
        long postId = jdbc.queryForObject("SELECT id FROM posts WHERE session_id=?", Long.class, session);

        mvc.perform(get("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].courseId").value(regular))
                .andExpect(jsonPath("$.items[0].courseFromFreeRun").value(false));
        mvc.perform(get("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(jsonPath("$.courseFromFreeRun").value(false));
        mvc.perform(get("/api/v1/running-records/{id}", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(jsonPath("$.courseId").value(regular))
                .andExpect(jsonPath("$.courseFromFreeRun").value(false));
    }

    @Test
    void 코스를_공유하지_않은_게시글은_타인에게_courseFromFreeRun도_숨긴다() throws Exception {
        long owner = user("run_ffr_hide_owner", "01090001025");
        long viewer = user("run_ffr_hide_viewer", "01090001026");
        long session = session(owner);
        point(session, 10, 127.000);
        point(session, 20, 127.001);
        mvc.perform(put("/api/v1/running-records/{id}/course", session)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(status().isOk());
        mvc.perform(post("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(owner))
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sessionId\":" + session + ",\"courseShared\":false}"))
                .andExpect(status().isCreated());
        long postId = jdbc.queryForObject("SELECT id FROM posts WHERE session_id=?", Long.class, session);

        mvc.perform(get("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.courseId").value((Object) null))
                .andExpect(jsonPath("$.courseFromFreeRun").value(false));
        mvc.perform(get("/api/v1/posts")
                        .header("Authorization", SecurityTestSupport.bearer(viewer)))
                .andExpect(jsonPath("$.items[0].courseFromFreeRun").value(false));
        mvc.perform(get("/api/v1/posts/{id}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(owner)))
                .andExpect(jsonPath("$.courseFromFreeRun").value(true));
    }

    private long user(String login, String phone) {
        long id = jdbc.queryForObject("""
                INSERT INTO users(login_id,password,nickname,birth_date,gender,phone_number,health_data_access)
                VALUES (?, 'hash', ?, '2000-01-01', 'MALE', ?, 'AGREE') RETURNING id
                """, Long.class, login,
                login.endsWith("owner") ? "코스작성자" : "독자" + phone.substring(phone.length() - 4),
                phone);
        jdbc.update("""
                INSERT INTO user_settings(user_id,voice_coaching_enabled,bpm_guide_enabled,
                  group_notifications_enabled,community_notifications_enabled,location_collection_mode,account_visibility)
                VALUES (?,false,false,false,false,'OFF','PUBLIC')
                """, id);
        return id;
    }

    private long session(long owner) {
        return jdbc.queryForObject("""
                INSERT INTO running_sessions(user_id,status,started_at,ended_at)
                VALUES (?,'COMPLETED',now() - interval '5 minutes',now()) RETURNING id
                """, Long.class, owner);
    }

    private void point(long session, int seconds, double longitude) {
        jdbc.update("""
                INSERT INTO running_route_points(running_session_id,measured_at,position,accuracy)
                SELECT ?,started_at + make_interval(secs => ?),
                  ST_SetSRID(ST_MakePoint(?,37.5),4326)::geography,5
                FROM running_sessions WHERE id=?
                """, session, (double) seconds, longitude, session);
    }

    private void control(long session, long device, String action, long version, int second) {
        jdbc.update("""
                INSERT INTO session_control_events(session_id,device_id,action,expected_version,result,applied_at)
                SELECT ?,?,?::session_control_events_action_enum,?,'APPLIED',
                       started_at + make_interval(secs => ?)
                FROM running_sessions WHERE id=?
                """, session, device, action, version, (double) second, session);
    }
}
