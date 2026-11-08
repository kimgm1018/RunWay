package com.runway.backend.domain.course.recommend;

import java.util.List;

/**
 * 생성기(Route 또는 개발용 스텁)가 만든 후보 묶음. 경사는 생성기 밖에서 백엔드가 계산해 붙인다.
 *
 * @param courses 순위 순 후보 1~3개
 * @param notices 응답 전체 안내 문구(Route 원문)
 * @param nextSeed 다른 후보 요청용 다음 seed(요청 seed + 24)
 */
public record GeneratedCourses(
        List<GeneratedCourseCandidate> courses, List<String> notices, int nextSeed) {

    public GeneratedCourses {
        courses = List.copyOf(courses);
        notices = List.copyOf(notices);
    }
}
