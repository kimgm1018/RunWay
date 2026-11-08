package com.runway.backend.domain.session.difficulty;

import com.runway.backend.domain.session.difficulty.CourseDifficultyPort.CourseDifficulty;
import com.runway.backend.domain.session.difficulty.CourseDifficultyRepository.CourseSource;
import java.math.BigDecimal;
import java.math.RoundingMode;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 코스 하나의 지형 난이도 비율을 AI05로 계산해 저장한다(S15P31E105-297). {@link CourseDifficultyDispatcher}의 실행기 스레드에서 부른다.
 *
 * <p>트랜잭션을 열지 않는다. 조회·저장은 각각 짧은 자동 커밋 문장이고 AI 호출은 그 사이에서 DB 연결·잠금 없이 한다.
 *
 * <p>AI를 부르지 않는 코스: 이미 저장됨, 경사 없음, ACTIVE 아님, 구간 1개 이하(비율을 쓰지 않음), 구간 {@value #MAX_SEGMENTS}개 초과(세션 계획이
 * 구간 1개로 저장됨), 경사 끝 거리로 센 구간 수가 코스 거리로 센 구간 수와 다름(AI05는 경사 끝 거리로 개수를 정하므로 저장할 수 없는 결과만 나옴).
 *
 * <p>AI05가 {@value #RATIO_MISSING_WARNING} 경고를 붙이면 경사가 비율에 반영되지 않은 균등 값이므로 저장하지 않는다. AI가 경사 비율을 계산하게
 * 되면 같은 코스의 다음 저장부터 저장된다(S15P31E105-297 리뷰 R-3).
 */
@Service
@RequiredArgsConstructor
public class CourseDifficultyRunService {

    /** 세션 계획 구간 수 상한(InitialPacePlanCalculator.MAX_SEGMENTS, AI05 비율 개수 상한과 같다). */
    static final int MAX_SEGMENTS = 45;

    static final int MAX_PLANNER_VERSION_LENGTH = 80;

    /** AI05가 경사 구간 basePaceRatio 없이 균등 pace로 계산했다는 경고 코드. */
    static final String RATIO_MISSING_WARNING = "COURSE_PACE_RATIO_MISSING";

    private static final BigDecimal SEGMENT_LENGTH_M = BigDecimal.valueOf(1000);

    private static final Logger log = LoggerFactory.getLogger(CourseDifficultyRunService.class);

    private final CourseDifficultyRepository repository;
    private final CourseDifficultyPort port;

    /** 실행 결과. 운영 로그와 테스트 확인용이다. */
    public enum Outcome {
        SAVED,
        ALREADY_SAVED,
        NOT_ELIGIBLE,
        AI_FAILED,
        NO_TERRAIN_RATIO,
        INVALID_RESPONSE
    }

    public Outcome run(long courseId) {
        if (repository.exists(courseId)) {
            return Outcome.ALREADY_SAVED;
        }
        Optional<CourseSource> found = repository.findCourse(courseId);
        if (found.isEmpty() || !eligible(found.get())) {
            log.debug("구간 난이도 비율 계산 대상 아님 (courseId={})", courseId);
            return Outcome.NOT_ELIGIBLE;
        }
        CourseSource course = found.get();
        int expected = segmentCount(course.distanceM());

        Optional<CourseDifficulty> result = port.segmentDifficulty(courseId, course.profileJson());
        if (result.isEmpty()) {
            return Outcome.AI_FAILED;
        }
        CourseDifficulty difficulty = result.get();
        if (difficulty.warningCodes().contains(RATIO_MISSING_WARNING)) {
            log.info("AI05가 경사 비율 없이 계산해 저장하지 않음 (courseId={})", courseId);
            return Outcome.NO_TERRAIN_RATIO;
        }
        if (!valid(difficulty, expected)) {
            // 값은 남기지 않고 어긋난 개수만 남긴다.
            log.warn(
                    "AI05 구간 난이도 비율이 계약과 달라 저장하지 않음 (courseId={}, expected={}, actual={})",
                    courseId,
                    expected,
                    difficulty.ratios().size());
            return Outcome.INVALID_RESPONSE;
        }
        boolean inserted =
                repository.insertIfAbsent(
                        courseId,
                        course.distanceM(),
                        difficulty.ratios(),
                        difficulty.plannerVersion());
        log.info(
                "구간 난이도 비율 저장 (courseId={}, segments={}, saved={})",
                courseId,
                expected,
                inserted);
        return inserted ? Outcome.SAVED : Outcome.ALREADY_SAVED;
    }

    private static boolean eligible(CourseSource course) {
        if (!"ACTIVE".equals(course.status())
                || course.profileJson() == null
                || course.distanceM() == null
                || course.distanceM().signum() <= 0
                || course.profileEndM() == null
                || course.profileEndM().signum() <= 0) {
            return false;
        }
        int count = segmentCount(course.distanceM());
        return count > 1 && count <= MAX_SEGMENTS && segmentCount(course.profileEndM()) == count;
    }

    /** 0m부터 1km 단위 올림 구간 수. 세션 계획 계산기와 같은 규칙이다. */
    static int segmentCount(BigDecimal distanceM) {
        return distanceM.divide(SEGMENT_LENGTH_M, 0, RoundingMode.CEILING).intValueExact();
    }

    private static boolean valid(CourseDifficulty difficulty, int expected) {
        String version = difficulty.plannerVersion();
        List<BigDecimal> ratios = difficulty.ratios();
        return version != null
                && !version.isBlank()
                && version.length() <= MAX_PLANNER_VERSION_LENGTH
                && ratios.size() == expected
                && ratios.stream().allMatch(r -> r != null && r.signum() > 0);
    }
}
