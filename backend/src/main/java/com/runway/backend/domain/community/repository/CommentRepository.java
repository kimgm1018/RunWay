package com.runway.backend.domain.community.repository;

import com.runway.backend.domain.community.entity.Comment;
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
}
