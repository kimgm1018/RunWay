package com.runway.backend.domain.user.service;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.model.HrPersonalizationSnapshot;
import com.runway.backend.domain.user.repository.HrPersonalizationJdbcRepository;
import java.math.BigDecimal;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;
import tools.jackson.core.JacksonException;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * 심박 개인화(AI06) 저장·조회. 성공 응답을 append-only로 쌓고 최신 행을 읽는다.
 *
 * <p>건강정보 동의 확인은 호출자가 AI 호출 직전에 한다. 이 서비스는 동의를 검사하지 않고 회원 행도 잠그지 않는다.
 *
 * <p>호출자는 DB 예외 메시지·본문을 로그에 남기지 않는다. PostgreSQL 오류에 JSON·심박 값이 포함될 수 있다. AI HTTP 호출을 이
 * 트랜잭션 안에서 하지 않는다.
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class HrPersonalizationService {

    private static final BigDecimal HR_MIN = BigDecimal.valueOf(35);
    private static final BigDecimal HR_MAX = BigDecimal.valueOf(220);
    private static final int THRESHOLD_RUN_COUNT_MAX = 20;
    private static final int P4_LENGTH = 4;

    private final HrPersonalizationJdbcRepository repository;
    private final JsonMapper jsonMapper;

    /**
     * 개인화 결과를 회원의 다음 버전으로 저장한다. 같은 회원의 동시 저장은 advisory lock으로 직렬화한다.
     *
     * @return 배정된 personalization_version
     * @throws IllegalArgumentException 입력이 DB 제약·계약을 벗어난 경우
     */
    @Transactional(isolation = Isolation.READ_COMMITTED)
    public int saveNextVersion(long userId, HrPersonalizationCommand command) {
        validate(command);
        repository.lockPersonalization(userId);
        int version = repository.insertNextVersion(userId, command);
        log.info("HR personalization saved userId={} version={}", userId, version);
        return version;
    }

    /** 회원의 최신 개인화 1건. 없으면 빈 값. */
    @Transactional(readOnly = true, isolation = Isolation.READ_COMMITTED)
    public Optional<HrPersonalizationSnapshot> findLatest(long userId) {
        return repository.findLatest(userId);
    }

    private void validate(HrPersonalizationCommand command) {
        if (command == null) {
            throw new IllegalArgumentException("command must not be null");
        }
        requireText(command.schemaVersion(), "schemaVersion");
        requireText(command.modelVersion(), "modelVersion");
        if (command.supportRunCount() < 0) {
            throw new IllegalArgumentException("supportRunCount must be >= 0");
        }
        requireObjectJson(command.summaryUJson(), "summaryUJson");
        requireArrayJson(command.history8Json(), "history8Json");
        requireP4Json(command.p4Json());
        if (command.hr0SubBpm() == null) {
            throw new IllegalArgumentException("hr0SubBpm must not be null");
        }
        requireHrRange(command.hr0SubBpm(), "hr0SubBpm");
        requireOptionalHrRange(command.hrRefBpm(), "hrRefBpm");
        requireOptionalHrRange(command.hrDangerBpm(), "hrDangerBpm");
        requireOptionalHrRange(command.hrSustainBpm(), "hrSustainBpm");
        Integer thresholdRunCount = command.hrThresholdRunCount();
        if (thresholdRunCount != null
                && (thresholdRunCount < 0 || thresholdRunCount > THRESHOLD_RUN_COUNT_MAX)) {
            throw new IllegalArgumentException("hrThresholdRunCount must be between 0 and 20");
        }
    }

    private void requireObjectJson(String value, String field) {
        JsonNode node = parseJson(value, field);
        if (!node.isObject()) {
            throw new IllegalArgumentException(field + " must be a JSON object");
        }
    }

    private void requireArrayJson(String value, String field) {
        JsonNode node = parseJson(value, field);
        if (!node.isArray()) {
            throw new IllegalArgumentException(field + " must be a JSON array");
        }
    }

    private void requireP4Json(String value) {
        JsonNode node = parseJson(value, "p4Json");
        if (!node.isArray() || node.size() != P4_LENGTH) {
            throw new IllegalArgumentException("p4Json must be a JSON array of length 4");
        }
    }

    private JsonNode parseJson(String value, String field) {
        requireText(value, field);
        try {
            return jsonMapper.readTree(value);
        } catch (JacksonException ex) {
            throw new IllegalArgumentException(field + " must be valid JSON", ex);
        }
    }

    private static void requireText(String value, String field) {
        if (value == null || value.isBlank()) {
            throw new IllegalArgumentException(field + " must not be blank");
        }
    }

    private static void requireOptionalHrRange(BigDecimal value, String field) {
        if (value != null) {
            requireHrRange(value, field);
        }
    }

    private static void requireHrRange(BigDecimal value, String field) {
        if (value.compareTo(HR_MIN) < 0 || value.compareTo(HR_MAX) > 0) {
            throw new IllegalArgumentException(field + " must be between 35 and 220");
        }
    }
}
