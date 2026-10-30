package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.response.DeviceItemResponse;
import com.runway.backend.domain.device.dto.response.DeviceListResponse;
import com.runway.backend.domain.device.dto.response.DeviceRegisterResponse;
import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.device.entity.UserDevice;
import com.runway.backend.domain.device.repository.UserDeviceRepository;
import com.runway.backend.global.exception.ApiException;
import java.time.Instant;
import java.util.List;
import lombok.RequiredArgsConstructor;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class DeviceService {

    static final int MAX_REGISTER_ATTEMPTS = 3;

    private final UserDeviceRepository userDeviceRepository;

    /**
     * W01. 회원·유형별로 연결 중인 기기는 하나다. 이미 있으면 그 기기를 200으로, 없으면 새로 등록해 201로 반환한다.
     *
     * <p>같은 요청이 동시에 오면 둘 다 "없음"을 보고 INSERT하고, 늦은 쪽은 uq_user_devices_active 위반으로 실패한다.
     * 이때 늦은 요청은 다시 조회해 먼저 저장된 기기를 200으로 돌려준다.
     *
     * <p>메서드에 @Transactional을 걸지 않는다. PostgreSQL은 실패한 트랜잭션 안에서 이후 쿼리를 모두 거부하므로,
     * 저장소 호출마다 별도 트랜잭션으로 실행해야 실패 뒤 재조회가 가능하다. 재조회 전에 먼저 저장된 기기가 W03으로
     * 해제되었으면 다시 등록을 시도하며, 최대 3회까지 시도한다.
     */
    public Registration register(long userId, DeviceType deviceType) {
        for (int attempt = 1; ; attempt++) {
            requireExistingUser(userId);
            var existing =
                    userDeviceRepository.findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(
                            userId, deviceType);
            if (existing.isPresent()) {
                return new Registration(DeviceRegisterResponse.from(existing.get()), false);
            }
            try {
                UserDevice saved =
                        userDeviceRepository.saveAndFlush(
                                UserDevice.link(userId, deviceType, Instant.now()));
                return new Registration(DeviceRegisterResponse.from(saved), true);
            } catch (DataIntegrityViolationException ex) {
                if (attempt >= MAX_REGISTER_ATTEMPTS) {
                    throw ex;
                }
            }
        }
    }

    /** W02. 연결 해제 이력은 includeUnlinked=true일 때만 포함한다. */
    @Transactional(readOnly = true)
    public DeviceListResponse list(long userId, String deviceType, String includeUnlinked) {
        DeviceType filter = parseDeviceTypeFilter(deviceType);
        boolean withUnlinked = parseIncludeUnlinked(includeUnlinked);
        requireExistingUser(userId);
        List<DeviceItemResponse> items =
                userDeviceRepository.findByUserIdOrderByLinkedAtDescIdDesc(userId).stream()
                        .filter(device -> filter == null || device.getDeviceType() == filter)
                        .filter(device -> withUnlinked || device.isLinked())
                        .map(DeviceItemResponse::from)
                        .toList();
        return new DeviceListResponse(items);
    }

    /** W03. 이미 해제된 본인 기기는 성공으로 처리하고, 타인·없는 기기는 존재를 드러내지 않도록 모두 404로 처리한다. */
    @Transactional
    public void unlink(long userId, long deviceId) {
        requireExistingUser(userId);
        if (userDeviceRepository.unlink(deviceId, userId, Instant.now()) > 0) {
            return;
        }
        if (!userDeviceRepository.existsByIdAndUserId(deviceId, userId)) {
            throw new ApiException(
                    HttpStatus.NOT_FOUND, "DEVICE_NOT_FOUND", "기기를 찾을 수 없습니다.");
        }
    }

    private DeviceType parseDeviceTypeFilter(String deviceType) {
        if (deviceType == null) {
            return null;
        }
        try {
            return DeviceType.valueOf(deviceType);
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "VALIDATION_ERROR",
                    "deviceType은 PHONE 또는 WATCH만 허용됩니다.");
        }
    }

    /** Spring의 boolean 변환은 yes·on·1 등도 받으므로 계약대로 true/false만 허용한다. */
    private boolean parseIncludeUnlinked(String includeUnlinked) {
        if (includeUnlinked == null || includeUnlinked.equals("false")) {
            return false;
        }
        if (includeUnlinked.equals("true")) {
            return true;
        }
        throw new ApiException(
                HttpStatus.BAD_REQUEST,
                "VALIDATION_ERROR",
                "includeUnlinked는 true 또는 false만 허용됩니다.");
    }

    private void requireExistingUser(long userId) {
        if (!userDeviceRepository.activeUserExists(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }

    public record Registration(DeviceRegisterResponse device, boolean created) {}
}
