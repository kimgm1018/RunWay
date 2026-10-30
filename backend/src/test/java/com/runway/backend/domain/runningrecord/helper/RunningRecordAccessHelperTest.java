package com.runway.backend.domain.runningrecord.helper;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.when;

import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SessionRow;
import com.runway.backend.global.exception.ApiException;
import java.time.Instant;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.http.HttpStatus;

@ExtendWith(MockitoExtension.class)
class RunningRecordAccessHelperTest {

    @Mock private RunningRecordJdbcRepository runningRecordJdbcRepository;

    @InjectMocks private RunningRecordAccessHelper helper;

    @Test
    void 본인_미삭제_세션이면_반환한다() {
        SessionRow row = session(10L, 1L, null);
        when(runningRecordJdbcRepository.findSessionById(10L)).thenReturn(Optional.of(row));

        assertThat(helper.requireOwnedSession(1L, 10L)).isSameAs(row);
    }

    @Test
    void 없으면_RECORD_NOT_FOUND() {
        when(runningRecordJdbcRepository.findSessionById(99L)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> helper.requireOwnedSession(1L, 99L))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> {
                            ApiException api = (ApiException) ex;
                            assertThat(api.status()).isEqualTo(HttpStatus.NOT_FOUND);
                            assertThat(api.code()).isEqualTo("RECORD_NOT_FOUND");
                        });
    }

    @Test
    void 삭제되면_RECORD_NOT_FOUND() {
        SessionRow row = session(10L, 1L, Instant.parse("2026-01-01T00:00:00Z"));
        when(runningRecordJdbcRepository.findSessionById(10L)).thenReturn(Optional.of(row));

        assertThatThrownBy(() -> helper.requireOwnedSession(1L, 10L))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> assertThat(((ApiException) ex).code()).isEqualTo("RECORD_NOT_FOUND"));
    }

    @Test
    void 타인이면_NOT_OWNER() {
        SessionRow row = session(10L, 2L, null);
        when(runningRecordJdbcRepository.findSessionById(10L)).thenReturn(Optional.of(row));

        assertThatThrownBy(() -> helper.requireOwnedSession(1L, 10L))
                .isInstanceOf(ApiException.class)
                .satisfies(
                        ex -> {
                            ApiException api = (ApiException) ex;
                            assertThat(api.status()).isEqualTo(HttpStatus.FORBIDDEN);
                            assertThat(api.code()).isEqualTo("NOT_OWNER");
                        });
    }

    private static SessionRow session(long id, long userId, Instant deletedAt) {
        return new SessionRow(
                id,
                userId,
                null,
                null,
                "COMPLETED",
                null,
                null,
                null,
                Instant.parse("2026-01-01T00:00:00Z"),
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                null,
                deletedAt);
    }
}
