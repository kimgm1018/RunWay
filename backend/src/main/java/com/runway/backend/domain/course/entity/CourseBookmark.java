package com.runway.backend.domain.course.entity;

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
@Table(name = "course_bookmarks")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CourseBookmark {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Column(name = "course_id", nullable = false)
    private Long courseId;

    @Column(name = "custom_name", length = 50)
    private String customName;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static CourseBookmark create(long userId, long courseId, String customName) {
        CourseBookmark bookmark = new CourseBookmark();
        bookmark.userId = userId;
        bookmark.courseId = courseId;
        bookmark.customName = customName;
        return bookmark;
    }

    public void updateCustomName(String customName) {
        this.customName = customName;
    }
}
