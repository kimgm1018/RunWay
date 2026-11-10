package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.Comment;
import java.util.Collection;
import java.util.List;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface CommentRepository extends JpaRepository<Comment, Long> {

    Optional<Comment> findByIdAndDeletedAtIsNull(Long id);

    @Query(
            """
            select c from Comment c
            where c.postId = :postId
              and c.deletedAt is null
            order by c.createdAt asc, c.id asc
            """)
    List<Comment> findActiveByPostId(@Param("postId") long postId);

    /** 게시물별 삭제되지 않은 댓글 수(대댓글 포함). 댓글이 없는 게시물은 결과에 없다. */
    @Query(
            """
            select c.postId as postId, count(c) as total from Comment c
            where c.postId in :postIds
              and c.deletedAt is null
            group by c.postId
            """)
    List<PostCount> countActiveByPostIds(@Param("postIds") Collection<Long> postIds);
}
