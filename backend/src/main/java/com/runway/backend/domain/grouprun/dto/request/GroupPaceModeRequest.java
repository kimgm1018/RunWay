package com.runway.backend.domain.grouprun.dto.request;

/** G17 방장 페이스 모드 변경(S15P31E105-680). paceMode는 TOGETHER 또는 GOAL. */
public record GroupPaceModeRequest(String paceMode) {}
