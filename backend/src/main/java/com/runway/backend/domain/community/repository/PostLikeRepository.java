package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.PostLike;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostLikeRepository extends JpaRepository<PostLike, Long> {

    Optional<PostLike> findByPostIdAndUserId(Long postId, Long userId);

    /**
     * 좋아요를 넣는다. 이미 있으면 아무것도 하지 않는다. 동시 요청은 유니크 제약(post_id,user_id)에서 한쪽이 기다렸다가 건너뛰므로
     * 예외로 트랜잭션이 깨지지 않는다(CommentLikeRepository·PostBookmarkRepository와 같음).
     */
    @Modifying(flushAutomatically = true, clearAutomatically = false)
    @Query(
            value =
                    """
                    INSERT INTO post_likes(post_id, user_id) VALUES (:postId, :userId)
                    ON CONFLICT (post_id, user_id) DO NOTHING
                    """,
            nativeQuery = true)
    int insertIfAbsent(@Param("postId") long postId, @Param("userId") long userId);

    boolean existsByPostIdAndUserId(Long postId, Long userId);

    void deleteByPostIdAndUserId(Long postId, Long userId);

    /** 게시물별 좋아요 수. 좋아요가 없는 게시물은 결과에 없다. */
    @Query(
            """
            select l.postId as postId, count(l) as total from PostLike l
            where l.postId in :postIds
            group by l.postId
            """)
    List<PostCount> countByPostIds(@Param("postIds") Collection<Long> postIds);

    /** 주어진 게시물 중 회원이 좋아요한 게시물 ID. */
    @Query(
            """
            select l.postId from PostLike l
            where l.userId = :userId
              and l.postId in :postIds
            """)
    List<Long> findLikedPostIds(
            @Param("userId") long userId, @Param("postIds") Collection<Long> postIds);
}
