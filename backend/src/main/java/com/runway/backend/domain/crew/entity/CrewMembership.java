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
@Table(name = "crew_memberships")
@Getter
@NoArgsConstructor(access = AccessLevel.PROTECTED)
public class CrewMembership {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "crew_id", nullable = false)
    private Long crewId;

    @Column(name = "user_id", nullable = false)
    private Long userId;

    @Enumerated(EnumType.STRING)
    @JdbcTypeCode(SqlTypes.NAMED_ENUM)
    @Column(nullable = false, columnDefinition = "crew_memberships_status_enum")
    private CrewMembershipStatus status;

    @Column(name = "requested_at", nullable = false, insertable = false)
    private Instant requestedAt;

    @Column(name = "joined_at")
    private Instant joinedAt;

    @Column(name = "left_at")
    private Instant leftAt;

    @Column(name = "created_at", nullable = false, insertable = false, updatable = false)
    private Instant createdAt;

    @Column(name = "updated_at", nullable = false, insertable = false, updatable = false)
    private Instant updatedAt;

    public static CrewMembership approveOwner(long crewId, long userId) {
        CrewMembership membership = new CrewMembership();
        membership.crewId = crewId;
        membership.userId = userId;
        membership.status = CrewMembershipStatus.APPROVED;
        membership.joinedAt = Instant.now();
        return membership;
    }

    public static CrewMembership pendingRequest(long crewId, long userId) {
        CrewMembership membership = new CrewMembership();
        membership.crewId = crewId;
        membership.userId = userId;
        membership.status = CrewMembershipStatus.PENDING;
        return membership;
    }

    public void reapply() {
        this.status = CrewMembershipStatus.PENDING;
        this.requestedAt = Instant.now();
        this.joinedAt = null;
        this.leftAt = null;
    }

    public void approve() {
        this.status = CrewMembershipStatus.APPROVED;
        this.joinedAt = Instant.now();
        this.leftAt = null;
    }

    public void reject() {
        this.status = CrewMembershipStatus.REJECTED;
        this.joinedAt = null;
    }

    public void leave() {
        this.status = CrewMembershipStatus.LEFT;
        this.leftAt = Instant.now();
    }
}
