package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.CreateCommentRequest;
import com.runway.backend.domain.community.dto.request.UpdateCommentRequest;
import com.runway.backend.domain.community.dto.response.CommentCreateResponse;
import com.runway.backend.domain.community.dto.response.CommentDeleteResponse;
import com.runway.backend.domain.community.dto.response.CommentListItemResponse;
import com.runway.backend.domain.community.dto.response.CommentListResponse;
import com.runway.backend.domain.community.dto.response.CommentUpdateResponse;
import com.runway.backend.domain.community.dto.response.PostAuthorResponse;
import com.runway.backend.domain.community.entity.Comment;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.CommentLikeRepository;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository.AuthorRow;
import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.persistence.EntityManager;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

@Service
@RequiredArgsConstructor
public class CommentService {

    private final CommentRepository commentRepository;
    private final CommentLikeRepository commentLikeRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;
    private final NotificationService notificationService;
    private final EntityManager entityManager;

    @Transactional(readOnly = true)
    public CommentListResponse list(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);

        List<Comment> comments = orderRepliesAfterRoot(commentRepository.findVisibleByPostId(postId));
        List<Comment> active = comments.stream().filter(comment -> !comment.isDeleted()).toList();
        // 작성자·좋아요 수·내 좋아요는 표시할 댓글 집합으로 각각 한 번에 조회한다(N+1 없음).
        Map<Long, AuthorRow> authors =
                communityUserQueryRepository.findAuthorsByIds(
                        active.stream().map(Comment::getAuthorId).collect(Collectors.toSet()));
        Set<Long> activeIds = active.stream().map(Comment::getId).collect(Collectors.toSet());
        Map<Long, Long> reactionCounts = new HashMap<>();
        Set<Long> liked = new HashSet<>();
        if (!activeIds.isEmpty()) {
            commentLikeRepository
                    .countByCommentIds(activeIds)
                    .forEach(row -> reactionCounts.put(row.getCommentId(), row.getTotal()));
            liked.addAll(commentLikeRepository.findLikedCommentIds(userId, activeIds));
        }
        List<CommentListItemResponse> items =
                comments.stream()
                        .map(
                                comment ->
                                        comment.isDeleted()
                                                ? CommentListItemResponse.deletedPlaceholder(
                                                        comment)
                                                : CommentListItemResponse.from(
                                                        comment,
                                                        author(comment, authors),
                                                        reactionCounts.getOrDefault(
                                                                comment.getId(), 0L),
                                                        liked.contains(comment.getId())))
                        .toList();
        return new CommentListResponse(items);
    }

    /**
     * 원댓글은 조회 순서(createdAt·id 오름차순)대로 두고, 각 원댓글 바로 뒤에 그 대댓글을 같은 순서로 붙인다. 부모가 목록에 없는 대댓글(정상
     * 경로로는 생기지 않음)은 버리지 않고 끝에 둔다.
     */
    private static List<Comment> orderRepliesAfterRoot(List<Comment> comments) {
        Map<Long, List<Comment>> replies = new HashMap<>();
        Set<Long> rootIds = new HashSet<>();
        for (Comment comment : comments) {
            if (comment.isRoot()) {
                rootIds.add(comment.getId());
            } else {
                replies.computeIfAbsent(comment.getParentCommentId(), key -> new ArrayList<>())
                        .add(comment);
            }
        }
        List<Comment> ordered = new ArrayList<>(comments.size());
        List<Comment> orphans = new ArrayList<>();
        for (Comment comment : comments) {
            if (comment.isRoot()) {
                ordered.add(comment);
                ordered.addAll(replies.getOrDefault(comment.getId(), List.of()));
            } else if (!rootIds.contains(comment.getParentCommentId())) {
                orphans.add(comment);
            }
        }
        ordered.addAll(orphans);
        return ordered;
    }

    @Transactional
    public CommentCreateResponse create(long userId, long postId, CreateCommentRequest request) {
        requireExistingUser(userId);
        Post post = postService.requireReadablePost(userId, postId);

        String body = requireNonBlankBody(request == null ? null : request.body());
        Long parentCommentId = request == null ? null : request.parentCommentId();
        if (parentCommentId != null) {
            requireValidParent(postId, parentCommentId);
        }

        Comment comment = Comment.create(postId, userId, body, parentCommentId);
        commentRepository.save(comment);
        commentRepository.flush();
        entityManager.refresh(comment);
        if (comment.getId() != null && !post.getAuthorId().equals(userId)) {
            notificationService.create(
                    post.getAuthorId(),
                    NotificationType.POST_COMMENT,
                    postId,
                    "게시물에 새 댓글이 달렸습니다.",
                    "POST_COMMENT:" + comment.getId());
        }
        Map<Long, AuthorRow> authors = communityUserQueryRepository.findAuthorsByIds(Set.of(userId));
        return CommentCreateResponse.from(comment, author(comment, authors));
    }

    @Transactional
    public CommentUpdateResponse update(long userId, long commentId, UpdateCommentRequest request) {
        requireExistingUser(userId);
        Comment comment = requireActiveComment(commentId);
        requireAuthor(comment, userId);

        String body = requireNonBlankBody(request == null ? null : request.body());
        comment.updateBody(body);
        commentRepository.flush();
        entityManager.refresh(comment);
        return CommentUpdateResponse.from(comment);
    }

    @Transactional
    public CommentDeleteResponse delete(long userId, long commentId) {
        requireExistingUser(userId);
        Comment comment = requireActiveComment(commentId);
        requireAuthor(comment, userId);

        Instant deletedAt = Instant.now();
        comment.softDelete(deletedAt);
        return new CommentDeleteResponse(comment.getDeletedAt());
    }

    private static PostAuthorResponse author(Comment comment, Map<Long, AuthorRow> authors) {
        return PostAuthorResponse.of(comment.getAuthorId(), authors.get(comment.getAuthorId()));
    }

    private void requireValidParent(long postId, long parentCommentId) {
        Comment parent =
                commentRepository
                        .findByIdAndDeletedAtIsNull(parentCommentId)
                        .orElseThrow(CommentService::invalidParentComment);
        if (!parent.getPostId().equals(postId) || !parent.isRoot()) {
            throw invalidParentComment();
        }
    }

    private Comment requireActiveComment(long commentId) {
        return commentRepository
                .findByIdAndDeletedAtIsNull(commentId)
                .orElseThrow(CommentService::commentNotFound);
    }

    private void requireAuthor(Comment comment, long userId) {
        if (!comment.isAuthoredBy(userId)) {
            throw new ApiException(ErrorCode.NOT_AUTHOR, "수정·삭제");
        }
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }

    private static String requireNonBlankBody(String body) {
        if (body == null || body.trim().isEmpty()) {
            throw emptyComment();
        }
        return body.trim();
    }

    private static ApiException emptyComment() {
        return new ApiException(ErrorCode.EMPTY_COMMENT);
    }

    private static ApiException invalidParentComment() {
        return new ApiException(ErrorCode.INVALID_PARENT_COMMENT);
    }

    private static ApiException commentNotFound() {
        return new ApiException(ErrorCode.COMMENT_NOT_FOUND);
    }
}
