package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.Post;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface PostRepository extends JpaRepository<Post, Long> {

    Optional<Post> findByIdAndDeletedAtIsNull(Long id);

    /**
     * S15P31E105-830. 같은 러닝 기록의 본인 미삭제 글 ID. 부분 UNIQUE 인덱스(uq_posts_session_active)로 최대 1개다. 작성자 조건으로
     * 이상 데이터(내 기록을 가리키는 타인 글)의 ID를 409 details로 내주지 않는다. 그때는 INSERT가 인덱스에 걸려 빈 details의 409다.
     */
    @Query(
            value =
                    """
                    SELECT id FROM posts
                    WHERE session_id = :sessionId AND author_id = :authorId AND deleted_at IS NULL
                    ORDER BY id
                    LIMIT 1
                    """,
            nativeQuery = true)
    Optional<Long> findActivePostIdBySessionIdAndAuthorId(
            @Param("sessionId") long sessionId, @Param("authorId") long authorId);

    @Query(
            """
            select p from Post p
            where p.deletedAt is null
              and (:authorId is null or p.authorId = :authorId)
            order by p.id desc
            """)
    List<Post> findActive(@Param("authorId") Long authorId);

    @Query(
            """
            select p from Post p
            where p.deletedAt is null
              and p.authorId in :authorIds
              and (:authorId is null or p.authorId = :authorId)
            order by p.id desc
            """)
    List<Post> findActiveByAuthorIds(
            @Param("authorIds") Collection<Long> authorIds, @Param("authorId") Long authorId);
}
