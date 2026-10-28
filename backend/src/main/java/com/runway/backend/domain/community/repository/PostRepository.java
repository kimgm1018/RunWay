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
