package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.CommentLike;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentLikeRepository extends JpaRepository<CommentLike, Long> {

    /**
     * 좋아요를 넣는다. 이미 있으면 아무것도 하지 않는다. 동시 요청은 유니크 제약(comment_id,user_id)에서 한쪽이 기다렸다가 건너뛰므로
     * 예외로 트랜잭션이 깨지지 않는다.
     */
    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query(
            value =
                    """
                    INSERT INTO comment_likes(comment_id, user_id) VALUES (:commentId, :userId)
                    ON CONFLICT (comment_id, user_id) DO NOTHING
                    """,
            nativeQuery = true)
    int insertIfAbsent(@Param("commentId") long commentId, @Param("userId") long userId);

    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query("delete from CommentLike l where l.commentId = :commentId and l.userId = :userId")
    int deleteByCommentIdAndUserId(
            @Param("commentId") long commentId, @Param("userId") long userId);

    boolean existsByCommentIdAndUserId(Long commentId, Long userId);

    long countByCommentId(Long commentId);

    /** 댓글별 좋아요 수. 좋아요가 없는 댓글은 결과에 없다. */
    @Query(
            """
            select l.commentId as commentId, count(l) as total from CommentLike l
            where l.commentId in :commentIds
            group by l.commentId
            """)
    List<CommentCount> countByCommentIds(@Param("commentIds") Collection<Long> commentIds);

    /** 주어진 댓글 중 회원이 좋아요한 댓글 ID. */
    @Query(
            """
            select l.commentId from CommentLike l
            where l.userId = :userId
              and l.commentId in :commentIds
            """)
    List<Long> findLikedCommentIds(
            @Param("userId") long userId, @Param("commentIds") Collection<Long> commentIds);
}
