package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.CreatePostRequest;
import com.runway.backend.domain.community.dto.request.UpdatePostRequest;
import com.runway.backend.domain.community.dto.response.PostAuthorResponse;
import com.runway.backend.domain.community.dto.response.PostCreateResponse;
import com.runway.backend.domain.community.dto.response.PostDeleteResponse;
import com.runway.backend.domain.community.dto.response.PostDetailResponse;
import com.runway.backend.domain.community.dto.response.PostEngagement;
import com.runway.backend.domain.community.dto.response.PostListItemResponse;
import com.runway.backend.domain.community.dto.response.PostListResponse;
import com.runway.backend.domain.community.dto.response.PostUpdateResponse;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository.AuthorRow;
import com.runway.backend.domain.community.repository.PostCount;
import com.runway.backend.domain.community.repository.PostBookmarkRepository;
import com.runway.backend.domain.community.repository.PostLikeRepository;
import com.runway.backend.domain.community.repository.PostPageQueryRepository;
import com.runway.backend.domain.community.repository.PostPageQueryRepository.Activity;
import com.runway.backend.domain.community.repository.PostPageQueryRepository.ActivityRow;
import com.runway.backend.domain.community.repository.PostRepository;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import com.runway.backend.domain.community.service.PostPageCursor.ActivityCursor;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.persistence.EntityManager;
import jakarta.persistence.LockModeType;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PostService {

    private static final String SCOPE_ALL = "ALL";
    private static final String SCOPE_FOLLOWING = "FOLLOWING";

    private final PostRepository postRepository;
    private final RunningSessionLookupRepository runningSessionLookupRepository;
    private final AccountVisibilityRepository accountVisibilityRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final CommentRepository commentRepository;
    private final PostLikeRepository postLikeRepository;
    private final PostBookmarkRepository postBookmarkRepository;
    private final PostPageQueryRepository postPageQueryRepository;
    private final EntityManager entityManager;

    @Transactional
    public PostCreateResponse create(long userId, CreatePostRequest request) {
        requireExistingUser(userId);
        // S09와 동일하게 세션→게시물 순서로 잠근다. 잠금 아래서 미삭제·COMPLETED를 재확인한다.
        SessionShareInfo session =
                runningSessionLookupRepository
                        .findByIdForUpdate(request.sessionId())
                        .orElseThrow(PostService::invalidPost);
        if (session.userId() != userId) {
            throw new ApiException(ErrorCode.RESOURCE_NOT_OWNED);
        }
        if (session.isDeleted() || !session.isCompleted()) {
            throw invalidPost();
        }

        // 생략은 공유(true). 세션에 코스가 없으면 공유할 코스가 없으므로 false로 저장한다.
        boolean courseShared =
                session.courseId() != null && !Boolean.FALSE.equals(request.courseShared());
        Post post =
                Post.create(
                        userId,
                        request.sessionId(),
                        blankToNull(request.body()),
                        blankToNull(request.imageKey()),
                        blankToNull(request.regionCode()),
                        courseShared);
        postRepository.save(post);
        postRepository.flush();
        entityManager.refresh(post);
        return PostCreateResponse.from(post, session.courseId());
    }

    /**
     * U21 러너 프로필 등 페이지를 쓰지 않는 서버 내부 호출용. 페이지를 자르지 않고 볼 수 있는 글 전체를 반환한다. CMT02는 S15P31E105-647부터
     * 파라미터가 없어도 기본 20개 페이지를 적용하므로 이 경로와 분리한다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PostListResponse list(long userId, String scope, Long authorId) {
        requireExistingUser(userId);
        boolean following = SCOPE_FOLLOWING.equals(resolveScope(scope));
        List<Long> ids =
                postPageQueryRepository.findVisiblePostIds(userId, following, authorId, null, null);
        return PostListResponse.lastPage(toListItems(userId, ids));
    }

    /**
     * CMT02. limit(생략 시 기본 20, 최대 50)개씩 id 내림차순으로 자른다. 파라미터가 없어도 첫 페이지 20개다(S15P31E105-647). 삭제·접근 불가 글은 SQL에서 먼저 제외하므로 한 페이지가 limit보다 적어도 hasNext는 정확하다. ID 조회와
     * 게시물·집계 조회가 같은 스냅샷을 보도록 REPEATABLE READ로 읽는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PostListResponse list(
            long userId, String scope, Long authorId, String cursor, Integer limit) {
        return list(userId, scope, authorId, null, cursor, limit);
    }

    /**
     * CMT02 지역 필터(S15P31E105-687). regionCode가 비어 있으면 전국이다. 시/도 코드는 그 시/도 전체, 시/군/구 코드는 그 시/군/구(하위 구
     * 포함)이며, 지역을 고르면 지역이 비어 있는 글은 보이지 않는다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PostListResponse list(
            long userId,
            String scope,
            Long authorId,
            String regionCode,
            String cursor,
            Integer limit) {
        requireExistingUser(userId);
        String region = blankToNull(regionCode);
        String resolvedScope = resolveScope(scope);
        boolean following = SCOPE_FOLLOWING.equals(resolvedScope);
        int pageSize = PostPageCursor.resolveLimit(limit);
        Long beforeId =
                cursor == null
                        ? null
                        : PostPageCursor.decodeFeed(
                                cursor, userId, resolvedScope, authorId, region);
        List<Long> ids =
                postPageQueryRepository.findVisiblePostIds(
                        userId, following, authorId, region, beforeId, pageSize + 1);
        boolean hasNext = ids.size() > pageSize;
        List<Long> page = ids.subList(0, Math.min(ids.size(), pageSize));
        String nextCursor =
                hasNext
                        ? PostPageCursor.encodeFeed(
                                userId, resolvedScope, authorId, region, page.getLast())
                        : null;
        return new PostListResponse(toListItems(userId, page), nextCursor, hasNext);
    }

    /**
     * CMT18 내 스크랩·CMT19 내 좋아요. 본인 관계만 읽고 관계 생성 시각·ID 최신 순이다. 삭제됐거나 지금 볼 수 없는 게시물(작성자 비공개 전환·팔로우
     * 해제·탈퇴)은 SQL에서 제외한 뒤 페이지를 자른다.
     */
    @Transactional(readOnly = true, isolation = Isolation.REPEATABLE_READ)
    public PostListResponse listMyActivity(
            long userId, Activity activity, String cursor, Integer limit) {
        requireExistingUser(userId);
        int pageSize = PostPageCursor.resolveLimit(limit);
        ActivityCursor after =
                cursor == null ? null : PostPageCursor.decodeActivity(cursor, userId, activity);
        List<ActivityRow> rows =
                postPageQueryRepository.findActivity(
                        userId,
                        activity,
                        after == null ? null : after.createdAt(),
                        after == null ? 0L : after.id(),
                        pageSize + 1);
        boolean hasNext = rows.size() > pageSize;
        List<ActivityRow> page = rows.subList(0, Math.min(rows.size(), pageSize));
        String nextCursor = null;
        if (hasNext) {
            ActivityRow last = page.getLast();
            nextCursor =
                    PostPageCursor.encodeActivity(userId, activity, last.createdAt(), last.id());
        }
        List<Long> postIds = page.stream().map(ActivityRow::postId).toList();
        return new PostListResponse(toListItems(userId, postIds), nextCursor, hasNext);
    }

    /** 주어진 순서대로 목록 항목을 만든다. 게시물과 표시값은 게시물 수와 관계없이 IN 조회로 모은다. */
    private List<PostListItemResponse> toListItems(long viewerId, List<Long> orderedPostIds) {
        if (orderedPostIds.isEmpty()) {
            return List.of();
        }
        Map<Long, Post> byId =
                postRepository.findAllById(orderedPostIds).stream()
                        .collect(Collectors.toMap(Post::getId, Function.identity()));
        List<Post> posts =
                orderedPostIds.stream().map(byId::get).filter(Objects::nonNull).toList();
        if (posts.isEmpty()) {
            return List.of();
        }
        PostViews views = loadViews(viewerId, posts);
        return posts.stream()
                .map(
                        post ->
                                PostListItemResponse.from(
                                        post,
                                        views.author(post),
                                        views.session(post),
                                        views.engagement(viewerId, post)))
                .toList();
    }

    @Transactional(readOnly = true)
    public PostDetailResponse getDetail(long userId, long postId) {
        requireExistingUser(userId);
        Post candidate=postRepository.findById(postId).orElseThrow(PostService::postNotFound);
        if (candidate.isDeleted() && "탈퇴한 회원의 게시물입니다.".equals(candidate.getBody())
                && communityUserQueryRepository.withdrawn(candidate.getAuthorId()))
            throw new ApiException(ErrorCode.WITHDRAWN_POST);
        Post post = requireReadablePost(userId, postId);

        PostViews views = loadViews(userId, List.of(post));
        return PostDetailResponse.from(
                post, views.author(post), views.session(post), views.engagement(userId, post));
    }

    public Post requireReadablePost(long userId, long postId) {
        Post post = requireActivePost(postId);
        requireAccountAccess(userId, post.getAuthorId());
        return post;
    }

    @Transactional
    public PostUpdateResponse update(long userId, long postId, UpdatePostRequest request) {
        requireExistingUser(userId);
        LockedPost locked = lockOwnActivePost(userId, postId, "수정");
        Post post = locked.post();
        if (request.bodyPresent()) {
            post.updateBody(blankToNull(request.body()));
        }
        Long courseId = locked.session() == null ? null : locked.session().courseId();
        if (courseId == null) {
            // 공유할 코스가 없으면 요청 값과 무관하게 false로 둔다. V27 이전 자유 러닝 게시물도 여기서 false가 된다.
            post.updateCourseShared(false);
        } else if (request.courseShared() != null) {
            post.updateCourseShared(request.courseShared());
        }
        postRepository.flush();
        entityManager.refresh(post);
        return PostUpdateResponse.from(post, post.isCourseShared() && courseId != null);
    }

    @Transactional
    public PostDeleteResponse delete(long userId, long postId) {
        requireExistingUser(userId);
        Post post = lockOwnActivePost(userId, postId, "삭제").post();
        Instant deletedAt = Instant.now();
        post.softDelete(deletedAt);
        return new PostDeleteResponse(post.getDeletedAt());
    }

    /** 작성자, 세션, 댓글 수, 좋아요 수, 조회자 좋아요·스크랩을 게시물 수와 관계없이 각각 IN 조회 한 번으로 모은다. */
    private PostViews loadViews(long viewerId, List<Post> posts) {
        Set<Long> postIds = posts.stream().map(Post::getId).collect(Collectors.toSet());
        Map<Long, AuthorRow> authors =
                communityUserQueryRepository.findAuthorsByIds(
                        posts.stream().map(Post::getAuthorId).collect(Collectors.toSet()));
        Map<Long, SessionShareInfo> sessions =
                runningSessionLookupRepository.findByIds(
                        posts.stream().map(Post::getSessionId).collect(Collectors.toSet()));
        Map<Long, Long> commentCounts =
                toCountMap(commentRepository.countActiveByPostIds(postIds));
        Map<Long, Long> reactionCounts = toCountMap(postLikeRepository.countByPostIds(postIds));
        Set<Long> liked = new HashSet<>(postLikeRepository.findLikedPostIds(viewerId, postIds));
        Set<Long> bookmarked =
                new HashSet<>(postBookmarkRepository.findBookmarkedPostIds(viewerId, postIds));
        return new PostViews(authors, sessions, commentCounts, reactionCounts, liked, bookmarked);
    }

    private static Map<Long, Long> toCountMap(List<PostCount> counts) {
        return counts.stream()
                .collect(Collectors.toMap(PostCount::getPostId, PostCount::getTotal));
    }

    private record PostViews(
            Map<Long, AuthorRow> authors,
            Map<Long, SessionShareInfo> sessions,
            Map<Long, Long> commentCounts,
            Map<Long, Long> reactionCounts,
            Set<Long> liked,
            Set<Long> bookmarked) {

        PostAuthorResponse author(Post post) {
            return PostAuthorResponse.of(post.getAuthorId(), authors.get(post.getAuthorId()));
        }

        SessionShareInfo session(Post post) {
            return sessions.get(post.getSessionId());
        }

        /** courseShared=false이면 작성자 본인에게만 courseId를 보여 준다(수정 화면용). */
        PostEngagement engagement(long viewerId, Post post) {
            SessionShareInfo session = session(post);
            Long sessionCourseId = session == null ? null : session.courseId();
            boolean courseShared = post.isCourseShared() && sessionCourseId != null;
            Long courseId = courseShared || post.isAuthoredBy(viewerId) ? sessionCourseId : null;
            return new PostEngagement(
                    courseId,
                    courseShared,
                    commentCounts.getOrDefault(post.getId(), 0L),
                    reactionCounts.getOrDefault(post.getId(), 0L),
                    liked.contains(post.getId()),
                    bookmarked.contains(post.getId()));
        }
    }

    /**
     * CMT04·CMT05 쓰기용. CMT01·S09와 같은 세션→게시물 순서로 잠가 S09 삭제·다른 수정·삭제와 직렬화한다. 잠금 전에 읽은
     * 값은 낡았을 수 있으므로 게시물을 잠금과 함께 다시 읽고 미삭제를 재확인한다. 그래야 전체 열 UPDATE가 먼저 커밋된
     * {@code deleted_at}·{@code course_shared}를 낡은 값으로 덮지 않는다.
     */
    private LockedPost lockOwnActivePost(long userId, long postId, String action) {
        Post post = requireActivePost(postId);
        if (!post.isAuthoredBy(userId)) {
            throw new ApiException(ErrorCode.NOT_AUTHOR, action);
        }
        // session_id·author_id는 바뀌지 않으므로 잠금 전에 읽은 값으로 세션을 잠가도 된다.
        SessionShareInfo session =
                runningSessionLookupRepository.findByIdForUpdate(post.getSessionId()).orElse(null);
        entityManager.refresh(post, LockModeType.PESSIMISTIC_WRITE);
        if (post.isDeleted()) {
            throw postNotFound();
        }
        return new LockedPost(post, session);
    }

    private record LockedPost(Post post, SessionShareInfo session) {}

    private Post requireActivePost(long postId) {
        return postRepository
                .findByIdAndDeletedAtIsNull(postId)
                .orElseThrow(PostService::postNotFound);
    }

    private void requireAccountAccess(long viewerId, long authorId) {
        if (accountVisibilityRepository.canAccess(viewerId, authorId)) {
            return;
        }
        throw new ApiException(ErrorCode.ACCOUNT_ACCESS_DENIED);
    }

    private static String resolveScope(String scope) {
        if (scope == null || scope.isBlank()) {
            return SCOPE_ALL;
        }
        String trimmed = scope.trim();
        if (SCOPE_ALL.equals(trimmed) || SCOPE_FOLLOWING.equals(trimmed)) {
            return trimmed;
        }
        throw new ApiException(ErrorCode.POST_SCOPE_INVALID);
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }

    private static ApiException postNotFound() {
        return new ApiException(ErrorCode.POST_NOT_FOUND);
    }

    private static ApiException invalidPost() {
        return new ApiException(ErrorCode.INVALID_POST);
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
