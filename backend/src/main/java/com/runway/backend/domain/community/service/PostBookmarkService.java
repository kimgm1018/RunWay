package com.runway.backend.domain.community.service;

import com.runway.backend.domain.community.dto.response.PostBookmarkResponse;
import com.runway.backend.domain.community.repository.CommunityUserQueryRepository;
import com.runway.backend.domain.community.repository.PostBookmarkRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * CMT16 스크랩 등록·CMT17 스크랩 해제. 게시물 접근 규칙은 좋아요(CMT10·CMT11)와 같다(삭제·없음 POST_NOT_FOUND, 볼 수 없음
 * ACCOUNT_ACCESS_DENIED). 둘 다 멱등이며 자기 글도 저장할 수 있다.
 */
@Service
@RequiredArgsConstructor
public class PostBookmarkService {

    private final PostBookmarkRepository postBookmarkRepository;
    private final CommunityUserQueryRepository communityUserQueryRepository;
    private final PostService postService;

    @Transactional
    public PostBookmarkResponse bookmark(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);
        // 이미 있으면 INSERT 트리거(회원 행 NOWAIT 잠금)를 타지 않고 그대로 성공한다(PostLikeService와 같음).
        if (!postBookmarkRepository.existsByPostIdAndUserId(postId, userId)) {
            // 동시 등록도 유니크 제약 + ON CONFLICT DO NOTHING으로 한 행만 남는다.
            postBookmarkRepository.insertIfAbsent(postId, userId);
        }
        return new PostBookmarkResponse(postId, true);
    }

    @Transactional
    public PostBookmarkResponse unbookmark(long userId, long postId) {
        requireExistingUser(userId);
        postService.requireReadablePost(userId, postId);
        postBookmarkRepository.deleteByPostIdAndUserId(postId, userId);
        return new PostBookmarkResponse(postId, false);
    }

    private void requireExistingUser(long userId) {
        if (!communityUserQueryRepository.existsById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
    }
}
