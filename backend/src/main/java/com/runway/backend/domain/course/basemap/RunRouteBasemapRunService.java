package com.runway.backend.domain.course.basemap;

import com.runway.backend.domain.course.basemap.CourseBasemapPort.BasemapResult;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Failure;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.OutOfArea;
import com.runway.backend.domain.course.basemap.CourseBasemapPort.Success;
import com.runway.backend.domain.course.basemap.CourseBasemapRunService.Outcome;
import com.runway.backend.domain.course.basemap.RunRouteBasemapRepository.EligibleSession;
import com.runway.backend.domain.image.ImageStorage;
import com.runway.backend.domain.session.service.RunningRouteSelector;
import com.runway.backend.domain.session.service.SessionRouteService;
import java.io.ByteArrayInputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 러닝 기록(세션) 하나의 경로 썸네일을 만든다(S15P31E105-756, ADR-0024). 코스 썸네일({@link CourseBasemapRunService})과 같은
 * Route 바탕 지도·렌더러·배치로 그리되, 경로는 S11과 같은 표시용 조각을 쓰고 조각 사이를 잇지 않는다. {@link
 * CourseBasemapDispatcher}의 같은 실행기 스레드에서 부른다.
 *
 * <p>트랜잭션을 열지 않는다. 조회·저장은 각각 짧은 문장이고 Route 호출·그리기는 그 사이에서 DB 연결·잠금 없이 한다.
 *
 * <p>결과별 저장: 정상 응답은 이미지 키와 함께, 표시용 경로가 {@link #MIN_ROUTE_M} 미만·없음이거나 범위 밖이면 이미지 없이(다시 시도하지
 * 않음) 저장한다. 그 밖의 실패는 저장하지 않는다. PNG를 저장한 뒤 행 저장이 경쟁에서 지거나 실패하면 방금 저장한 PNG를 지운다. 좌표는 로그에
 * 남기지 않는다.
 */
@Service
@RequiredArgsConstructor
public class RunRouteBasemapRunService {

    /** 그리기 방식 버전. 코스 썸네일과 같은 렌더러·선 스타일이므로 같은 값을 쓴다. */
    public static final String RENDER_VERSION = CourseBasemapRunService.RENDER_VERSION;

    /** 이 길이(m) 미만의 표시용 경로는 그리지 않는다. 앱의 짧은 경로 기준(shortRouteM)과 같다. */
    static final double MIN_ROUTE_M = 50;

    private static final double EARTH_RADIUS_M = 6_371_000;

    private static final Logger log = LoggerFactory.getLogger(RunRouteBasemapRunService.class);

    private final RunRouteBasemapRepository repository;
    private final SessionRouteService sessionRouteService;
    private final CourseBasemapPort port;
    private final CourseThumbnailRenderer renderer;
    private final ImageStorage imageStorage;

