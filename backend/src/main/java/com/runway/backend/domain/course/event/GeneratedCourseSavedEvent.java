package com.runway.backend.domain.course.event;

/**
 * 생성 코스 저장(C10·내부 저장)이 새 코스를 만들었거나 같은 경로의 ACTIVE 코스를 재사용했다는 알림. 저장 트랜잭션 안에서 발행하며, 받는 쪽은
 * 커밋 후({@code AFTER_COMMIT})에만 반응해야 한다. 코스 지형 난이도 비율 계산(S15P31E105-297)이 이 알림으로 시작한다.
 *
 * @param courseId 저장 또는 재사용한 코스 ID
 */
public record GeneratedCourseSavedEvent(long courseId) {}
