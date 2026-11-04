package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.CreatePostRequest;
import com.runway.backend.domain.community.dto.request.UpdatePostRequest;
import com.runway.backend.domain.community.dto.response.PostCreateResponse;
import com.runway.backend.domain.community.dto.response.PostDeleteResponse;
import com.runway.backend.domain.community.dto.response.PostDetailResponse;
import com.runway.backend.domain.community.dto.response.PostListItemResponse;
import com.runway.backend.domain.community.dto.response.PostListResponse;
import com.runway.backend.domain.community.dto.response.PostUpdateResponse;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.AccountVisibilityRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.PostRepository;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository;
import com.runway.backend.domain.community.repository.RunningSessionLookupRepository.SessionShareInfo;
import com.runway.backend.domain.community.repository.UserFollowLookupRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.persistence.EntityManager;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class PostService {

    private static final String SCOPE_ALL = "ALL";
    private static final String SCOPE_FOLLOWING = "FOLLOWING";

    private final PostRepository postRepository;
    private final RunningSessionLookupRepository runningSessionLookupRepository;
    private final AccountVisibilityRepository accountVisibilityRepository;
    private final UserFollowLookupRepository userFollowLookupRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
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

        Post post =
                Post.create(
                        userId,
                        request.sessionId(),
                        blankToNull(request.body()),
                        blankToNull(request.imageKey()),
                        blankToNull(request.regionCode()));
        postRepository.save(post);
        postRepository.flush();
        entityManager.refresh(post);
        return PostCreateResponse.from(post, session.courseId());
    }

    @Transactional(readOnly = true)
    public PostListResponse list(long userId, String scope, Long authorId) {
        requireExistingUser(userId);
        String resolvedScope = resolveScope(scope);

        List<Post> posts;
        if (SCOPE_FOLLOWING.equals(resolvedScope)) {
            Set<Long> authorIds =
                    new HashSet<>(userFollowLookupRepository.findApprovedFolloweeIds(userId));
            authorIds.add(userId);
            if (authorId != null && !authorIds.contains(authorId)) {
                return new PostListResponse(List.of());
            }
            posts = postRepository.findActiveByAuthorIds(authorIds, authorId);
        } else {
            posts = postRepository.findActive(authorId);
        }

        if (posts.isEmpty()) {
            return new PostListResponse(List.of());
        }

        Set<Long> authorIds = posts.stream().map(Post::getAuthorId).collect(Collectors.toSet());
        Map<Long, String> visibilityByAuthor = accountVisibilityRepository.findByUserIds(authorIds);
        Set<Long> approvedFollowees =
                userFollowLookupRepository.findApprovedFolloweeIdsAmong(userId, authorIds);

        List<Post> visible =
                posts.stream()
                        .filter(
                                post ->
                                        canView(
                                                userId,
                                                post.getAuthorId(),
                                                visibilityByAuthor.get(post.getAuthorId()),
                                                approvedFollowees))
                        .toList();
        if (visible.isEmpty()) {
            return new PostListResponse(List.of());
        }

        Map<Long, String> nicknames =
                communityUserQueryRepository.findNicknamesByIds(
                        visible.stream().map(Post::getAuthorId).collect(Collectors.toSet()));
        Map<Long, SessionShareInfo> sessions =
                runningSessionLookupRepository.findByIds(
                        visible.stream().map(Post::getSessionId).collect(Collectors.toSet()));

        List<PostListItemResponse> items =
                visible.stream()
                        .map(
                                post ->
                                        PostListItemResponse.from(
                                                post,
                                                nicknames.get(post.getAuthorId()),
                                                sessions.get(post.getSessionId())))
                        .toList();
        return new PostListResponse(items);
    }

    @Transactional(readOnly = true)
    public PostDetailResponse getDetail(long userId, long postId) {
        requireExistingUser(userId);
        Post post = requireReadablePost(userId, postId);

        String nickname =
                communityUserQueryRepository.findNickname(post.getAuthorId()).orElse(null);
        SessionShareInfo session =
                runningSessionLookupRepository.findById(post.getSessionId()).orElse(null);
        return PostDetailResponse.from(post, nickname, session);
    }

    public Post requireReadablePost(long userId, long postId) {
        Post post = requireActivePost(postId);
        requireAccountAccess(userId, post.getAuthorId());
        return post;
    }

    @Transactional
    public PostUpdateResponse update(long userId, long postId, UpdatePostRequest request) {
        requireExistingUser(userId);
        Post post = requireActivePost(postId);
        if (!post.isAuthoredBy(userId)) {
            throw new ApiException(ErrorCode.NOT_AUTHOR, "수정");
        }
        post.updateBody(blankToNull(request.body()));
        postRepository.flush();
        entityManager.refresh(post);
        return PostUpdateResponse.from(post);
    }

    @Transactional
    public PostDeleteResponse delete(long userId, long postId) {
        requireExistingUser(userId);
        Post post = requireActivePost(postId);
        if (!post.isAuthoredBy(userId)) {
            throw new ApiException(ErrorCode.NOT_AUTHOR, "삭제");
        }
        Instant deletedAt = Instant.now();
        post.softDelete(deletedAt);
        return new PostDeleteResponse(post.getDeletedAt());
    }

    private Post requireActivePost(long postId) {
        return postRepository
                .findByIdAndDeletedAtIsNull(postId)
                .orElseThrow(PostService::postNotFound);
    }

    private void requireAccountAccess(long viewerId, long authorId) {
        if (viewerId == authorId) {
            return;
        }
        String visibility =
                accountVisibilityRepository
                        .findByUserId(authorId)
                        .orElse(AccountVisibilityRepository.PRIVATE);
        if (AccountVisibilityRepository.PUBLIC.equals(visibility)) {
            return;
        }
        if (userFollowLookupRepository.isApprovedFollower(viewerId, authorId)) {
            return;
        }
        throw new ApiException(ErrorCode.ACCOUNT_ACCESS_DENIED);
    }

    private static boolean canView(
            long viewerId, long authorId, String visibility, Set<Long> approvedFollowees) {
        if (viewerId == authorId) {
            return true;
        }
        String resolved = visibility == null ? AccountVisibilityRepository.PRIVATE : visibility;
        if (AccountVisibilityRepository.PUBLIC.equals(resolved)) {
            return true;
        }
        return approvedFollowees.contains(authorId);
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
