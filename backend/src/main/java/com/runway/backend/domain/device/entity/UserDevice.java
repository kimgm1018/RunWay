package com.runway.backend.domain.device.entity;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;
import java.time.Instant;
import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;
import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

/** 서버 등록 관계. 실제 블루투스 연결 상태가 아니며, unlinked_at이 NULL이면 연결 중이다. */
@Entity
@Table(name = "user_devices")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserDevice {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, updatable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "device_type",
            nullable = false,
            updatable = false,
            columnDefinition = "user_devices_device_type_enum")
    private DeviceType deviceType;

    @Column(name = "linked_at", nullable = false, updatable = false)
    private Instant linkedAt;

    @Column(name = "unlinked_at")
    private Instant unlinkedAt;

    public static UserDevice link(long userId, DeviceType deviceType, Instant linkedAt) {
        UserDevice device = new UserDevice();
        device.userId = userId;
        device.deviceType = deviceType;
        device.linkedAt = linkedAt;
        return device;
    }

    public boolean isLinked() {
        return unlinkedAt == null;
    }
}
