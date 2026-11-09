package com.runway.backend.domain.crew.entity;

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

@Entity
@Table(name = "crews")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class Crew {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "owner_id", nullable = false)
    private Long ownerId;

    @Column(nullable = false, length = 100)
    private String name;

    @Column(columnDefinition = "TEXT")
    private String description;

    @Column(name = "image_key", length = 1024)
    private String imageKey;

    @Column(nullable = false)
    private Integer capacity;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "crews_status_enum")
    private CrewStatus status;

    @Column(name = "region_code", length = 40)
    private String regionCode;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(name = "join_policy", nullable = false, columnDefinition = "crews_join_policy_enum")
    private CrewJoinPolicy joinPolicy;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static Crew create(
            long ownerId,
            String name,
            String description,
            String imageKey,
            int capacity,
            String regionCode,
            CrewJoinPolicy joinPolicy) {
        Crew crew = new Crew();
        crew.ownerId = ownerId;
        crew.name = name;
        crew.description = description;
        crew.imageKey = imageKey;
        crew.capacity = capacity;
        crew.regionCode = regionCode;
        crew.joinPolicy = joinPolicy;
        crew.status = CrewStatus.ACTIVE;
        return crew;
    }

    public boolean isOwnedBy(long userId) {
        return ownerId.equals(userId);
    }

    public void transferOwnership(long newOwnerId) {
        this.ownerId = newOwnerId;
    }

    public void changeCapacity(int capacity) {
        this.capacity = capacity;
    }

    public void changeJoinPolicy(CrewJoinPolicy joinPolicy) {
        this.joinPolicy = joinPolicy;
    }

    public void deactivate() {
        this.status = CrewStatus.INACTIVE;
    }
}
