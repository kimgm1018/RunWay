package com.runway.backend.domain.session.difficulty;

import java.math.BigDecimal;
import java.util.List;
import java.util.Optional;

/**
 * 코스 지형 기준 1km 구간 난이도 비율을 계산하는 AI05 호출 포트(ai-service.md AI05 {@code segmentDifficultyRatios}).
 *
 * <p>호출은 호출 스레드를 막는 원격 요청이므로 트랜잭션·세션 잠금 밖에서만 부른다. 주소 미설정·연결 실패·시간 초과·오류 응답·응답 형식 위반은 모두 빈
 * 값이며 예외를 던지지 않는다. 비율 개수·양수 검사는 호출자가 한다.
 */
public interface CourseDifficultyPort {

    /**
     * @param courseId 코스 ID
     * @param gradeProfileJson {@code courses.elevation_profile} 원문(100m 경사 목록 JSON 배열)
     * @return 계산 결과. 실패하면 빈 값
     */
    Optional<CourseDifficulty> segmentDifficulty(long courseId, String gradeProfileJson);

    /**
     * @param plannerVersion AI05 {@code plannerVersion}
     * @param ratios AI05 {@code segmentDifficultyRatios}. 응답 순서 그대로이며 숫자인지만 확인한 값
     * @param warningCodes AI05 {@code warnings[].code}. 문자열 코드만 담는다
     */
    record CourseDifficulty(String plannerVersion, List<BigDecimal> ratios, List<String> warningCodes) {

        public CourseDifficulty {
            ratios = List.copyOf(ratios);
            warningCodes = List.copyOf(warningCodes);
        }
    }
}
