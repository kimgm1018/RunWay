package com.runway.backend.domain.user.repository;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.model.HrPersonalizationSnapshot;
import java.time.OffsetDateTime;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 심박 개인화(AI06) 저장·조회 저장소. 값은 바인딩 파라미터로만 전달한다.
 *
 * <p>직접 SQL을 쓰는 이유: 회원별 버전을 {@code MAX+1}로 부여하는 append-only INSERT와 이를 직렬화하는 advisory lock, {@code
 * jsonb} 캐스팅은 JPA 기본 기능으로 표현하기 어렵다. 행은 수정하지 않고 새 버전만 추가한다.
 */
@Repository
@RequiredArgsConstructor
public class HrPersonalizationJdbcRepository {

    /** pg_advisory_xact_lock(int,int)의 첫 번째 키. 준비도(254_001)·세션 생성(255_001)과 구분한다. */
    static final int PERSONALIZATION_LOCK_NAMESPACE = 253_001;

    private final JdbcTemplate jdbc;

    /**
     * 같은 회원의 개인화 버전 부여를 트랜잭션 끝까지 한 줄로 세운다. 회원 ID를 int 범위로 접어 키로 쓰므로 드물게 다른 회원끼리 같이 기다릴 수 있으나 결과는
     * 바뀌지 않는다.
     */
    public void lockPersonalization(long userId) {
        jdbc.query(
                "SELECT pg_advisory_xact_lock(?, ?)",
                rs -> {},
                PERSONALIZATION_LOCK_NAMESPACE,
                (int) (userId % Integer.MAX_VALUE));
    }

    /**
     * 회원의 다음 버전으로 개인화 행을 추가한다. {@link #lockPersonalization(long)}과 같은 트랜잭션에서 호출해야 버전이 겹치지 않는다. created_at은
     * DB 기본값이다.
     *
     * @return 부여된 personalization_version
     */
    public int insertNextVersion(long userId, HrPersonalizationCommand command) {
        Integer version =
                jdbc.queryForObject(
                        """
                        INSERT INTO user_hr_personalization(
                            user_id, personalization_version, schema_version, model_version,
                            support_run_count, summary_u_json, history8_json, p4_json,
                            hr0_sub_bpm, hr_ref_bpm, hr_danger_bpm, hr_sustain_bpm,
                            hr_threshold_run_count)
                        VALUES (
                            ?,
                            COALESCE(
                                (SELECT MAX(personalization_version)
                                   FROM user_hr_personalization
                                  WHERE user_id = ?),
                                0) + 1,
                            ?, ?, ?,
                            CAST(? AS jsonb), CAST(? AS jsonb), CAST(? AS jsonb),
                            ?, ?, ?, ?, ?)
                        RETURNING personalization_version
                        """,
                        Integer.class,
                        userId,
                        userId,
                        command.schemaVersion(),
                        command.modelVersion(),
                        command.supportRunCount(),
                        command.summaryUJson(),
                        command.history8Json(),
                        command.p4Json(),
                        command.hr0SubBpm(),
                        command.hrRefBpm(),
                        command.hrDangerBpm(),
                        command.hrSustainBpm(),
                        command.hrThresholdRunCount());
        if (version == null) {
            throw new IllegalStateException("user_hr_personalization insert returned no version");
        }
        return version;
    }

    /** 회원의 가장 높은 버전 개인화 1건. 없으면 빈 값. */
    public Optional<HrPersonalizationSnapshot> findLatest(long userId) {
        return jdbc
                .query(
                        """
                        SELECT user_id, personalization_version, schema_version, model_version,
                               support_run_count, summary_u_json, history8_json, p4_json,
                               hr0_sub_bpm, hr_ref_bpm, hr_danger_bpm, hr_sustain_bpm,
                               hr_threshold_run_count, created_at
                        FROM user_hr_personalization
                        WHERE user_id = ?
                        ORDER BY personalization_version DESC
                        LIMIT 1
                        """,
                        (rs, n) ->
                                new HrPersonalizationSnapshot(
                                        rs.getLong("user_id"),
                                        rs.getInt("personalization_version"),
                                        rs.getString("schema_version"),
                                        rs.getString("model_version"),
                                        rs.getInt("support_run_count"),
                                        rs.getString("summary_u_json"),
                                        rs.getString("history8_json"),
                                        rs.getString("p4_json"),
                                        rs.getBigDecimal("hr0_sub_bpm"),
                                        rs.getBigDecimal("hr_ref_bpm"),
                                        rs.getBigDecimal("hr_danger_bpm"),
                                        rs.getBigDecimal("hr_sustain_bpm"),
                                        rs.getObject("hr_threshold_run_count", Integer.class),
                                        rs.getObject("created_at", OffsetDateTime.class)),
                        userId)
                .stream()
                .findFirst();
    }
}
