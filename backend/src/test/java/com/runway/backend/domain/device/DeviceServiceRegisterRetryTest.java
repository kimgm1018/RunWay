package com.runway.backend.domain.device;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.device.entity.DeviceType;
import com.runway.backend.domain.device.entity.UserDevice;
import com.runway.backend.domain.device.repository.UserDeviceRepository;
import com.runway.backend.domain.device.service.DeviceService;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 동시 등록 경합의 재조회 분기를 결정적으로 재현한다. 실제 DB 경합은 DeviceConcurrencyIntegrationTest가 확인하며, 이 테스트는 인덱스
 * 위반 뒤 승자 행이 이미 해제된 실행 순서를 고정한다.
 */
class DeviceServiceRegisterRetryTest {

    private static final long USER_ID = 7L;

    private UserDeviceRepository repository;
    private DeviceService service;

    @BeforeEach
    void setUp() {
        repository = mock(UserDeviceRepository.class);
        service = new DeviceService(repository);
        when(repository.activeUserExists(USER_ID)).thenReturn(true);
    }

    private static UserDevice saved(long id) {
        UserDevice device = UserDevice.link(USER_ID, DeviceType.WATCH, Instant.now());
        ReflectionTestUtils.setField(device, "id", id);
        return device;
    }

    @Test
    void 인덱스_위반_뒤_승자가_남아있으면_승자를_200으로_반환한다() {
        when(repository.findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(USER_ID, DeviceType.WATCH))
                .thenReturn(Optional.empty(), Optional.of(saved(11L)));
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uq_user_devices_active"));

        DeviceService.Registration result = service.register(USER_ID, DeviceType.WATCH);

        assertThat(result.created()).isFalse();
        assertThat(result.device().id()).isEqualTo(11L);
        verify(repository, times(1)).saveAndFlush(any());
    }

    @Test
    void 인덱스_위반_뒤_승자가_이미_해제되었으면_다시_등록해_201이다() {
        when(repository.findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(USER_ID, DeviceType.WATCH))
                .thenReturn(Optional.empty());
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("uq_user_devices_active"))
                .thenReturn(saved(12L));

        DeviceService.Registration result = service.register(USER_ID, DeviceType.WATCH);

        assertThat(result.created()).isTrue();
        assertThat(result.device().id()).isEqualTo(12L);
        verify(repository, times(2)).saveAndFlush(any());
    }

    @Test
    void 재시도_한도를_넘으면_원래_예외를_전달한다() {
        when(repository.findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(USER_ID, DeviceType.WATCH))
                .thenReturn(Optional.empty());
        DataIntegrityViolationException violation =
                new DataIntegrityViolationException("uq_user_devices_active");
        when(repository.saveAndFlush(any())).thenThrow(violation);

        assertThatThrownBy(() -> service.register(USER_ID, DeviceType.WATCH)).isSameAs(violation);
        verify(repository, times(3)).saveAndFlush(any());
    }

    @Test
    void 위반_사이에_회원이_삭제되면_401이다() {
        when(repository.activeUserExists(USER_ID)).thenReturn(true, false);
        when(repository.findByUserIdAndDeviceTypeAndUnlinkedAtIsNull(USER_ID, DeviceType.WATCH))
                .thenReturn(Optional.empty());
        when(repository.saveAndFlush(any()))
                .thenThrow(new DataIntegrityViolationException("FK_users_TO_user_devices_1"));

        assertThatThrownBy(() -> service.register(USER_ID, DeviceType.WATCH))
                .hasFieldOrPropertyWithValue("code", "UNAUTHORIZED");
    }
}
