package com.runway.backend.domain.device.controller;

import com.runway.backend.domain.device.dto.request.RegisterDeviceRequest;
import com.runway.backend.domain.device.dto.response.DeviceListResponse;
import com.runway.backend.domain.device.dto.response.DeviceRegisterResponse;
import com.runway.backend.domain.device.service.DeviceService;
import com.runway.backend.global.auth.CurrentUserIdResolver;
import com.runway.backend.global.security.AuthenticatedUser;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Positive;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/api/v1/devices")
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService deviceService;

    /** 새로 연결하면 201, 같은 유형의 연결 중 기기가 이미 있으면 그 기기를 200으로 반환한다. */
    @PostMapping
    public ResponseEntity<DeviceRegisterResponse> register(
            @AuthenticationPrincipal AuthenticatedUser user,
            @Valid @RequestBody RegisterDeviceRequest request) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        DeviceService.Registration registration =
                deviceService.register(userId, request.type());
        HttpStatus status = registration.created() ? HttpStatus.CREATED : HttpStatus.OK;
        return ResponseEntity.status(status).body(registration.device());
    }

    @GetMapping
    public DeviceListResponse list(
            @AuthenticationPrincipal AuthenticatedUser user,
            @RequestParam(required = false) String deviceType,
            @RequestParam(required = false) String includeUnlinked) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        return deviceService.list(userId, deviceType, includeUnlinked);
    }

    @DeleteMapping("/{deviceId}")
    public Map<String, Object> unlink(
            @AuthenticationPrincipal AuthenticatedUser user,
            @PathVariable @Positive long deviceId) {
        long userId = CurrentUserIdResolver.requireUserId(user);
        deviceService.unlink(userId, deviceId);
        return Map.of();
    }
}
