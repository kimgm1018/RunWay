package com.runway.backend.domain.coaching.decide;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.List;

/**
 * 안내 페이스가 마지막으로 바뀐 시각({@code context.guidePaceSetAt}). 최신 APPLIED 코칭부터 같은 추천 페이스 streak의 시작
 * {@code applied_at}이다. 단계만 바뀐 발행은 이 시각을 바꾸지 않는다(S15P31E105-516, ai-service.md).
 */
public final class GuidePaceSetAt {

    private GuidePaceSetAt() {}

    /**
     * @param appliedNewestFirst APPLIED 코칭을 {@code applied_at DESC, id DESC} 순으로 둔 목록
     * @return 현재 안내 페이스 streak가 시작된 시각. 목록이 비면 null
     */
    public static Instant resolve(List<AppliedPace> appliedNewestFirst) {
        if (appliedNewestFirst == null || appliedNewestFirst.isEmpty()) {
            return null;
        }
        AppliedPace newest = appliedNewestFirst.get(0);
        BigDecimal pace = newest.recommendedPace();
        Instant setAt = newest.appliedAt();
        if (pace == null || setAt == null) {
            return setAt;
        }
        for (int i = 1; i < appliedNewestFirst.size(); i++) {
            AppliedPace row = appliedNewestFirst.get(i);
            if (row.recommendedPace() == null || row.recommendedPace().compareTo(pace) != 0) {
                break;
            }
            setAt = row.appliedAt();
        }
        return setAt;
    }

    public record AppliedPace(Instant appliedAt, BigDecimal recommendedPace) {}
}
