package com.runway.backend.domain.community;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.runway.backend.domain.community.service.PostBookmarkService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.security.SecurityTestSupport;
import com.runway.backend.support.SharedContextIntegrationSupport;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;
import org.springframework.transaction.PlatformTransactionManager;

/** S15P31E105-634 AC-1(CMT16·CMT17 멱등·접근 거절·동시 등록)과 AC-2(CMT02·CMT03 bookmarked 조회자별 값). */
class PostBookmarkApiIntegrationTest extends SharedContextIntegrationSupport {
    @Autowired private MockMvc mockMvc;
    @Autowired private JdbcTemplate jdbc;
    @Autowired private PostBookmarkService postBookmarkService;
    @Autowired private PlatformTransactionManager transactionManager;

    private CommunityFixture fixture;
    private long viewerId;
    private long otherViewerId;
    private long publicAuthorId;
    private long privateAuthorId;
    private long publicPostId;
    private long privatePostId;

    @BeforeEach
    void seed() {
        fixture = new CommunityFixture(jdbc);
        viewerId = fixture.user("bm_viewer", "저장뷰어", "PUBLIC");
        otherViewerId = fixture.user("bm_other", "저장다른", "PUBLIC");
        publicAuthorId = fixture.user("bm_public", "저장공개", "PUBLIC");
        privateAuthorId = fixture.user("bm_private", "저장비공", "PRIVATE");
        fixture.follow(viewerId, privateAuthorId);
        publicPostId = fixture.post(publicAuthorId, "공개 글");
        privatePostId = fixture.post(privateAuthorId, "비공개 글");
    }

    @Test
    void 스크랩등록과해제를_반복해도_200이고_한행만남거나_없다() throws Exception {
        for (int i = 0; i < 2; i++) {
            bookmark(viewerId, publicPostId)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.postId").value(publicPostId))
                    .andExpect(jsonPath("$.bookmarked").value(true));
            assertThat(fixture.count("post_bookmarks", publicPostId, viewerId)).isEqualTo(1);
        }
        for (int i = 0; i < 2; i++) {
            unbookmark(viewerId, publicPostId)
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.postId").value(publicPostId))
                    .andExpect(jsonPath("$.bookmarked").value(false));
            assertThat(fixture.count("post_bookmarks", publicPostId, viewerId)).isZero();
        }
    }

    /**
     * 이미 저장한 글의 재요청은 INSERT(회원 행 NOWAIT 잠금 트리거)를 실행하지 않으므로, 같은 회원의 로그인·프로필 저장이 회원 행을 잠근 중에도
     * 200이다. 대조로 새 저장은 같은 잠금에서 트리거가 실패해 503이다.
     */
    @Test
    void 이미저장한글의_재요청은_회원행이_잠겨도_200() throws Exception {
        long otherPostId = fixture.post(publicAuthorId, "다른 공개 글");
        bookmark(viewerId, publicPostId).andExpect(status().isOk());

        CommunityFixture.whileUserRowLocked(
                jdbc,
                transactionManager,
                viewerId,
                () -> {
                    bookmark(viewerId, publicPostId)
                            .andExpect(status().isOk())
                            .andExpect(jsonPath("$.bookmarked").value(true));
                    bookmark(viewerId, otherPostId)
                            .andExpect(status().isServiceUnavailable())
                            .andExpect(jsonPath("$.code").value("SERVICE_UNAVAILABLE"));
                });
        assertThat(fixture.count("post_bookmarks", publicPostId, viewerId)).isEqualTo(1);
        assertThat(fixture.count("post_bookmarks", otherPostId, viewerId)).isZero();
    }

    @Test
    void 자기글도_스크랩할수있다() throws Exception {
        bookmark(publicAuthorId, publicPostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(true));
        assertThat(fixture.count("post_bookmarks", publicPostId, publicAuthorId)).isEqualTo(1);
    }

