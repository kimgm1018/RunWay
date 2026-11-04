package com.runway.backend.domain.course.recommend;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.dto.response.RecommendCoursesResponse;
import com.runway.backend.domain.course.dto.response.RecommendedCourseItemResponse;
import java.math.BigDecimal;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class StubCourseRecommendAdapterTest {

    private static final int SEED_STEP = 24;

    private final StubCourseRecommendAdapter adapter = new StubCourseRecommendAdapter();

    private static CourseRecommendCommand command(double distanceKm, int seed) {
        return new CourseRecommendCommand(
                37.5665,
                126.9780,
                distanceKm,
                CourseRecommendShape.LOOP,
                null,
                null,
                CourseRecommendFilters.allOff(),
                seed);
    }

    @Test
    @DisplayName("같은 command와 seed면 nextSeed(seed+24)와 경로 좌표가 동일하다")
    void sameCommandAndSeed_returnsSameNextSeedAndRoute() {
        RecommendCoursesResponse first = adapter.recommend(command(5.0, 100));
        RecommendCoursesResponse second = adapter.recommend(command(5.0, 100));

        assertThat(first.nextSeed()).isEqualTo(100 + SEED_STEP);
        assertThat(second.nextSeed()).isEqualTo(first.nextSeed());
        assertThat(first.courses()).hasSameSizeAs(second.courses());
        for (int i = 0; i < first.courses().size(); i++) {
            assertThat(second.courses().get(i).route().coordinates())
                    .isEqualTo(first.courses().get(i).route().coordinates());
        }
    }

    @Test
    @DisplayName("seed가 다르면 경로 시작점 또는 nextSeed가 달라진다")
    void differentSeed_returnsDifferentStartOrNextSeed() {
        RecommendCoursesResponse a = adapter.recommend(command(5.0, 1));
        RecommendCoursesResponse b = adapter.recommend(command(5.0, 2));

        boolean nextSeedDiffers = a.nextSeed() != b.nextSeed();
        boolean startDiffers =
                !a.courses()
                        .get(0)
                        .route()
                        .coordinates()
                        .get(0)
                        .equals(b.courses().get(0).route().coordinates().get(0));

        assertThat(nextSeedDiffers || startDiffers).isTrue();
        assertThat(a.nextSeed()).isEqualTo(1 + SEED_STEP);
        assertThat(b.nextSeed()).isEqualTo(2 + SEED_STEP);
    }

    @Test
    @DisplayName("후보 3개를 index 0,1,2로 반환하고 distanceM은 distanceKm*1000(소수 2자리)이다")
    void returnsThreeCandidatesWithIndexAndScaledDistance() {
        RecommendCoursesResponse response = adapter.recommend(command(5.123, 7));

        assertThat(response.courses()).hasSize(3);
        assertThat(response.courses())
                .extracting(RecommendedCourseItemResponse::index)
                .containsExactly(0, 1, 2);
        BigDecimal expected = BigDecimal.valueOf(5.123 * 1000d).setScale(2, java.math.RoundingMode.HALF_UP);
        for (RecommendedCourseItemResponse course : response.courses()) {
            assertThat(course.distanceM().scale()).isEqualTo(2);
            assertThat(course.distanceM()).isEqualByComparingTo(expected);
            assertThat(course.route().positionCount()).isGreaterThanOrEqualTo(2);
        }
    }
}
