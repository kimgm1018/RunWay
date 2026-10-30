package com.runway.backend.domain.device.dto.response;

import com.runway.backend.domain.device.entity.UserDevice;
import java.time.Instant;

public record DeviceItemResponse(
        long id, String deviceType, Instant linkedAt, Instant unlinkedAt) {

    public static DeviceItemResponse from(UserDevice device) {
        return new DeviceItemResponse(
                device.getId(),
                device.getDeviceType().name(),
                device.getLinkedAt(),
                device.getUnlinkedAt());
    }
}
