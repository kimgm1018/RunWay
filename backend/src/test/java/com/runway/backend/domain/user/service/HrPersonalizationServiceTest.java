package com.runway.backend.domain.user.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.user.model.HrPersonalizationCommand;
import com.runway.backend.domain.user.model.HrPersonalizationSnapshot;
import com.runway.backend.domain.user.repository.HrPersonalizationJdbcRepository;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.InOrder;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import tools.jackson.databind.json.JsonMapper;

@ExtendWith(MockitoExtension.class)
class HrPersonalizationServiceTest {

    private static final long USER_ID = 7L;
    private static final String SUMMARY = "{\"u\":[1]}";
    private static final String HISTORY8 = "[1,2,3,4,5,6,7,8]";
    private static final String P4 = "[0.5,-0.5,1.5,2.5]";

    @Mock private HrPersonalizationJdbcRepository repository;

    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    private HrPersonalizationService service() {
        return new HrPersonalizationService(repository, jsonMapper);
    }

    private static HrPersonalizationCommand validCommand() {
        return command(
                "v1",
                "ode-1",
                5,
                SUMMARY,
                HISTORY8,
                P4,
                new BigDecimal("85.00"),
                new BigDecimal("150.00"),
                new BigDecimal("185.00"),
                new BigDecimal("170.00"),
                10);
    }

    private static HrPersonalizationCommand command(
            String schemaVersion,
            String modelVersion,
            int supportRunCount,
            String summaryUJson,
            String history8Json,
            String p4Json,
            BigDecimal hr0,
            BigDecimal ref,
            BigDecimal danger,
            BigDecimal sustain,
            Integer thresholdRunCount) {
        return new HrPersonalizationCommand(
                schemaVersion,
                modelVersion,
                supportRunCount,
                summaryUJson,
                history8Json,
                p4Json,
                hr0,
                ref,
                danger,
                sustain,
                thresholdRunCount);
    }

    /** 필수 값만 유효한 Command. 나머지 optional은 null. */
    private static HrPersonalizationCommand minimal(
            String schemaVersion,
            String modelVersion,
            int supportRunCount,
            String summaryUJson,
            String history8Json,
            String p4Json,
            BigDecimal hr0) {
        return command(
                schemaVersion,
                modelVersion,
                supportRunCount,
                summaryUJson,
                history8Json,
                p4Json,
                hr0,
                null,
                null,
                null,
                null);
    }

    private static HrPersonalizationCommand withJson(
            String summaryUJson, String history8Json, String p4Json) {
        return minimal(
                "v1", "ode-1", 5, summaryUJson, history8Json, p4Json, new BigDecimal("85.00"));
    }

    private static HrPersonalizationCommand withHr0(BigDecimal hr0) {
        return minimal("v1", "ode-1", 5, SUMMARY, HISTORY8, P4, hr0);
    }

    private static HrPersonalizationCommand withOptionalHr(
            BigDecimal ref, BigDecimal danger, BigDecimal sustain) {
        return command(
                "v1",
                "ode-1",
                5,
                SUMMARY,
                HISTORY8,
                P4,
                new BigDecimal("85.00"),
                ref,
                danger,
                sustain,
                null);
    }

    private void assertRejected(HrPersonalizationCommand command) {
        assertThatThrownBy(() -> service().saveNextVersion(USER_ID, command))
                .isInstanceOf(IllegalArgumentException.class);
        verifyNoInteractions(repository);
    }

    @Test
    void saveNextVersion_validCommand_locksThenInsertsAndReturnsVersion() {
        HrPersonalizationCommand command = validCommand();
        when(repository.insertNextVersion(USER_ID, command)).thenReturn(3);

        int version = service().saveNextVersion(USER_ID, command);

        assertThat(version).isEqualTo(3);
        InOrder order = inOrder(repository);
        order.verify(repository).lockPersonalization(USER_ID);
        order.verify(repository).insertNextVersion(USER_ID, command);
        verifyNoMoreInteractions(repository);
    }

    @Test
    void saveNextVersion_optionalFieldsNull_isAccepted() {
        HrPersonalizationCommand command =
                minimal("v1", "ode-1", 0, "{}", "[]", "[0,0,0,0]", new BigDecimal("35"));
        when(repository.insertNextVersion(USER_ID, command)).thenReturn(1);

        assertThat(service().saveNextVersion(USER_ID, command)).isEqualTo(1);
        verify(repository).lockPersonalization(USER_ID);
    }

    @Test
    void saveNextVersion_boundaryValues_areAccepted() {
        HrPersonalizationCommand command =
                command(
                        "v1",
                        "ode-1",
                        1,
                        SUMMARY,
                        HISTORY8,
                        P4,
                        new BigDecimal("220"),
                        new BigDecimal("35"),
                        new BigDecimal("220"),
                        new BigDecimal("35.00"),
                        20);
        when(repository.insertNextVersion(USER_ID, command)).thenReturn(2);

        assertThat(service().saveNextVersion(USER_ID, command)).isEqualTo(2);
    }

