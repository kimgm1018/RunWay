package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.dto.response.ReadinessLatestResponse;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** R02 최신 준비도 조회. 조회는 평가를 실행하지 않는다. */
@Service
@RequiredArgsConstructor
public class ReadinessQueryService {

    private final ReadinessJdbcRepository repository;

    /**
     * 동의 확인과 결과 조회를 한 읽기 트랜잭션에서 한다. 활성 회원이 아니면 401, 건강정보 동의가 없으면 403 CONSENT_REQUIRED, 결과가 없으면 404
     * ASSESSMENT_NOT_FOUND.
     *
     * <p>잠그지 않고 읽으므로 동의 확인 뒤 철회·탈퇴가 커밋될 수 있다. 결과 조회 문장도 동의를 조건으로 두어 그 경우 행이 없고, 이때 동의를 다시
     * 확인해 404 대신 401·403으로 응답한다.
     */
    @Transactional(readOnly = true)
    public ReadinessLatestResponse getLatest(long userId) {
        requireConsent(userId);
        return repository
                .findLatest(userId)
                .map(ReadinessLatestResponse::from)
                .orElseThrow(
                        () -> {
                            requireConsent(userId);
                            return new ApiException(ErrorCode.ASSESSMENT_NOT_FOUND);
                        });
    }

    private void requireConsent(long userId) {
        boolean consented =
                repository
                        .findActiveUserConsent(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        if (!consented) {
            throw new ApiException(ErrorCode.CONSENT_REQUIRED);
        }
    }
}
