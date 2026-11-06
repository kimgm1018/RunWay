package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.difficulty.CourseDifficultyRepository;
import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;

/**
 * 코스별로 미리 저장한 AI05 지형 난이도 비율({@code course_segment_difficulties})을 읽는 구현(S15P31E105-297). 세션 잠금 안에서 불리므로 DB
 * 조회만 하고 원격 호출·잠금을 하지 않는다.
 *
 * <ul>
 *   <li>자유러닝(코스 없음)·저장 행 없음: 빈 값(균등)
 *   <li>계획 구간 수 ≤ 저장 개수: 앞 {@code segmentCount}개. 목표 거리가 코스보다 짧으면 앞 구간만 쓰고, 마지막 짧은 구간은 그 구간이 걸친 1km
 *       구간 비율을 쓴다. 정수 목표 거리가 소수 코스 거리보다 조금 길어도 구간 수가 같으면 그대로 쓴다(리뷰 R-2)
 *   <li>계획 구간 수 &gt; 저장 개수(목표 거리가 길어 구간 수가 늘어남): 코스 밖 구간 비율이 없으므로 빈 값(균등)
 * </ul>
 */
@Component
@RequiredArgsConstructor
class CourseSegmentDifficultyProvider implements SegmentDifficultyProvider {

    private final CourseDifficultyRepository repository;

    @Override
    public Optional<List<BigDecimal>> ratios(
            Long courseId, BigDecimal totalDistanceM, int segmentCount) {
        if (courseId == null || totalDistanceM == null || segmentCount <= 0) {
            return Optional.empty();
        }
        return repository
                .find(courseId)
                .filter(stored -> stored.ratios().size() >= segmentCount)
                .map(stored -> List.copyOf(stored.ratios().subList(0, segmentCount)));
    }
}
