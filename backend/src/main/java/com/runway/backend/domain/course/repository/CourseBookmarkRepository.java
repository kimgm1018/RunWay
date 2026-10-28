package com.runway.backend.domain.course.repository;

import com.runway.backend.domain.course.entity.CourseBookmark;
import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface CourseBookmarkRepository extends JpaRepository<CourseBookmark, Long> {

    Optional<CourseBookmark> findByUserIdAndCourseId(Long userId, Long courseId);

    void deleteByUserIdAndCourseId(Long userId, Long courseId);
}
