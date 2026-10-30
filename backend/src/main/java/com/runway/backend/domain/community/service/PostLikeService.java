package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.UpsertReactionRequest;
import com.runway.backend.domain.community.dto.response.ReactionUpsertResponse;
import com.runway.backend.domain.community.entity.PostLike;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.PostLikeRepository;
import com.runway.backend.global.exception.ApiException;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class PostLikeService {

    private static final String LIKE = "LIKE";

    private final PostLikeRepository postLikeRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;

    @Transactional
    public ReactionUpsertResponse upsert(long userId, long postId, UpsertReactionRequest request) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);
        requireLikeType(request == null ? null : request.reactionType());

        return postLikeRepository
                .findByPostIdAndUserId(postId, userId)
                .map(existing -> new ReactionUpsertResponse(existing.getPostId(), existing.getUserId()))
                .orElseGet(() -> insertLike(postId, userId));
    }

    @Transactional
    public Map<String, Object> delete(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);
        postLikeRepository.deleteByPostIdAndUserId(postId, userId);
        return Map.of();
    }

    private ReactionUpsertResponse insertLike(long postId, long userId) {
        try {
            PostLike saved = postLikeRepository.save(PostLike.create(postId, userId));
            return new ReactionUpsertResponse(saved.getPostId(), saved.getUserId());
        } catch (DataIntegrityViolationException ex) {
            PostLike existing =
                    postLikeRepository
                            .findByPostIdAndUserId(postId, userId)
                            .orElseThrow(() -> ex);
            return new ReactionUpsertResponse(existing.getPostId(), existing.getUserId());
        }
    }

    private void requireLikeType(String reactionType) {
        if (reactionType == null || reactionType.isBlank()) {
            return;
        }
        if (!LIKE.equals(reactionType.trim())) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "reactionType은 LIKE만 지원합니다.");
        }
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }
}
