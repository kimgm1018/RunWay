package com.runway.backend.domain.runningrecord.dto.response;

/** H01 목록 항목의 그룹런 메타. 그룹런에 연결된 기록에서만 내려가며 그 외에는 {@code group}이 null이다. */
public record RunningRecordGroupResponse(long groupRunId, String crewName, int finisherCount) {}
