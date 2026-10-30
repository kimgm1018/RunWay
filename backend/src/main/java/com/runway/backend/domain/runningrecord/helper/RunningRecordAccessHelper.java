package com.runway.backend.domain.runningrecord.helper;

import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SessionRow;
import com.runway.backend.global.exception.ApiException;
import lombok.RequiredArgsConstructor;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;

/**
 * H02/H03 공통 소유권 검사. 세션을 로드한 뒤 삭제·부재는 {@code RECORD_NOT_FOUND}, 타인 소유는 {@code
 * NOT_OWNER}로 거절한다.
 */
@Component
@RequiredArgsConstructor
public class RunningRecordAccessHelper {

    private final RunningRecordJdbcRepository runningRecordJdbcRepository;

    public SessionRow requireOwnedSession(long requesterUserId, long sessionId) {
        SessionRow session =
                runningRecordJdbcRepository
                        .findSessionById(sessionId)
                        .orElseThrow(RunningRecordAccessHelper::recordNotFound);

        if (session.deletedAt() != null) {
            throw recordNotFound();
        }
        if (session.userId() != requesterUserId) {
            throw new ApiException(
                    HttpStatus.FORBIDDEN, "NOT_OWNER", "본인 러닝 기록만 조회할 수 있습니다.");
        }
        return session;
    }

    private static ApiException recordNotFound() {
        return new ApiException(
                HttpStatus.NOT_FOUND, "RECORD_NOT_FOUND", "러닝 기록을 찾을 수 없습니다.");
    }
}
