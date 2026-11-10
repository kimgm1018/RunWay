package com.runway.backend.domain.community.dto.response;

/**
 * 게시물 응답의 조회자 기준 파생값. courseId는 courseShared=false이고 조회자가 작성자가 아니면 null이다.
 *
 * @param courseId 조회자에게 보여 줄 연결 세션 코스 ID
 * @param courseShared 저장된 공유 여부와 세션 코스 존재를 함께 본 값
 * @param commentCount 삭제되지 않은 댓글 수(대댓글 포함)
 * @param reactionCount 좋아요 수
 * @param liked 조회자의 좋아요 여부
 * @param bookmarked 조회자의 스크랩(저장) 여부
 */
public record PostEngagement(
        Long courseId,
        boolean courseShared,
        long commentCount,
        long reactionCount,
        boolean liked,
        boolean bookmarked) {

    public static final String LIKE = "LIKE";

    public String myReaction() {
        return liked ? LIKE : null;
    }
}
