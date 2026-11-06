package com.runway.backend.domain.user.service;

import com.runway.backend.domain.auth.service.MemberPasswordHasher;
import com.runway.backend.domain.auth.validation.PasswordPolicy;
import com.runway.backend.domain.image.WithdrawnImageCleanup;
import com.runway.backend.domain.user.dto.request.WithdrawalRequest;
import com.runway.backend.domain.user.dto.response.WithdrawalResponse;
import com.runway.backend.domain.user.dto.response.WithdrawalSummaryResponse;
import com.runway.backend.domain.user.repository.WithdrawalRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.time.Instant;
import java.util.Map;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class WithdrawalService {
    private final WithdrawalRepository accounts;
    private final MemberPasswordHasher passwords;
    private final WithdrawalTransactions transactions;
    private final WithdrawnImageCleanup images;
    private final com.runway.backend.domain.session.service.RecordComparisonService comparisons;

    @Transactional(readOnly=true,isolation=Isolation.REPEATABLE_READ)
    public WithdrawalSummaryResponse summary(long userId) {
        try {
            var account=accounts.account(userId,false).orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
            if (!"ACTIVE".equals(account.status())) throw new ApiException(ErrorCode.UNAUTHORIZED);
        if (account.withdrawnAt()!=null) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
            return accounts.summary(userId);
        } catch (ApiException exception) { throw exception; }
        catch (RuntimeException exception) { throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE); }
    }

    public WithdrawalResponse withdraw(long userId, WithdrawalRequest request) {
        if (request==null || !PasswordPolicy.accepts(request.password()) || !(request.agreed() instanceof Boolean))
            throw new ApiException(ErrorCode.VALIDATION_ERROR);
        if (!Boolean.TRUE.equals(request.agreed())) throw new ApiException(ErrorCode.AGREEMENT_REQUIRED);
        Instant withdrawnAt;
        try {
            var account=accounts.account(userId,false).orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
            String verifiedHash=null;
            if (!account.withdrawn()) {
                if (!"ACTIVE".equals(account.status())) throw new ApiException(ErrorCode.UNAUTHORIZED);
        if (account.withdrawnAt()!=null) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
                if (!passwords.matches((String) request.password(),account.passwordHash()))
                    throw new ApiException(ErrorCode.INVALID_PASSWORD);
                verifiedHash=account.passwordHash();
            }
            // Return only after the proxied transaction has committed.
            withdrawnAt=transactions.complete(userId,verifiedHash);
            comparisons.forgetUser(userId);
        } catch (ApiException exception) { throw exception; }
        catch (RuntimeException exception) { throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE); }
        boolean cleaned;
        try { cleaned=images.clean(userId); }
        catch (RuntimeException exception) {
            throw new ApiException(ErrorCode.IMAGE_CLEANUP_PENDING,
                    Map.of("withdrawalCompleted",true,"withdrawnAt",withdrawnAt.toString()));
        }
        if (!cleaned) throw new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
        return new WithdrawalResponse(withdrawnAt);
    }
}
