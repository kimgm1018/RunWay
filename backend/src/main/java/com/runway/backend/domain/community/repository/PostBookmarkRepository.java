package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.PostBookmark;
import java.util.Collection;
import java.util.List;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostBookmarkRepository extends JpaRepository<PostBookmark, Long> {

    /**
     * 없을 때만 저장한다. 동시 요청이 같은 행을 넣어도 유니크 제약에서 오류 없이 한 행만 남아 트랜잭션이 중단되지 않는다. "조회 후 저장"만으로는 중복을
     * 막지 못하므로 PostgreSQL ON CONFLICT를 쓴다.
     */
    @Modifying
    @Query(
            value =
                    """
                    INSERT INTO post_bookmarks(post_id, user_id) VALUES (:postId, :userId)
                    ON CONFLICT ON CONSTRAINT uq_post_bookmarks_post_id_user_id DO NOTHING
                    """,
            nativeQuery = true)
    int insertIfAbsent(@Param("postId") long postId, @Param("userId") long userId);

    boolean existsByPostIdAndUserId(Long postId, Long userId);

    @Modifying
    @Query("delete from PostBookmark b where b.postId = :postId and b.userId = :userId")
    int deleteByPostIdAndUserId(@Param("postId") long postId, @Param("userId") long userId);

    /** 주어진 게시물 중 회원이 저장한 게시물 ID. */
    @Query(
            """
            select b.postId from PostBookmark b
            where b.userId = :userId
              and b.postId in :postIds
            """)
    List<Long> findBookmarkedPostIds(
            @Param("userId") long userId, @Param("postIds") Collection<Long> postIds);
}
