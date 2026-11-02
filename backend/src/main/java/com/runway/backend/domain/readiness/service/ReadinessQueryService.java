package com.runway.backend.domain.readiness.service;

import com.runway.backend.domain.readiness.dto.response.ReadinessLatestResponse;
import com.runway.backend.domain.readiness.repository.ReadinessJdbcRepository;
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
     */
    @Transactional(readOnly = true)
    public ReadinessLatestResponse getLatest(long userId) {
        boolean consented =
                repository.findActiveUserConsent(userId).orElseThrow(ReadinessErrors::unauthorized);
        if (!consented) {
            throw ReadinessErrors.consentRequired();
        }
        return repository
                .findLatest(userId)
                .map(ReadinessLatestResponse::from)
                .orElseThrow(ReadinessErrors::notFound);
    }
}
