package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.course.basemap.CourseBasemapPort.BasemapResult;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Failure;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.OutOfArea;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Success;
import com.runway.backend.domain.image.ImageStorage;
import java.io.ByteArrayInputStream;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 코스 하나의 썸네일을 만든다(S15P31E105-612): Route에서 지형지물·건물을 받아 PNG로 그리고, 이미지 볼륨(ADR-0016)에 저장한 뒤
 * {@code course_basemaps} 행을 저장한다. {@link CourseBasemapDispatcher}의 실행기 스레드에서 부른다.
 *
 * <p>트랜잭션을 열지 않는다. 조회·저장은 각각 짧은 자동 커밋 문장이고 Route 호출·그리기는 그 사이에서 DB 연결·잠금 없이 한다.
 *
 * <p>결과별 저장: 정상 응답은 이미지 키와 함께, 범위 밖(OUT_OF_AREA)은 이미지 없이(다시 시도하지 않음) 저장한다. 그 밖의 실패(Route
 * 실패·그리기·볼륨 저장 실패)는 저장하지 않는다(다음 기동 때 일괄 채우기가 다시 시도. Route가 잠깐 바쁘거나 멈춘 실패는 {@link
 * Outcome#FAILED_RETRYABLE}로 알려 같은 일괄 채우기 안에서 한 번 더 시도한다). {@link #RENDER_VERSION}이 다른 행은 다시 그린다.
 *
 * <p>PNG를 저장한 뒤 행 저장이 경쟁에서 지거나(같은 버전 행이 이미 있음) 실패하면 방금 저장한 PNG를 지워 참조 없는 파일을 남기지
 * 않는다(B-5).
 */
@Service
@RequiredArgsConstructor
public class CourseBasemapRunService {

    /** 그리기 방식 버전. 바꾸면 기동 시 일괄 채우기가 기존 썸네일을 다시 그린다(최대 40자). */
    public static final String RENDER_VERSION = "flat-v3";

    /** 이미지 볼륨 키 앞부분. 키는 {@code images/course-basemap/{courseId}/{uuid}.png}다. */
    public static final String IMAGE_KEY_PREFIX = ImageStorage.COURSE_BASEMAP_KEY_PREFIX;

    private static final Logger log = LoggerFactory.getLogger(CourseBasemapRunService.class);

    private final CourseBasemapRepository repository;
    private final CourseBasemapPort port;
    private final CourseThumbnailRenderer renderer;
    private final ImageStorage imageStorage;

    /** 실행 결과. 운영 로그와 테스트 확인용이다. */
    public enum Outcome {
        SAVED,
        SAVED_EMPTY,
        ALREADY_SAVED,
        NOT_CONFIGURED,
        NOT_ELIGIBLE,
        /** Route가 잠깐 바쁘거나 멈춘 것으로 보이는 실패(연결 실패·시간 초과·5xx). 저장하지 않는다. */
        FAILED_RETRYABLE,
        FAILED
    }

    public Outcome run(long courseId) {
        if (!port.isConfigured()) {
            return Outcome.NOT_CONFIGURED;
        }
        if (repository.isRendered(courseId, RENDER_VERSION)) {
            return Outcome.ALREADY_SAVED;
        }
        Optional<String> status = repository.findCourseStatus(courseId);
        if (status.isEmpty() || !"ACTIVE".equals(status.get())) {
            log.debug("바탕 지도 생성 대상 아님 (courseId={})", courseId);
            return Outcome.NOT_ELIGIBLE;
        }
        List<double[]> route = repository.findCourseRoute(courseId);
        ThumbnailCamera camera;
        BasemapBbox bbox;
        try {
            camera = ThumbnailCamera.fit(route);
            bbox = BasemapBbox.visibleFootprint(camera);
        } catch (IllegalArgumentException e) {
            log.warn("코스 경로로 썸네일 범위를 계산하지 못해 만들지 않음 (courseId={})", courseId);
            return Outcome.NOT_ELIGIBLE;
        }

        BasemapResult result = port.fetch(courseId, bbox, camera.metersPerPixel());
        return switch (result) {
            case Success success -> save(courseId, route, camera, success);
            case OutOfArea outOfArea -> {
                boolean saved =
                        repository.upsert(courseId, null, null, null, RENDER_VERSION);
                log.info("바탕 지도 범위 밖이라 이미지 없이 저장 (courseId={}, saved={})", courseId, saved);
                yield saved ? Outcome.SAVED_EMPTY : Outcome.ALREADY_SAVED;
            }
            case Failure failure -> {
                log.warn(
                        "바탕 지도를 가져오지 못해 저장하지 않음 (courseId={}, reason={})",
                        courseId,
                        failure.reason());
                yield failure.retryable() ? Outcome.FAILED_RETRYABLE : Outcome.FAILED;
            }
        };
    }

    private Outcome save(
            long courseId, List<double[]> route, ThumbnailCamera camera, Success success) {
        String imageKey = IMAGE_KEY_PREFIX + courseId + "/" + UUID.randomUUID() + ".png";
        long started = System.nanoTime();
        try {
            byte[] png = renderer.render(success.features(), route, camera);
            imageStorage.store(imageKey, new ByteArrayInputStream(png), png.length);
        } catch (RuntimeException e) {
            // 볼륨 경로·좌표가 들어 있을 수 있어 클래스 이름만 남긴다.
            log.warn(
                    "썸네일을 그리거나 저장하지 못함 (courseId={}, {})",
                    courseId,
                    e.getClass().getSimpleName());
            return Outcome.FAILED;
        }
        boolean saved;
        try {
            saved =
                    repository.upsert(
                            courseId,
                            imageKey,
                            success.osmDataTimestamp(),
                            success.buildingsOsmDataTimestamp(),
                            RENDER_VERSION);
        } catch (RuntimeException e) {
            // 코스 삭제 직후 FK 위반·DB 장애. 방금 쓴 PNG는 어떤 행도 참조하지 않는다.
            deleteUnreferenced(courseId, imageKey);
            throw e;
        }
        if (!saved) {
            // 같은 버전 행을 다른 실행이 먼저 저장했다. 그 행의 키를 쓰므로 이 PNG는 참조되지 않는다.
            deleteUnreferenced(courseId, imageKey);
        }
        log.info(
                "썸네일 저장 (courseId={}, features={}, buildingsAvailable={}, elapsedMs={}, saved={})",
                courseId,
                success.features().size(),
                success.buildingsAvailable(),
                (System.nanoTime() - started) / 1_000_000,
                saved);
        return saved ? Outcome.SAVED : Outcome.ALREADY_SAVED;
    }

    /** 참조되지 않게 된 방금 저장한 PNG를 지운다. 실패해도 결과를 바꾸지 않고 로그만 남긴다(파일만 남는다). */
    private void deleteUnreferenced(long courseId, String imageKey) {
        try {
            imageStorage.deleteCourseBasemap(imageKey);
        } catch (RuntimeException e) {
            log.warn(
                    "참조되지 않은 썸네일 PNG를 지우지 못함 (courseId={}, {})",
                    courseId,
                    e.getClass().getSimpleName());
        }
    }
}
