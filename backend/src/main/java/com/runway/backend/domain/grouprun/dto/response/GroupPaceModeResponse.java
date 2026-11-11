package com.runway.backend.domain.grouprun.dto.response;

/** G17 응답. 바꾼 모드와 재계산 시작 여부(기능이 꺼져 있으면 false). */
public record GroupPaceModeResponse(long groupRunId, String paceMode, boolean paceCalculating) {}
