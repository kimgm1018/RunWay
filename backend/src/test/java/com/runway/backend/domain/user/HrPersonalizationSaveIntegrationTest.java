package com.runway.backend.domain.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.model.HrPersonalizationSnapshot;

import org.junit.jupiter.api.Test;
import org.springframework.dao.DataAccessException;
import org.springframework.dao.DataIntegrityViolationException;

import java.math.BigDecimal;
import java.time.OffsetDateTime;

class HrPersonalizationSaveIntegrationTest extends HrPersonalizationIntegrationSupport {

    @Test
    void firstSaveIsVersionOneAndLatestMatchesCommand() {
        var command = command();

        int version = service.saveNextVersion(user, command);

        assertThat(version).isEqualTo(1);
        var latest = service.findLatest(user).orElseThrow();
        assertMatches(latest, user, 1, command);
        assertThat(latest.createdAt()).isNotNull();
        assertThat(latest.createdAt()).isBeforeOrEqualTo(OffsetDateTime.now().plusMinutes(1));
    }

    @Test
    void findLatestIsEmptyWhenNothingSaved() {
        assertThat(service.findLatest(user)).isEmpty();
    }

    @Test
    void secondSaveIsVersionTwoAndLatestReturnsOnlyNewest() {
        var first = command("model-synthetic-1", 3);
        var second = command("model-synthetic-2", 9);

        assertThat(service.saveNextVersion(user, first)).isEqualTo(1);
        assertThat(service.saveNextVersion(user, second)).isEqualTo(2);

        var latest = service.findLatest(user).orElseThrow();
        assertMatches(latest, user, 2, second);
        assertThat(latest.modelVersion()).isEqualTo("model-synthetic-2");
        assertThat(latest.supportRunCount()).isEqualTo(9);
        // append-only: 이전 버전 행은 보존된다.
        assertThat(count(user)).isEqualTo(2);
        assertThat(
                        jdbc.queryForObject(
                                "SELECT model_version FROM user_hr_personalization WHERE user_id=?"
                                        + " AND personalization_version=1",
                                String.class,
                                user))
                .isEqualTo("model-synthetic-1");
    }

    @Test
    void nullableHrAndThresholdFieldsAreStoredAndReadAsNull() {
        var command = commandWithoutOptionals();

        assertThat(service.saveNextVersion(user, command)).isEqualTo(1);

        var latest = service.findLatest(user).orElseThrow();
        assertThat(latest.hrRefBpm()).isNull();
        assertThat(latest.hrDangerBpm()).isNull();
        assertThat(latest.hrSustainBpm()).isNull();
        assertThat(latest.hrThresholdRunCount()).isNull();
        assertMatches(latest, user, 1, command);
    }

    @Test
    void hrDangerBpmIsStoredAsGivenWithoutPlusThree() {
        var command =
                new HrPersonalizationCommand(
                        "hr-personalization-v1",
                        "model-synthetic-1",
                        5,
                        "{\"u\":[1]}",
                        "[1,2,3,4,5,6,7,8]",
                        "[1,2,3,4]",
                        new BigDecimal("85.00"),
                        new BigDecimal("140.00"),
                        new BigDecimal("170.00"),
                        new BigDecimal("155.00"),
                        10);

        service.saveNextVersion(user, command);

        var latest = service.findLatest(user).orElseThrow();
        assertThat(latest.hrDangerBpm()).isEqualByComparingTo("170.00");
        assertThat(latest.hrDangerBpm()).isNotEqualByComparingTo("173.00");
        assertThat(
                        jdbc.queryForObject(
                                "SELECT hr_danger_bpm FROM user_hr_personalization WHERE user_id=?",
                                BigDecimal.class,
                                user))
                .isEqualByComparingTo("170.00");
    }

    @Test
    void malformedJsonIsRejectedByServiceAndNothingIsStored() {
        var bad =
                new HrPersonalizationCommand(
                        "hr-personalization-v1",
                        "model-synthetic-1",
                        1,
                        "{not json",
                        "[1,2,3,4,5,6,7,8]",
                        "[1,2,3,4]",
                        new BigDecimal("85"),
                        null,
                        null,
                        null,
                        null);

        assertThatThrownBy(() -> service.saveNextVersion(user, bad))
                .isInstanceOf(IllegalArgumentException.class)
                .isNotInstanceOf(DataAccessException.class);

        assertThat(count(user)).isZero();
        // 실패한 저장이 버전을 소모하지 않는다.
        assertThat(service.saveNextVersion(user, command())).isEqualTo(1);
    }

    @Test
    void differentUsersHaveIndependentVersions() {
        assertThat(service.saveNextVersion(user, command())).isEqualTo(1);
        assertThat(service.saveNextVersion(user, command())).isEqualTo(2);
        assertThat(service.saveNextVersion(other, command())).isEqualTo(1);
        assertThat(service.saveNextVersion(user, command())).isEqualTo(3);
        assertThat(service.saveNextVersion(other, command())).isEqualTo(2);

        assertThat(service.findLatest(user).orElseThrow().personalizationVersion()).isEqualTo(3);
        assertThat(service.findLatest(other).orElseThrow().personalizationVersion()).isEqualTo(2);
        assertThat(count(user)).isEqualTo(3);
        assertThat(count(other)).isEqualTo(2);
    }

