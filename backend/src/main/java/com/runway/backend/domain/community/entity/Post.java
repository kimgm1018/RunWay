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
@Table(name = "posts")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Post {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "author_id", nullable = false)
    private Long authorId;

    @Column(name = "session_id", nullable = false)
    private Long sessionId;

    @Column(columnDefinition = "TEXT")
    private String body;

    @Column(name = "image_key", length = 1024)
    private String imageKey;

    @Column(name = "region_code", length = 40)
    private String regionCode;

    @Column(name = "course_shared", nullable = false)
    private boolean courseShared;

    @Column(name = "deleted_at")
    private Instant deletedAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static Post create(
            long authorId,
            long sessionId,
            String body,
            String imageKey,
            String regionCode,
            boolean courseShared) {
        Post post = new Post();
        post.authorId = authorId;
        post.sessionId = sessionId;
        post.body = body;
        post.imageKey = imageKey;
        post.regionCode = regionCode;
        post.courseShared = courseShared;
        return post;
    }

    public boolean isAuthoredBy(long userId) {
        return authorId.equals(userId);
    }

    public boolean isDeleted() {
        return deletedAt != null;
    }

    public void updateBody(String body) {
        this.body = body;
    }

    public void updateCourseShared(boolean courseShared) {
        this.courseShared = courseShared;
    }

    public void softDelete(Instant deletedAt) {
        this.deletedAt = deletedAt;
    }
}
