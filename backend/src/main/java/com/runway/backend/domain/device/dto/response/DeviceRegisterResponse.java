package com.runway.backend.domain.device.dto.response;

import com.runway.backend.domain.device.entity.UserDevice;

public record DeviceRegisterResponse(long id, String deviceType) {

    public static DeviceRegisterResponse from(UserDevice device) {
        return new DeviceRegisterResponse(device.getId(), device.getDeviceType().name());
    }
}
