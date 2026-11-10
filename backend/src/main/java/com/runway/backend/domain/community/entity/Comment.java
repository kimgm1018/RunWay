package com.runway.backend.domain.community.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

@Entity
@Table(name = "comments")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Comment {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "post_id", nullable = false)
    private Long postId;

    @Column(name = "parent_comment_id")
    private Long parentCommentId;

    @Column(name = "author_id", nullable = false)
    private Long authorId;

    @Column(nullable = false, columnDefinition = "TEXT")
    private String body;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static Comment create(long postId, long authorId, String body, Long parentCommentId) {
        Comment comment = new Comment();
        comment.postId = postId;
        comment.authorId = authorId;
        comment.body = body;
        comment.parentCommentId = parentCommentId;
        return comment;
    }

    public boolean isAuthoredBy(long userId) {
        return authorId.equals(userId);
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public boolean isRoot() {
        return parentCommentId == null;
    }

    public void updateBody(String body) {
        this.body = body;
    }

    public void softDelete(Instant deletedAt) {
        this.deletedAt = deletedAt;
    }
}
