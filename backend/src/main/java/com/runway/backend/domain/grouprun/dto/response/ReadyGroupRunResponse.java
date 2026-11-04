package com.runway.backend.domain.grouprun.dto.response;

/** ready 응답. sessionId는 준비 세션이 연결돼 있으면 값, 아니면 null. */
public record ReadyGroupRunResponse(
        int participantCount, String readyStatus, int readyCount, Long sessionId) {}
