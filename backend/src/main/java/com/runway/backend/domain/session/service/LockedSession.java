package com.runway.backend.domain.session.service;

import com.runway.backend.domain.session.entity.RunningSession;

/** 소유권 확인 후 (그룹 행 →) 세션 행을 잠근 결과. */
record LockedSession(RunningSession session, Long groupRunId, boolean groupCompleted) {}
