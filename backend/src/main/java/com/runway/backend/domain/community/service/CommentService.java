package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.CreateCommentRequest;
import com.runway.backend.domain.community.dto.request.UpdateCommentRequest;
import com.runway.backend.domain.community.dto.response.CommentCreateResponse;
import com.runway.backend.domain.community.dto.response.CommentDeleteResponse;
import com.runway.backend.domain.community.dto.response.CommentListItemResponse;
import com.runway.backend.domain.community.dto.response.CommentListResponse;
import com.runway.backend.domain.community.dto.response.CommentUpdateResponse;
import com.runway.backend.domain.community.entity.Comment;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.global.exception.ApiException;
import jakarta.persistence.EntityManager;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CommentService {

    private final CommentRepository commentRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;
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
        postService.requireReadablePost(userId, postId);

        String body = requireNonBlankBody(request == null ? null : request.body());
        Long parentCommentId = request == null ? null : request.parentCommentId();
        if (parentCommentId != null) {
            requireValidParent(postId, parentCommentId);
        }

        Comment comment = Comment.create(postId, userId, body, parentCommentId);
        commentRepository.save(comment);
        commentRepository.flush();
        entityManager.refresh(comment);
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
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_AUTHOR", "작성자만 수정·삭제할 수 있습니다.");
        }
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }

    private static String requireNonBlankBody(String body) {
        if (body == null || body.trim().isEmpty()) {
            throw emptyComment();
        }
        return body.trim();
    }

    private static ApiException emptyComment() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "EMPTY_COMMENT", "댓글 본문이 비어 있습니다.");
    }

    private static ApiException invalidParentComment() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_PARENT_COMMENT", "유효하지 않은 부모 댓글입니다.");
    }

    private static ApiException commentNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "COMMENT_NOT_FOUND", "댓글을 찾을 수 없습니다.");
    }
}
