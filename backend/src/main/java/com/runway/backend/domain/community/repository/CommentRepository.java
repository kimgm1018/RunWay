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

    /**
     * CMT06 표시 대상. 삭제되지 않은 댓글과, 삭제됐지만 삭제되지 않은 대댓글이 남은 원댓글(삭제 자리)을 createdAt·id 오름차순으로
     * 한 번에 조회한다. 삭제된 대댓글과 대댓글 없이 삭제된 원댓글은 제외한다.
     */
    @Query(
            """
            select c from Comment c
            where c.postId = :postId
              and (c.deletedAt is null
                   or (c.parentCommentId is null
                       and exists (select 1 from Comment r
                                   where r.parentCommentId = c.id
                                     and r.deletedAt is null)))
            order by c.createdAt asc, c.id asc
            """)
    List<Comment> findVisibleByPostId(@Param("postId") long postId);

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
