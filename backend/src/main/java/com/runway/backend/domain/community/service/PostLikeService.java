package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.request.UpsertReactionRequest;
import com.runway.backend.domain.community.dto.response.ReactionUpsertResponse;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.PostLikeRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.Map;

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

        // 이미 있으면 INSERT하지 않는다. INSERT는 BEFORE 트리거(rw_active_owner)가 회원 행을 NOWAIT로 잠가 같은 회원의
        // 로그인·프로필 저장 잠금과 겹치면 503이 되므로, 멱등 재요청은 트리거를 타지 않게 한다.
        if (!postLikeRepository.existsByPostIdAndUserId(postId, userId)) {
            // 동시 요청은 유니크 제약에서 한쪽이 건너뛰므로 중복 행·예외(롤백 전용 트랜잭션) 없이 같은 결과가 된다.
            postLikeRepository.insertIfAbsent(postId, userId);
        }
        return new ReactionUpsertResponse(postId, userId);
    }

    @Transactional
    public Map<String, Object> delete(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);
        postLikeRepository.deleteByPostIdAndUserId(postId, userId);
        return Map.of();
    }

    private void requireLikeType(String reactionType) {
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
