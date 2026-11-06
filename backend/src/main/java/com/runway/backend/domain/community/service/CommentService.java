package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.CreateCommentRequest;
import com.runway.backend.domain.community.dto.request.UpdateCommentRequest;
import com.runway.backend.domain.community.dto.response.CommentCreateResponse;
import com.runway.backend.domain.community.dto.response.CommentDeleteResponse;
import com.runway.backend.domain.community.dto.response.CommentListItemResponse;
import com.runway.backend.domain.community.dto.response.CommentListResponse;
import com.runway.backend.domain.community.dto.response.CommentUpdateResponse;
import com.runway.backend.domain.community.entity.Comment;
import com.runway.backend.domain.community.entity.Post;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.notification.NotificationType;
import com.runway.backend.domain.notification.service.NotificationService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import jakarta.persistence.EntityManager;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.Instant;
import java.util.List;

@Service
@RequiredArgsConstructor
public class CommentService {

    private final CommentRepository commentRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;
    private final NotificationService notificationService;
    private final EntityManager entityManager;

    @Transactional(readOnly = true)
    public CommentListResponse list(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);

        List<CommentListItemResponse> items =
                commentRepository.findActiveByPostId(postId).stream()
                        .map(CommentListItemResponse::from)
                        .toList();
        return new CommentListResponse(items);
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
        return CommentCreateResponse.from(comment);
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