    @Test
    void 볼수없는_비공개글은_403_승인팔로워는_200() throws Exception {
        bookmark(otherViewerId, privatePostId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
        unbookmark(otherViewerId, privatePostId)
                .andExpect(status().isForbidden())
                .andExpect(jsonPath("$.code").value("ACCOUNT_ACCESS_DENIED"));
        assertThat(fixture.count("post_bookmarks", privatePostId, otherViewerId)).isZero();

        bookmark(viewerId, privatePostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(true));
    }

    @Test
    void 삭제되거나_없는글은_404_POST_NOT_FOUND() throws Exception {
        fixture.deletePost(publicPostId);
        bookmark(viewerId, publicPostId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        unbookmark(viewerId, publicPostId)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        bookmark(viewerId, 999_999_999L)
                .andExpect(status().isNotFound())
                .andExpect(jsonPath("$.code").value("POST_NOT_FOUND"));
        assertThat(fixture.count("post_bookmarks", publicPostId, viewerId)).isZero();
    }

    @Test
    void 인증없으면_401() throws Exception {
        mockMvc.perform(put("/api/v1/posts/{postId}/bookmarks/me", publicPostId))
                .andExpect(status().isUnauthorized());
        mockMvc.perform(delete("/api/v1/posts/{postId}/bookmarks/me", publicPostId))
                .andExpect(status().isUnauthorized());
    }

    /** 같은 회원의 등록이 동시에 들어와도 모두 성공하고 행은 하나만 남는다(유니크 제약 + ON CONFLICT DO NOTHING). */
    @RepeatedTest(5)
    void 동시에_스크랩등록해도_모두성공하고_한행만남는다() throws Exception {
        int requests = 8;
        ExecutorService pool = Executors.newFixedThreadPool(requests);
        CountDownLatch ready = new CountDownLatch(requests);
        CountDownLatch start = new CountDownLatch(1);
        List<String> results = Collections.synchronizedList(new ArrayList<>());
        try {
            List<Future<?>> futures = new ArrayList<>();
            for (int i = 0; i < requests; i++) {
                futures.add(
                        pool.submit(
                                () -> {
                                    ready.countDown();
                                    start.await();
                                    try {
                                        results.add(
                                                postBookmarkService.bookmark(viewerId, publicPostId)
                                                                .bookmarked()
                                                        ? "OK"
                                                        : "NOT_BOOKMARKED");
                                    } catch (ApiException ex) {
                                        results.add(ex.code());
                                    }
                                    return null;
                                }));
            }
            assertThat(ready.await(10, TimeUnit.SECONDS)).isTrue();
            start.countDown();
            for (Future<?> future : futures) {
                future.get(30, TimeUnit.SECONDS);
            }
        } finally {
            pool.shutdownNow();
            assertThat(pool.awaitTermination(30, TimeUnit.SECONDS)).isTrue();
        }
        assertThat(results).hasSize(requests).containsOnly("OK");
        assertThat(fixture.count("post_bookmarks", publicPostId, viewerId)).isEqualTo(1);
    }

    @Test
    void 목록과상세의_bookmarked는_조회자가_저장했는지를_따른다() throws Exception {
        fixture.bookmark(viewerId, publicPostId, Instant.parse("2026-11-01T00:00:00Z"));
        fixture.bookmark(otherViewerId, privatePostId, Instant.parse("2026-11-01T00:00:00Z"));

        // 조회자 viewer: 공개 글만 저장. (다른 회원이 비공개 글을 저장한 행은 viewer 값에 섞이지 않는다.)
        list(viewerId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items.length()").value(2))
                .andExpect(jsonPath("$.items[0].id").value(privatePostId))
                .andExpect(jsonPath("$.items[0].bookmarked").value(false))
                .andExpect(jsonPath("$.items[1].id").value(publicPostId))
                .andExpect(jsonPath("$.items[1].bookmarked").value(true));
        detail(viewerId, publicPostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(true));
        detail(viewerId, privatePostId)
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.bookmarked").value(false));

        // 저장하지 않은 작성자에게는 false.
        list(publicAuthorId)
                .andExpect(jsonPath("$.items[0].id").value(publicPostId))
                .andExpect(jsonPath("$.items[0].bookmarked").value(false));
        detail(publicAuthorId, publicPostId).andExpect(jsonPath("$.bookmarked").value(false));
    }

    private ResultActions bookmark(long userId, long postId) throws Exception {
        return mockMvc.perform(
                put("/api/v1/posts/{postId}/bookmarks/me", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private ResultActions unbookmark(long userId, long postId) throws Exception {
        return mockMvc.perform(
                delete("/api/v1/posts/{postId}/bookmarks/me", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private ResultActions list(long userId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/posts").header("Authorization", SecurityTestSupport.bearer(userId)));
    }

    private ResultActions detail(long userId, long postId) throws Exception {
        return mockMvc.perform(
                get("/api/v1/posts/{postId}", postId)
                        .header("Authorization", SecurityTestSupport.bearer(userId)));
    }
}
