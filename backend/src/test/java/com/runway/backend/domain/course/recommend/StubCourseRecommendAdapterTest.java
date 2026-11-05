package com.runway.backend.domain.course.recommend;

import static org.assertj.core.api.Assertions.assertThat;

import java.math.BigDecimal;
import java.time.Instant;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

class StubCourseRecommendAdapterTest {

    private static final int SEED_STEP = 24;
    private static final Instant DEADLINE = Instant.parse("2026-11-05T00:00:20Z");

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
        GeneratedCourses first = adapter.recommend(command(5.0, 100), DEADLINE);
        GeneratedCourses second = adapter.recommend(command(5.0, 100), DEADLINE);

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
        GeneratedCourses a = adapter.recommend(command(5.0, 1), DEADLINE);
        GeneratedCourses b = adapter.recommend(command(5.0, 2), DEADLINE);

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
        GeneratedCourses response = adapter.recommend(command(5.123, 7), DEADLINE);

        assertThat(response.courses()).hasSize(3);
        assertThat(response.courses())
                .extracting(GeneratedCourseCandidate::index)
                .containsExactly(0, 1, 2);
        BigDecimal expected = BigDecimal.valueOf(5.123 * 1000d).setScale(2, java.math.RoundingMode.HALF_UP);
        for (GeneratedCourseCandidate course : response.courses()) {
            assertThat(course.distanceM().scale()).isEqualTo(2);
            assertThat(course.distanceM()).isEqualByComparingTo(expected);
            assertThat(course.route().positionCount()).isGreaterThanOrEqualTo(2);
        }
    }

    @Test
    @DisplayName("스텁 결과는 실제 추천으로 오인하지 않도록 응답 안내와 요약에 개발용 문구를 넣는다")
    void marksStubResultAsDevelopmentOnly() {
        GeneratedCourses response = adapter.recommend(command(5.0, 1), DEADLINE);

        assertThat(response.notices()).containsExactly(StubCourseRecommendAdapter.NOTICE);
        assertThat(response.courses())
                .allSatisfy(course -> assertThat(course.summary()).contains("개발용"));
    }
}
