package com.runway.backend.domain.user.entity;

import com.runway.backend.domain.user.model.RunningBaseline;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.EnumType;
import jakarta.persistence.Enumerated;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

import lombok.AccessLevel;
import lombok.Getter;
import lombok.NoArgsConstructor;

import org.hibernate.annotations.JdbcTypeCode;
import org.hibernate.type.SqlTypes;

import java.math.BigDecimal;
import java.time.Instant;
import java.util.Objects;

@Entity
@Table(name = "user_profiles")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class UserProfile {
    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "user_id", nullable = false, unique = true, updatable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(
            name = "running_level",
            nullable = false,
            columnDefinition = "user_profiles_running_level_enum")
    private RunningLevel runningLevel;

    @Column(name = "average_pace", nullable = false, precision = 10, scale = 2)
    private BigDecimal averagePace;

    @Column(name = "distance")
    private Integer distance;

    @Column(name = "duraction")
    private Integer duration;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static UserProfile create(long userId, RunningLevel level, RunningBaseline baseline) {
        if (userId <= 0) throw new IllegalArgumentException("회원 식별자가 필요합니다.");
        UserProfile profile = new UserProfile();
        profile.userId = userId;
        profile.changeLevel(level);
        profile.changeBaseline(baseline);
        return profile;
    }

    public void changeLevel(RunningLevel level) {
        runningLevel = Objects.requireNonNull(level);
    }

    public void changeBaseline(RunningBaseline baseline) {
        Objects.requireNonNull(baseline);
        averagePace = baseline.pace();
        distance = baseline.distance();
        duration = baseline.duration();
    }
}