    @Test
    void saveNextVersion_nullCommand_throwsWithoutRepositoryCall() {
        assertRejected(null);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "\t"})
    void saveNextVersion_blankSchemaVersion_throws(String value) {
        assertRejected(
                minimal(value, "ode-1", 5, SUMMARY, HISTORY8, P4, new BigDecimal("85.00")));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" "})
    void saveNextVersion_blankModelVersion_throws(String value) {
        assertRejected(minimal("v1", value, 5, SUMMARY, HISTORY8, P4, new BigDecimal("85.00")));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" "})
    void saveNextVersion_blankSummaryUJson_throws(String value) {
        assertRejected(withJson(value, HISTORY8, P4));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" "})
    void saveNextVersion_blankHistory8Json_throws(String value) {
        assertRejected(withJson(SUMMARY, value, P4));
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" "})
    void saveNextVersion_blankP4Json_throws(String value) {
        assertRejected(withJson(SUMMARY, HISTORY8, value));
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "\"text\"", "null", "true", "[1]", "[]"})
    void saveNextVersion_summaryNotJsonObject_throws(String value) {
        assertRejected(withJson(value, HISTORY8, P4));
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "\"text\"", "null", "{}", "{\"history8\":[1]}"})
    void saveNextVersion_history8NotJsonArray_throws(String value) {
        assertRejected(withJson(SUMMARY, value, P4));
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "{}", "{\"p4\":[1,2,3,4]}", "null"})
    void saveNextVersion_p4NotJsonArray_throws(String value) {
        assertRejected(withJson(SUMMARY, HISTORY8, value));
    }

    @ParameterizedTest
    @ValueSource(strings = {"[]", "[1,2,3]", "[1,2,3,4,5]"})
    void saveNextVersion_p4WrongLength_throws(String value) {
        assertRejected(withJson(SUMMARY, HISTORY8, value));
    }

    @ParameterizedTest
    @ValueSource(strings = {"{not json", "{\"u\":", "}", "[1,2"})
    void saveNextVersion_malformedJson_throwsWithoutLeakingBodyAndRepositoryCall(String value) {
        for (HrPersonalizationCommand command :
                new HrPersonalizationCommand[] {
                    withJson(value, HISTORY8, P4),
                    withJson(SUMMARY, value, P4),
                    withJson(SUMMARY, HISTORY8, value)
                }) {
            assertThatThrownBy(() -> service().saveNextVersion(USER_ID, command))
                    .isInstanceOf(IllegalArgumentException.class)
                    .hasMessageContaining("must be valid JSON")
                    .hasMessageNotContaining(value);
        }
        verifyNoInteractions(repository);
    }

    @Test
    void saveNextVersion_shapeMismatch_messageDoesNotContainJsonBody() {
        String secretLike = "{\"secret-marker\":123}";

        assertThatThrownBy(() -> service().saveNextVersion(USER_ID, withJson(SUMMARY, secretLike, P4)))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageNotContaining("secret-marker");
        verifyNoInteractions(repository);
    }

    @Test
    void saveNextVersion_negativeSupportRunCount_throws() {
        assertRejected(
                minimal("v1", "ode-1", -1, SUMMARY, HISTORY8, P4, new BigDecimal("85.00")));
    }

    @Test
    void saveNextVersion_hr0Null_throws() {
        assertRejected(withHr0(null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"34.99", "0", "-1", "220.01", "300"})
    void saveNextVersion_hr0OutOfRange_throws(String value) {
        assertRejected(withHr0(new BigDecimal(value)));
    }

    @ParameterizedTest
    @ValueSource(strings = {"34.99", "220.01"})
    void saveNextVersion_hrRefOutOfRange_throws(String value) {
        assertRejected(withOptionalHr(new BigDecimal(value), null, null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"34.99", "220.01"})
    void saveNextVersion_hrDangerOutOfRange_throws(String value) {
        assertRejected(withOptionalHr(null, new BigDecimal(value), null));
    }

    @ParameterizedTest
    @ValueSource(strings = {"34.99", "220.01"})
    void saveNextVersion_hrSustainOutOfRange_throws(String value) {
        assertRejected(withOptionalHr(null, null, new BigDecimal(value)));
    }

    @ParameterizedTest
    @ValueSource(ints = {21, 100, -1})
    void saveNextVersion_thresholdRunCountOutOfRange_throws(int value) {
        assertRejected(
                command(
                        "v1",
                        "ode-1",
                        5,
                        SUMMARY,
                        HISTORY8,
                        P4,
                        new BigDecimal("85.00"),
                        null,
                        null,
                        null,
                        value));
    }

    @Test
    void findLatest_delegatesToRepository() {
        HrPersonalizationSnapshot snapshot =
                new HrPersonalizationSnapshot(
                        USER_ID,
                        2,
                        "v1",
                        "ode-1",
                        5,
                        SUMMARY,
                        HISTORY8,
                        P4,
                        new BigDecimal("85.00"),
                        null,
                        null,
                        null,
                        null,
                        OffsetDateTime.parse("2026-11-05T00:00:00+09:00"));
        when(repository.findLatest(USER_ID)).thenReturn(Optional.of(snapshot));

        assertThat(service().findLatest(USER_ID)).containsSame(snapshot);
        verify(repository).findLatest(USER_ID);
        verifyNoMoreInteractions(repository);
    }

    @Test
    void findLatest_noRow_returnsEmpty() {
        when(repository.findLatest(USER_ID)).thenReturn(Optional.empty());

        assertThat(service().findLatest(USER_ID)).isEmpty();
        verify(repository).findLatest(USER_ID);
    }
}
