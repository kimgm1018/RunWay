package com.runway.backend.domain.runningrecord.helper;

import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SessionRow;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Component;

/** H02/H03 공통 소유권 검사. 세션을 로드한 뒤 삭제·부재는 {@code RECORD_NOT_FOUND}, 타인 소유는 {@code NOT_OWNER}로 거절한다. */
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
            throw new ApiException(ErrorCode.RECORD_NOT_OWNER);
        }
        return session;
    }

    private static ApiException recordNotFound() {
        return new ApiException(ErrorCode.RECORD_NOT_FOUND);
    }
}
