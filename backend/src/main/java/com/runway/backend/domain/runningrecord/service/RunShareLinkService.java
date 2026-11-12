package com.runway.backend.domain.runningrecord.service;

import com.runway.backend.domain.image.ImageService;
import com.runway.backend.domain.runningrecord.config.RunShareProperties;
import com.runway.backend.domain.runningrecord.dto.request.RunShareLinkRequest;
import com.runway.backend.domain.runningrecord.dto.response.RunShareLinkResponse;
import com.runway.backend.domain.runningrecord.dto.response.SharedRunResponse;
import com.runway.backend.domain.runningrecord.helper.RunningRecordAccessHelper;
import com.runway.backend.domain.runningrecord.repository.RunShareLinkJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunShareLinkJdbcRepository.SharedRunRow;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository;
import com.runway.backend.domain.runningrecord.repository.RunningRecordJdbcRepository.SessionRow;
import com.runway.backend.domain.session.service.SessionRouteService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import java.security.SecureRandom;
import java.util.Base64;
import java.util.List;
import java.util.regex.Pattern;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * H08 기록 공유 링크 발급과 H09 공유 기록 조회(S15P31E105-704). 토큰과 좌표는 로그에 남기지 않는다.
 *
 * <p>링크는 완료(COMPLETED) 기록마다 하나다. 다시 발급하면 같은 token을 돌려주고 제목만 바꾼다. H09는 토큰 형식 오류·없는 토큰·완료가
 * 아닌 기록·삭제된 기록·탈퇴(비활성) 발급자를 구분하지 않고 모두 {@code SHARED_RUN_NOT_FOUND}로 거절한다.
 */
@Service
@RequiredArgsConstructor
public class RunShareLinkService {

    /** 32바이트 난수의 base64url(패딩 없음)은 43자다. */
    private static final int TOKEN_BYTES = 32;

    private static final String COMPLETED = "COMPLETED";

    private static final Pattern TOKEN_PATTERN = Pattern.compile("[A-Za-z0-9_-]{43}");

    private static final Base64.Encoder TOKEN_ENCODER = Base64.getUrlEncoder().withoutPadding();

    private final SecureRandom secureRandom = new SecureRandom();

    private final RunningRecordJdbcRepository runningRecordJdbcRepository;
    private final RunningRecordAccessHelper runningRecordAccessHelper;
    private final RunShareLinkJdbcRepository runShareLinkJdbcRepository;
    private final SessionRouteService sessionRouteService;
    private final RunShareProperties runShareProperties;

    /**
     * H08. 본인 기록만 발급한다. 행이 없으면 만들고, 있으면 제목만 바꾼다. 동시에 처음 발급하면 session_id UNIQUE 충돌을 ON
     * CONFLICT가 받아(먼저 넣은 트랜잭션의 커밋을 기다린 뒤) 기존 행을 갱신하거나, 제목이 같으면 다음 문장에서 커밋된 행을 다시 읽는다.
     * 그래서 두 요청 모두 같은 token을 받는다(READ COMMITTED).
     */
    @Transactional
    public RunShareLinkResponse issue(long userId, long sessionId, RunShareLinkRequest request) {
        if (!runningRecordJdbcRepository.existsUserById(userId)) {
            throw new ApiException(ErrorCode.UNAUTHORIZED);
        }
        SessionRow session = runningRecordAccessHelper.requireOwnedSession(userId, sessionId);
        // H01과 같은 기록 기준(status=COMPLETED)만 공유한다. 진행 중·취소 세션은 기록이 아니므로 없는 기록으로 본다.
        if (!COMPLETED.equals(session.status())) {
            throw new ApiException(ErrorCode.RECORD_NOT_FOUND);
        }
        String token =
                runShareLinkJdbcRepository
                        .upsert(session.id(), userId, newToken(), request.title())
                        .or(() -> runShareLinkJdbcRepository.findTokenBySessionId(session.id()))
                        .orElseThrow(() -> new IllegalStateException("share link not stored"));
        return new RunShareLinkResponse(
                token, runShareProperties.normalizedBaseUrl() + "/r/" + token);
    }

    /** H09. 인증 없이 호출된다. 형식이 맞지 않는 토큰은 조회하지 않고 404다. */
    @Transactional(readOnly = true)
    public SharedRunResponse read(String token) {
        if (token == null || !TOKEN_PATTERN.matcher(token).matches()) {
            throw notFound();
        }
        SharedRunRow row =
                runShareLinkJdbcRepository
                        .findVisibleByToken(token)
                        .orElseThrow(RunShareLinkService::notFound);
        List<SharedRunResponse.Segment> segments =
                sessionRouteService
                        .displaySegments(row.sessionId(), row.startedAt(), row.endedAt())
                        .stream()
                        .map(s -> new SharedRunResponse.Segment(s.coordinates()))
                        .toList();
        return new SharedRunResponse(
                row.title(),
                row.startedAt(),
                row.totalDistance(),
                row.movingDuration(),
                row.averagePace(),
                row.averageCadence(),
                new SharedRunResponse.Runner(
                        row.nickname(), ImageService.publicUrlFromKey(row.profileImageKey())),
                segments);
    }

    private String newToken() {
        byte[] bytes = new byte[TOKEN_BYTES];
        secureRandom.nextBytes(bytes);
        return TOKEN_ENCODER.encodeToString(bytes);
    }

    private static ApiException notFound() {
        return new ApiException(ErrorCode.SHARED_RUN_NOT_FOUND);
    }
}
