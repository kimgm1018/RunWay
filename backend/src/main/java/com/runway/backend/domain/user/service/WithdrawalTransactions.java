package com.runway.backend.domain.user.service;

import com.runway.backend.domain.auth.repository.RefreshTokenStore;
import com.runway.backend.domain.crew.service.CrewService;
import com.runway.backend.domain.grouprun.service.GroupRunService;
import com.runway.backend.domain.session.service.RunningSessionControlService;
import com.runway.backend.domain.user.repository.WithdrawalRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class WithdrawalTransactions {
    private final WithdrawalRepository accounts;
    private final RefreshTokenStore tokens;
    private final CrewService crews;
    private final GroupRunService groups;
    private final RunningSessionControlService sessions;
    private final EntityManager entities;
    private final Clock clock;

    @Transactional
    public Instant complete(long userId, String verifiedHash) {
        var account = accounts.account(userId,true).orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        if (account.withdrawn()) {
            if (account.withdrawnAt()==null) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
            return account.withdrawnAt();
        }
        if (!"ACTIVE".equals(account.status())) throw new ApiException(ErrorCode.UNAUTHORIZED);
        if (account.withdrawnAt()!=null) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        if (verifiedHash==null || !verifiedHash.equals(account.passwordHash()))
            throw new ApiException(ErrorCode.INVALID_PASSWORD);
        accounts.lockResources(userId);
        var blockers = accounts.blockers(userId);
        if (!blockers.isEmpty()) throw new ApiException(ErrorCode.WITHDRAWAL_CONFLICT,
                Map.of("blockers",blockers.stream().map(b -> b.details()).toList()));
        tokens.revokeAll(userId);
        for (long groupId : accounts.scheduledGroups(userId)) groups.leave(userId,groupId);
        for (long crewId : accounts.memberCrews(userId)) crews.leave(userId,crewId,null);
        entities.flush();
        entities.clear();
        for (long sessionId : accounts.readySessions(userId)) sessions.cancel(userId,sessionId);
        entities.flush();
        entities.clear();
        accounts.closeLegacyReady(userId);
        Instant now=clock.instant();
        accounts.scrub(userId,now);
        return accounts.markWithdrawn(userId,account.loginId(),now);
    }
}
