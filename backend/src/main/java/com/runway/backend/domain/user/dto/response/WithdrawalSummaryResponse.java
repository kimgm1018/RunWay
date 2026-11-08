package com.runway.backend.domain.user.dto.response;

import java.util.List;
import java.util.Map;

public record WithdrawalSummaryResponse(
        long runningRecordCount, long postCount, long bookmarkedCourseCount,
        List<Device> connectedDevices, List<Crew> ownedCrews,
        List<Group> ownedGroupRuns, List<Group> scheduledGroupRuns, List<Blocker> blockers) {
    public record Device(long id, String deviceType) {}
    public record Crew(long crewId, String name) {}
    public record Group(long groupRunId, String title, String status) {}
    public record Blocker(String code, String message, List<Long> resourceIds) {
        public Map<String, Object> details() {
            return Map.of("code", code, "message", message, "resourceIds", resourceIds);
        }
    }
}