    @Test
    void unknownUserViolatesForeignKey() {
        assertThatThrownBy(() -> service.saveNextVersion(Long.MAX_VALUE - 1, command()))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void outOfRangeInputIsRejectedBeforeInsert() {
        var base = command();
        var tooLow =
                new HrPersonalizationCommand(
                        base.schemaVersion(),
                        base.modelVersion(),
                        base.supportRunCount(),
                        base.summaryUJson(),
                        base.history8Json(),
                        base.p4Json(),
                        new BigDecimal("34.99"),
                        base.hrRefBpm(),
                        base.hrDangerBpm(),
                        base.hrSustainBpm(),
                        base.hrThresholdRunCount());
        var tooManyRuns =
                new HrPersonalizationCommand(
                        base.schemaVersion(),
                        base.modelVersion(),
                        base.supportRunCount(),
                        base.summaryUJson(),
                        base.history8Json(),
                        base.p4Json(),
                        base.hr0SubBpm(),
                        base.hrRefBpm(),
                        base.hrDangerBpm(),
                        base.hrSustainBpm(),
                        21);

        assertThatThrownBy(() -> service.saveNextVersion(user, tooLow))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.saveNextVersion(user, tooManyRuns))
                .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> service.saveNextVersion(user, null))
                .isInstanceOf(IllegalArgumentException.class);
        assertThat(count(user)).isZero();
    }

    /** AI 서비스가 읽는 SQL을 그대로 실행해 컬럼이 채워지고 Snapshot과 같은지 확인한다. */
    @Test
    void aiHandoffSelectReturnsSameRowAsSnapshot() {
        service.saveNextVersion(user, command("model-synthetic-1", 3));
        var second = command("model-synthetic-2", 11);
        service.saveNextVersion(user, second);
        var snapshot = service.findLatest(user).orElseThrow();

        var row =
                jdbc.queryForList(
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
                        user)
                        .getFirst();

        assertThat(row).hasSize(14);
        assertThat(row.values()).doesNotContainNull();
        assertThat(((Number) row.get("user_id")).longValue()).isEqualTo(snapshot.userId());
        assertThat(row.get("personalization_version")).isEqualTo(2);
        assertThat(row.get("personalization_version"))
                .isEqualTo(snapshot.personalizationVersion());
        assertThat(row.get("schema_version")).isEqualTo(snapshot.schemaVersion());
        assertThat(row.get("model_version")).isEqualTo("model-synthetic-2");
        assertThat(row.get("support_run_count")).isEqualTo(11);
        assertThat((BigDecimal) row.get("hr0_sub_bpm")).isEqualByComparingTo(snapshot.hr0SubBpm());
        assertThat((BigDecimal) row.get("hr_ref_bpm")).isEqualByComparingTo(snapshot.hrRefBpm());
        assertThat((BigDecimal) row.get("hr_danger_bpm"))
                .isEqualByComparingTo(snapshot.hrDangerBpm());
        assertThat((BigDecimal) row.get("hr_sustain_bpm"))
                .isEqualByComparingTo(snapshot.hrSustainBpm());
        assertThat(row.get("hr_threshold_run_count")).isEqualTo(snapshot.hrThresholdRunCount());
        assertThat(row.get("created_at")).isNotNull();

        // jsonb 컬럼은 문자열로 읽어 파싱할 수 있어야 하며 Snapshot·입력과 트리가 같다.
        for (var column : new String[] {"summary_u_json", "history8_json", "p4_json"}) {
            String raw = row.get(column).toString();
            assertThat(mapper.readTree(raw).isContainer()).as(column).isTrue();
        }
        assertThat(mapper.readTree(row.get("summary_u_json").toString()))
                .isEqualTo(mapper.readTree(snapshot.summaryUJson()))
                .isEqualTo(mapper.readTree(second.summaryUJson()));
        assertThat(mapper.readTree(row.get("history8_json").toString()))
                .isEqualTo(mapper.readTree(snapshot.history8Json()))
                .isEqualTo(mapper.readTree(second.history8Json()));
        assertThat(mapper.readTree(row.get("p4_json").toString()))
                .isEqualTo(mapper.readTree(snapshot.p4Json()))
                .isEqualTo(mapper.readTree(second.p4Json()));
    }

    private void assertMatches(
            HrPersonalizationSnapshot actual,
            long userId,
            int version,
            HrPersonalizationCommand expected) {
        assertThat(actual.userId()).isEqualTo(userId);
        assertThat(actual.personalizationVersion()).isEqualTo(version);
        assertThat(actual.schemaVersion()).isEqualTo(expected.schemaVersion());
        assertThat(actual.modelVersion()).isEqualTo(expected.modelVersion());
        assertThat(actual.supportRunCount()).isEqualTo(expected.supportRunCount());
        assertThat(mapper.readTree(actual.summaryUJson()))
                .isEqualTo(mapper.readTree(expected.summaryUJson()));
        assertThat(mapper.readTree(actual.history8Json()))
                .isEqualTo(mapper.readTree(expected.history8Json()));
        assertThat(mapper.readTree(actual.p4Json()))
                .isEqualTo(mapper.readTree(expected.p4Json()));
        assertThat(actual.hr0SubBpm()).isEqualByComparingTo(expected.hr0SubBpm());
        assertBigDecimal(actual.hrRefBpm(), expected.hrRefBpm());
        assertBigDecimal(actual.hrDangerBpm(), expected.hrDangerBpm());
        assertBigDecimal(actual.hrSustainBpm(), expected.hrSustainBpm());
        assertThat(actual.hrThresholdRunCount()).isEqualTo(expected.hrThresholdRunCount());
    }

    private static void assertBigDecimal(BigDecimal actual, BigDecimal expected) {
        if (expected == null) {
            assertThat(actual).isNull();
        } else {
            assertThat(actual).isEqualByComparingTo(expected);
        }
    }
}
