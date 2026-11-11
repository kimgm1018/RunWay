package com.runway.backend.domain.image;

import java.io.InputStream;
import java.util.Optional;
import java.util.UUID;

public interface ImageStorage {

    /** 서버가 그린 코스 썸네일 PNG 키 앞부분. 키는 {@code images/course-basemap/{courseId}/{uuid}.png}다(S15P31E105-612). */
    String COURSE_BASEMAP_KEY_PREFIX = "images/course-basemap/";

    void store(String imageKey, InputStream content, long contentLength);

    boolean exists(String imageKey);

    Optional<StoredImage> findByImageId(UUID imageId);

    Optional<StoredImage> findByKey(String imageKey);

    /**
     * 서버가 방금 저장했지만 어떤 행도 참조하지 않게 된 코스 썸네일 PNG 하나를 지운다(S15P31E105-612 B-5). 키가 {@code
     * images/course-basemap/{courseId}/{uuid}.png} 형식이 아니면 지우지 않고 예외를 던진다. 파일이 없으면 아무것도 하지 않는다.
     */
    void deleteCourseBasemap(String imageKey);

    /** Trusted server use only, after confirming a committed withdrawal. */
    void deletePersonalImages(long userId);

    record StoredImage(String imageKey, String contentType, InputStream content, long contentLength) {}
}
