package com.runway.backend.domain.community.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.argThat;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.community.dto.response.PostListItemResponse;
import com.runway.backend.domain.community.dto.response.PostListResponse;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.PostBookmarkRepository;
import com.runway.backend.domain.community.repository.PostLikeRepository;
import com.runway.backend.domain.community.repository.PostPageQueryRepository;
import com.runway.backend.domain.community.repository.PostRepository;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository;
import jakarta.persistence.EntityManager;
import java.util.Collection;
import java.util.List;
import java.util.Set;
import java.util.stream.LongStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * S15P31E105-634 AC-2: 목록 항목 수와 관계없이 조회자 스크랩 여부를 IN 조회 한 번으로 모으고(N+1 없음), 그 결과가 게시물별 bookmarked에
 * 정확히 대응한다. DB 결과·응답 값은 통합 테스트(PostBookmarkApiIntegrationTest)에서 함께 확인한다.
 */
@ExtendWith(MockitoExtension.class)
class PostServiceListViewsTest {

    private static final long VIEWER = 7L;

    @Mock private PostRepository postRepository;
    @Mock private RunningSessionLookupRepository runningSessionLookupRepository;
    @Mock private AccountVisibilityRepository accountVisibilityRepository;
    @Mock private CommunityUserQueryRepository communityUserQueryRepository;
    @Mock private CommentRepository commentRepository;
    @Mock private PostLikeRepository postLikeRepository;
    @Mock private PostBookmarkRepository postBookmarkRepository;
    @Mock private PostPageQueryRepository postPageQueryRepository;
    @Mock private EntityManager entityManager;

    @InjectMocks private PostService postService;

    @Test
    void 게시물이_여러개여도_스크랩과_좋아요를_각각_한번씩_IN조회한다() {
        List<Long> ids = LongStream.rangeClosed(1, 30).boxed().toList().reversed();
        List<Post> posts = ids.stream().map(PostServiceListViewsTest::post).toList();
        when(communityUserQueryRepository.existsById(VIEWER)).thenReturn(true);
        when(postPageQueryRepository.findVisiblePostIds(VIEWER, false, null, null, null))
                .thenReturn(ids);
        when(postRepository.findAllById(ids)).thenReturn(posts);
        when(postBookmarkRepository.findBookmarkedPostIds(eq(VIEWER), anyCollection()))
                .thenReturn(List.of(3L, 17L));

        // 페이지를 자르지 않는 전체 조회(U21 경로)로 30개를 한 번에 확인한다.
        PostListResponse response = postService.list(VIEWER, null, null);

        assertThat(response.items()).hasSize(30);
        assertThat(response.items())
                .filteredOn(PostListItemResponse::bookmarked)
                .extracting(PostListItemResponse::id)
                .containsExactly(17L, 3L);
        assertThat(response.hasNext()).isFalse();
        assertThat(response.nextCursor()).isNull();
        verify(postBookmarkRepository, times(1))
                .findBookmarkedPostIds(eq(VIEWER), argThat(PostServiceListViewsTest::allThirty));
        verify(postLikeRepository, times(1)).findLikedPostIds(anyLong(), anyCollection());
        verify(postRepository, times(1)).findAllById(ids);
    }

    private static boolean allThirty(Collection<Long> postIds) {
        return Set.copyOf(postIds).equals(Set.copyOf(LongStream.rangeClosed(1, 30).boxed().toList()));
    }

    private static Post post(long id) {
        Post post = Post.create(100L + id, 200L + id, "본문 " + id, null, null, false);
        ReflectionTestUtils.setField(post, "id", id);
        return post;
    }
}
