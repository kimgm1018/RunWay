package com.runway.backend.domain.device.dto.request;

import com.runway.backend.domain.device.entity.DeviceType;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;

/**
 * W01 요청. 설치 식별자·기기 메타데이터·푸시 토큰은 저장하지 않으므로 받지 않는다. 숫자가 Enum 순번으로 해석되지 않도록 문자열로 받아 검증한다.
 */
public record RegisterDeviceRequest(
        @NotNull @Pattern(regexp = "PHONE|WATCH", message = "PHONE 또는 WATCH만 허용됩니다.")
                String deviceType) {

    public DeviceType type() {
        return DeviceType.valueOf(deviceType);
    }
}
