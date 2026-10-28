package com.runway.backend.domain.crew.service;

import com.runway.backend.domain.crew.dto.request.CreateCrewRequest;
import com.runway.backend.domain.crew.dto.request.DecideJoinRequest;
import com.runway.backend.domain.crew.dto.response.CrewCreateResponse;
import com.runway.backend.domain.crew.dto.response.CrewDetailResponse;
import com.runway.backend.domain.crew.dto.response.CrewListResponse;
import com.runway.backend.domain.crew.dto.response.CrewSummaryResponse;
import com.runway.backend.domain.crew.dto.response.DecideJoinResponse;
import com.runway.backend.domain.crew.dto.response.JoinRequestItemResponse;
import com.runway.backend.domain.crew.dto.response.JoinRequestListResponse;
import com.runway.backend.domain.crew.dto.response.JoinRequestResponse;
import com.runway.backend.domain.crew.dto.response.MemberItemResponse;
import com.runway.backend.domain.crew.dto.response.MemberLeaveResponse;
import com.runway.backend.domain.crew.dto.response.MemberListResponse;
import com.runway.backend.domain.crew.dto.response.MyCrewItemResponse;
import com.runway.backend.domain.crew.dto.response.MyCrewListResponse;
import com.runway.backend.domain.crew.entity.Crew;
import com.runway.backend.domain.crew.entity.CrewMembership;
import com.runway.backend.domain.crew.entity.CrewMembershipStatus;
import com.runway.backend.domain.crew.entity.CrewStatus;
import com.runway.backend.domain.crew.repository.CrewMembershipRepository;
import com.runway.backend.domain.crew.repository.CrewRepository;
import com.runway.backend.domain.crew.repository.RegionExistsRepository;
import com.runway.backend.domain.crew.repository.UserExistsRepository;
import com.runway.backend.global.exception.ApiException;
import jakarta.persistence.EntityManager;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Optional;
import java.util.Set;
import java.util.stream.Collectors;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class CrewService {

    private final CrewRepository crewRepository;
    private final CrewMembershipRepository crewMembershipRepository;
    private final UserExistsRepository userExistsRepository;
    private final RegionExistsRepository regionExistsRepository;
    private final EntityManager entityManager;

    @Transactional
    public CrewCreateResponse create(long userId, CreateCrewRequest request) {
        requireExistingUser(userId);
        String regionCode = blankToNull(request.regionCode());
        if (regionCode != null && !regionExistsRepository.existsByRegionCode(regionCode)) {
            throw new ApiException(
                    HttpStatus.UNPROCESSABLE_CONTENT, "INVALID_CREW", "유효하지 않은 지역 코드입니다.");
        }

        Crew crew =
                Crew.create(
                        userId,
                        request.name().trim(),
                        blankToNull(request.description()),
                        blankToNull(request.imageKey()),
                        request.capacity(),
                        regionCode);
        crewRepository.save(crew);
        crewMembershipRepository.save(CrewMembership.approveOwner(crew.getId(), userId));
        crewRepository.flush();
        entityManager.refresh(crew);
        return CrewCreateResponse.from(crew);
    }

    @Transactional(readOnly = true)
    public CrewDetailResponse getDetail(long userId, long crewId) {
        requireExistingUser(userId);
        Crew crew =
                crewRepository
                        .findById(crewId)
                        .orElseThrow(
                                () ->
                                        new ApiException(
                                                HttpStatus.NOT_FOUND,
                                                "CREW_NOT_FOUND",
                                                "크루를 찾을 수 없습니다."));
        long memberCount =
                crewMembershipRepository.countByCrewIdAndStatus(
                        crewId, CrewMembershipStatus.APPROVED);
        CrewMembershipStatus myStatus =
                crewMembershipRepository
                        .findByCrewIdAndUserId(crewId, userId)
                        .map(CrewMembership::getStatus)
                        .orElse(null);
        return CrewDetailResponse.from(crew, memberCount, myStatus);
    }

    @Transactional(readOnly = true)
    public MyCrewListResponse listMyCrews(long userId, String membershipStatus) {
        requireExistingUser(userId);
        Set<CrewMembershipStatus> statuses = resolveMyStatuses(membershipStatus);
        List<CrewMembership> memberships =
                crewMembershipRepository.findByUserIdAndStatusIn(userId, statuses);
        if (memberships.isEmpty()) {
            return new MyCrewListResponse(List.of());
        }

        Map<Long, CrewMembershipStatus> statusByCrewId =
                memberships.stream()
                        .collect(
                                Collectors.toMap(
                                        CrewMembership::getCrewId,
                                        CrewMembership::getStatus,
                                        (a, b) -> a));
        List<Long> crewIds = List.copyOf(statusByCrewId.keySet());
        Map<Long, Long> memberCounts = approvedCounts(crewIds);
        Map<Long, Crew> crews =
                crewRepository.findAllById(crewIds).stream()
                        .collect(Collectors.toMap(Crew::getId, c -> c));

        List<MyCrewItemResponse> items =
                crewIds.stream()
                        .map(crews::get)
                        .filter(Objects::nonNull)
                        .map(
                                crew ->
                                        MyCrewItemResponse.from(
                                                crew,
                                                statusByCrewId.get(crew.getId()),
                                                memberCounts.getOrDefault(crew.getId(), 0L),
                                                userId))
                        .toList();
        return new MyCrewListResponse(items);
    }

    @Transactional(readOnly = true)
    public CrewListResponse search(long userId, String q, String regionCode) {
        requireExistingUser(userId);
        String query = blankToNull(q);
        String region = blankToNull(regionCode);
        List<Crew> crews = crewRepository.searchActive(CrewStatus.ACTIVE, query, region);
        if (crews.isEmpty()) {
            return new CrewListResponse(List.of());
        }

        List<Long> crewIds = crews.stream().map(Crew::getId).toList();
        Map<Long, Long> memberCounts = approvedCounts(crewIds);
        Map<Long, CrewMembershipStatus> myStatuses = myStatuses(userId, crewIds);

        List<CrewSummaryResponse> items =
                crews.stream()
                        .sorted(
                                (a, b) -> {
                                    boolean aOpen =
                                            memberCounts.getOrDefault(a.getId(), 0L)
                                                    < a.getCapacity();
                                    boolean bOpen =
                                            memberCounts.getOrDefault(b.getId(), 0L)
                                                    < b.getCapacity();
                                    if (aOpen != bOpen) {
                                        return aOpen ? -1 : 1;
                                    }
                                    return Long.compare(a.getId(), b.getId());
                                })
                        .map(
                                crew ->
                                        CrewSummaryResponse.from(
                                                crew,
                                                memberCounts.getOrDefault(crew.getId(), 0L),
                                                myStatuses.get(crew.getId())))
                        .toList();
        return new CrewListResponse(items);
    }

    @Transactional
    public JoinRequestResponse createJoinRequest(long userId, long crewId) {
        requireExistingUser(userId);
        requireActiveCrew(crewId);

        Optional<CrewMembership> existing =
                crewMembershipRepository.findByCrewIdAndUserId(crewId, userId);
        CrewMembership membership;
        if (existing.isPresent()) {
            membership = existing.get();
            CrewMembershipStatus status = membership.getStatus();
            if (status == CrewMembershipStatus.PENDING || status == CrewMembershipStatus.APPROVED) {
                throw new ApiException(
                        HttpStatus.CONFLICT,
                        "ALREADY_MEMBER_OR_PENDING",
                        "이미 멤버이거나 가입 신청 대기 중입니다.");
            }
            membership.reapply();
        } else {
            membership = CrewMembership.pendingRequest(crewId, userId);
            crewMembershipRepository.save(membership);
        }
        crewMembershipRepository.flush();
        entityManager.refresh(membership);
        return JoinRequestResponse.from(membership);
    }

    @Transactional(readOnly = true)
    public JoinRequestListResponse listJoinRequests(long userId, long crewId, String status) {
        requireExistingUser(userId);
        Crew crew = requireCrew(crewId);
        requireOwner(crew, userId);

        CrewMembershipStatus filter = resolveJoinRequestStatus(status);
        List<CrewMembership> memberships =
                crewMembershipRepository.findByCrewIdAndStatus(crewId, filter);
        Map<Long, String> nicknames =
                userExistsRepository.findNicknamesByIds(
                        memberships.stream().map(CrewMembership::getUserId).toList());

        List<JoinRequestItemResponse> items =
                memberships.stream()
                        .map(
                                m ->
                                        JoinRequestItemResponse.from(
                                                m, nicknames.getOrDefault(m.getUserId(), null)))
                        .toList();
        return new JoinRequestListResponse(items);
    }

    @Transactional
    public DecideJoinResponse decideJoinRequest(
            long ownerUserId, long crewId, long targetUserId, DecideJoinRequest request) {
        requireExistingUser(ownerUserId);
        Crew crew = requireCrew(crewId);
        requireOwner(crew, ownerUserId);

        CrewMembershipStatus decision = resolveDecisionStatus(request.status());
        CrewMembership membership =
                crewMembershipRepository
                        .findByCrewIdAndUserId(crewId, targetUserId)
                        .orElseThrow(CrewService::notPending);

        if (membership.getStatus() != CrewMembershipStatus.PENDING) {
            throw notPending();
        }

        if (decision == CrewMembershipStatus.APPROVED) {
            long approvedCount =
                    crewMembershipRepository.countByCrewIdAndStatus(
                            crewId, CrewMembershipStatus.APPROVED);
            if (approvedCount >= crew.getCapacity()) {
                throw new ApiException(
                        HttpStatus.CONFLICT, "CREW_CAPACITY_EXCEEDED", "크루 정원이 가득 찼습니다.");
            }
            membership.approve();
        } else {
            membership.reject();
        }
        return DecideJoinResponse.from(membership);
    }

    @Transactional(readOnly = true)
    public MemberListResponse listMembers(long userId, long crewId) {
        requireExistingUser(userId);
        Crew crew = requireCrew(crewId);
        List<CrewMembership> memberships =
                crewMembershipRepository.findByCrewIdAndStatus(
                        crewId, CrewMembershipStatus.APPROVED);
        Map<Long, String> nicknames =
                userExistsRepository.findNicknamesByIds(
                        memberships.stream().map(CrewMembership::getUserId).toList());
        List<MemberItemResponse> items =
                memberships.stream()
                        .map(
                                m ->
                                        MemberItemResponse.from(
                                                m,
                                                nicknames.getOrDefault(m.getUserId(), null),
                                                crew.isOwnedBy(m.getUserId())))
                        .toList();
        return new MemberListResponse(items);
    }

    @Transactional
    public MemberLeaveResponse leave(long userId, long crewId) {
        requireExistingUser(userId);
        Crew crew = requireCrew(crewId);
        if (crew.isOwnedBy(userId)) {
            throw new ApiException(
                    HttpStatus.CONFLICT, "OWNER_CANNOT_LEAVE", "크루장은 권한 이양 없이 탈퇴할 수 없습니다.");
        }
        CrewMembership membership = requireApprovedMembership(crewId, userId);
        membership.leave();
        return MemberLeaveResponse.from(membership);
    }

    @Transactional
    public MemberLeaveResponse removeMember(long ownerUserId, long crewId, long targetUserId) {
        requireExistingUser(ownerUserId);
        Crew crew = requireCrew(crewId);
        requireOwner(crew, ownerUserId);
        if (crew.isOwnedBy(targetUserId)) {
            throw new ApiException(HttpStatus.CONFLICT, "CANNOT_REMOVE_OWNER", "크루장은 내보낼 수 없습니다.");
        }
        CrewMembership membership = requireApprovedMembership(crewId, targetUserId);
        membership.leave();
        return MemberLeaveResponse.from(membership);
    }

    private CrewMembership requireApprovedMembership(long crewId, long userId) {
        CrewMembership membership =
                crewMembershipRepository
                        .findByCrewIdAndUserId(crewId, userId)
                        .orElseThrow(CrewService::memberNotFound);
        if (membership.getStatus() != CrewMembershipStatus.APPROVED) {
            throw memberNotFound();
        }
        return membership;
    }

    private static ApiException memberNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "MEMBER_NOT_FOUND", "멤버를 찾을 수 없습니다.");
    }

    private Crew requireActiveCrew(long crewId) {
        Crew crew = requireCrew(crewId);
        if (crew.getStatus() != CrewStatus.ACTIVE) {
            throw crewNotFound();
        }
        return crew;
    }

    private Crew requireCrew(long crewId) {
        return crewRepository.findById(crewId).orElseThrow(CrewService::crewNotFound);
    }

    private static void requireOwner(Crew crew, long userId) {
        if (!crew.isOwnedBy(userId)) {
            throw new ApiException(HttpStatus.FORBIDDEN, "NOT_ADMIN", "크루 관리 권한이 없습니다.");
        }
    }

    private static CrewMembershipStatus resolveJoinRequestStatus(String status) {
        if (status == null || status.isBlank()) {
            return CrewMembershipStatus.PENDING;
        }
        try {
            return CrewMembershipStatus.valueOf(status.trim());
        } catch (IllegalArgumentException ex) {
            throw new ApiException(
                    HttpStatus.BAD_REQUEST,
                    "INVALID_FILTER",
                    "status는 PENDING, APPROVED, REJECTED, LEFT만 허용됩니다.");
        }
    }

    private static CrewMembershipStatus resolveDecisionStatus(String status) {
        if (status == null || status.isBlank()) {
            throw invalidDecision();
        }
        try {
            CrewMembershipStatus decision = CrewMembershipStatus.valueOf(status.trim());
            if (decision != CrewMembershipStatus.APPROVED
                    && decision != CrewMembershipStatus.REJECTED) {
                throw invalidDecision();
            }
            return decision;
        } catch (IllegalArgumentException ex) {
            throw invalidDecision();
        }
    }

    private static ApiException crewNotFound() {
        return new ApiException(HttpStatus.NOT_FOUND, "CREW_NOT_FOUND", "크루를 찾을 수 없습니다.");
    }

    private static ApiException notPending() {
        return new ApiException(HttpStatus.CONFLICT, "NOT_PENDING", "대기 중인 가입 신청이 없습니다.");
    }

    private static ApiException invalidDecision() {
        return new ApiException(
                HttpStatus.UNPROCESSABLE_CONTENT,
                "INVALID_DECISION",
                "status는 APPROVED 또는 REJECTED만 허용됩니다.");
    }

    private Map<Long, Long> approvedCounts(List<Long> crewIds) {
        Map<Long, Long> counts = new HashMap<>();
        for (CrewMembershipRepository.CrewIdCount row :
                crewMembershipRepository.countApprovedByCrewIds(
                        crewIds, CrewMembershipStatus.APPROVED)) {
            counts.put(row.getCrewId(), row.getCnt());
        }
        return counts;
    }

    private Map<Long, CrewMembershipStatus> myStatuses(long userId, List<Long> crewIds) {
        Map<Long, CrewMembershipStatus> statuses = new HashMap<>();
        for (Long crewId : crewIds) {
            crewMembershipRepository
                    .findByCrewIdAndUserId(crewId, userId)
                    .ifPresent(m -> statuses.put(crewId, m.getStatus()));
        }
        return statuses;
    }

    private Set<CrewMembershipStatus> resolveMyStatuses(String membershipStatus) {
        if (membershipStatus == null || membershipStatus.isBlank()) {
            return EnumSet.of(CrewMembershipStatus.APPROVED, CrewMembershipStatus.PENDING);
        }
        try {
            CrewMembershipStatus status = CrewMembershipStatus.valueOf(membershipStatus.trim());
            if (status != CrewMembershipStatus.APPROVED && status != CrewMembershipStatus.PENDING) {
                throw invalidMembershipFilter();
            }
            return EnumSet.of(status);
        } catch (IllegalArgumentException ex) {
            throw invalidMembershipFilter();
        }
    }

    private static ApiException invalidMembershipFilter() {
        return new ApiException(
                HttpStatus.BAD_REQUEST,
                "INVALID_FILTER",
                "membershipStatus는 APPROVED 또는 PENDING만 허용됩니다.");
    }

    private void requireExistingUser(long userId) {
        if (!userExistsRepository.existsById(userId)) {
            throw new ApiException(HttpStatus.UNAUTHORIZED, "UNAUTHORIZED", "인증이 필요합니다.");
        }
    }

    private static String blankToNull(String value) {
        if (value == null) {
            return null;
        }
        String trimmed = value.trim();
        return trimmed.isEmpty() ? null : trimmed;
    }
}