    public Outcome run(long sessionId) {
        if (!port.isConfigured()) {
            return Outcome.NOT_CONFIGURED;
        }
        if (repository.isRendered(sessionId, RENDER_VERSION)) {
            return Outcome.ALREADY_SAVED;
        }
        Optional<EligibleSession> session = repository.findEligibleSession(sessionId);
        if (session.isEmpty()) {
            log.debug("기록 썸네일 생성 대상 아님 (sessionId={})", sessionId);
            return Outcome.NOT_ELIGIBLE;
        }
        List<List<double[]>> parts =
                sessionRouteService
                        .displaySegments(sessionId, session.get().startedAt(), session.get().endedAt())
                        .stream()
                        .map(RunningRouteSelector.Segment::coordinates)
                        .filter(part -> part.size() >= 2)
                        .toList();
        if (lengthM(parts) < MIN_ROUTE_M) {
            boolean saved = repository.upsert(sessionId, null, null, null, RENDER_VERSION);
            log.info("기록 표시용 경로가 짧거나 없어 이미지 없이 저장 (sessionId={}, saved={})", sessionId, saved);
            return saved ? Outcome.SAVED_EMPTY : Outcome.ALREADY_SAVED;
        }
        List<double[]> points = new ArrayList<>();
        parts.forEach(points::addAll);
        ThumbnailCamera camera;
        BasemapBbox bbox;
        try {
            camera = ThumbnailCamera.fit(points);
            bbox = BasemapBbox.visibleFootprint(camera);
        } catch (IllegalArgumentException e) {
            log.warn("기록 경로로 썸네일 범위를 계산하지 못해 만들지 않음 (sessionId={})", sessionId);
            return Outcome.NOT_ELIGIBLE;
        }

        // The port's id is only for its logs; Route receives the bbox, never the route.
        BasemapResult result = port.fetch(sessionId, bbox, camera.metersPerPixel());
        return switch (result) {
            case Success success -> save(sessionId, session.get().userId(), parts, camera, success);
            case OutOfArea outOfArea -> {
                boolean saved = repository.upsert(sessionId, null, null, null, RENDER_VERSION);
                log.info("기록 썸네일 범위 밖이라 이미지 없이 저장 (sessionId={}, saved={})", sessionId, saved);
                yield saved ? Outcome.SAVED_EMPTY : Outcome.ALREADY_SAVED;
            }
            case Failure failure -> {
                log.warn(
                        "기록 썸네일 바탕 지도를 가져오지 못해 저장하지 않음 (sessionId={}, reason={})",
                        sessionId,
                        failure.reason());
                yield failure.retryable() ? Outcome.FAILED_RETRYABLE : Outcome.FAILED;
            }
        };
    }

    private Outcome save(
            long sessionId,
            long userId,
            List<List<double[]>> parts,
            ThumbnailCamera camera,
            Success success) {
        String imageKey = ImageStorage.RUN_ROUTE_KEY_PREFIX + userId + "/" + UUID.randomUUID() + ".png";
        long started = System.nanoTime();
        try {
            byte[] png = renderer.renderParts(success.features(), parts, camera);
            imageStorage.store(imageKey, new ByteArrayInputStream(png), png.length);
        } catch (RuntimeException e) {
            log.warn(
                    "기록 썸네일을 그리거나 저장하지 못함 (sessionId={}, {})",
                    sessionId,
                    e.getClass().getSimpleName());
            return Outcome.FAILED;
        }
        boolean saved;
        try {
            saved =
                    repository.upsert(
                            sessionId,
                            imageKey,
                            success.osmDataTimestamp(),
                            success.buildingsOsmDataTimestamp(),
                            RENDER_VERSION);
        } catch (RuntimeException e) {
            deleteUnreferenced(sessionId, imageKey);
            throw e;
        }
        if (!saved) {
            deleteUnreferenced(sessionId, imageKey);
        }
        log.info(
                "기록 썸네일 저장 (sessionId={}, parts={}, features={}, elapsedMs={}, saved={})",
                sessionId,
                parts.size(),
                success.features().size(),
                (System.nanoTime() - started) / 1_000_000,
                saved);
        return saved ? Outcome.SAVED : Outcome.ALREADY_SAVED;
    }

    private void deleteUnreferenced(long sessionId, String imageKey) {
        try {
            imageStorage.deleteRunRouteBasemap(imageKey);
        } catch (RuntimeException e) {
            log.warn(
                    "참조되지 않은 기록 썸네일 PNG를 지우지 못함 (sessionId={}, {})",
                    sessionId,
                    e.getClass().getSimpleName());
        }
    }

    /** 조각별 길이 합(m, 조각 사이 간격은 넣지 않음). */
    static double lengthM(List<List<double[]>> parts) {
        double total = 0;
        for (List<double[]> part : parts) {
            for (int i = 1; i < part.size(); i++) {
                total += haversineM(part.get(i - 1), part.get(i));
            }
        }
        return total;
    }

    private static double haversineM(double[] a, double[] b) {
        double lat1 = Math.toRadians(a[1]);
        double lat2 = Math.toRadians(b[1]);
        double dLat = lat2 - lat1;
        double dLon = Math.toRadians(b[0] - a[0]);
        double h =
                Math.sin(dLat / 2) * Math.sin(dLat / 2)
                        + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }
}
