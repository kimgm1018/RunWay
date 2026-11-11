package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.UpsertReactionRequest;
import com.runway.backend.domain.community.dto.response.CommentReactionResponse;
import com.runway.backend.domain.community.entity.Comment;
import com.runway.backend.domain.community.repository.CommentLikeRepository;
import com.runway.backend.domain.community.repository.CommentRepository;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CMT14·CMT15 댓글 좋아요. 삭제되지 않은 댓글에만, 부모 게시물을 볼 수 있는 회원만 등록·취소한다. 등록·취소 모두 멱등이며 응답은 처리 직후의
 * 좋아요 수와 내 반응이다.
 */
@Service
@RequiredArgsConstructor
public class CommentLikeService {

    private static final String LIKE = "LIKE";

    private final CommentRepository commentRepository;
    private final CommentLikeRepository commentLikeRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;

    @Transactional
    public CommentReactionResponse upsert(
            long userId, long commentId, UpsertReactionRequest request) {
        Comment comment = requireLikableComment(userId, commentId);
        requireLikeType(request == null ? null : request.reactionType());
        // 이미 있으면 INSERT 트리거(회원 행 NOWAIT 잠금)를 타지 않고 그대로 성공한다(PostLikeService와 같음).
        if (!commentLikeRepository.existsByCommentIdAndUserId(comment.getId(), userId)) {
            // 동시 요청은 유니크 제약에서 한쪽이 건너뛰므로 중복 행·예외 없이 같은 결과가 된다.
            commentLikeRepository.insertIfAbsent(comment.getId(), userId);
        }
        return new CommentReactionResponse(
                comment.getId(), commentLikeRepository.countByCommentId(comment.getId()), LIKE);
    }

    @Transactional
    public CommentReactionResponse delete(long userId, long commentId) {
        Comment comment = requireLikableComment(userId, commentId);
        commentLikeRepository.deleteByCommentIdAndUserId(comment.getId(), userId);
        return new CommentReactionResponse(
                comment.getId(), commentLikeRepository.countByCommentId(comment.getId()), null);
    }

    private Comment requireLikableComment(long userId, long commentId) {
        requireExistingUser(userId);
        Comment comment =
                commentRepository
                        .findByIdAndDeletedAtIsNull(commentId)
                        .orElseThrow(() -> new ApiException(ErrorCode.COMMENT_NOT_FOUND));
        // 게시물이 삭제됐거나 볼 수 없으면 CMT06·CMT07과 같은 접근 규칙으로 거절한다.
        postService.requireReadablePost(userId, comment.getPostId());
        return comment;
    }

    private static void requireLikeType(String reactionType) {
        if (reactionType == null || reactionType.isBlank()) {
            return;
        }
        if (!LIKE.equals(reactionType.trim())) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_COMMUNITY_REQUIRE_LIKE_TYPE);
        }
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }
}
