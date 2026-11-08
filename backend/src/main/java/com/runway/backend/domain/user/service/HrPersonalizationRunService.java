package com.runway.backend.domain.user.service;

import com.runway.backend.domain.course.elevation.CourseElevationSource;
import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.domain.device.repository.ConsentJdbcRepository;
import com.runway.backend.domain.user.personalization.Ai06PersonalizeRequest;
import com.runway.backend.domain.user.personalization.Ai06Session;
import com.runway.backend.domain.user.personalization.HrPersonalizePort;
import com.runway.backend.domain.user.personalization.HrPersonalizeResult;
import com.runway.backend.domain.user.personalization.W07Session;
import com.runway.backend.domain.user.personalization.W07ToAi06Converter;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository;
import com.runway.backend.domain.user.repository.W07PersonalizationSessionRepository.SessionHeader;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import lombok.RequiredArgsConstructor;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 심박 개인화(AI06) 한 회원분 오케스트레이션(S15P31E105-410).
 *
 * <ol>
 *   <li>건강정보 동의 확인(미동의·비활성 회원은 스킵)
 *   <li>최근 COMPLETED 러닝을 읽어 W07 → AI06 변환(성공 최대 {@value #MAX_SESSIONS}개)
 *   <li>변환된 세션이 없으면 AI를 호출하지 않는다
 *   <li>호출 직전 동의를 한 번 더 확인하고 AI06 호출
 *   <li>2xx면 {@link HrPersonalizationService#saveNextVersion}으로 저장(짧은 트랜잭션)
 * </ol>
 *
 * <p>이 클래스는 트랜잭션을 열지 않는다. DB 읽기는 단건 자동 커밋이고 AI HTTP 호출은 어떤 트랜잭션·DB 연결도 잡지 않은 채 수행한다. 요청·응답 본문과 심박 값, DB
 * 예외 메시지는 로그에 남기지 않는다(예외는 클래스 이름만).
 */
@Service
@RequiredArgsConstructor
public class HrPersonalizationRunService {

    /** AI06 {@code sessions[]} 상한. */
    static final int MAX_SESSIONS = 50;

    /** 변환 실패(NO_START_HR·TOO_SHORT 등)가 있어도 {@link #MAX_SESSIONS}개를 채우려고 읽는 후보 수. */
    static final int CANDIDATE_LIMIT = 100;

    private static final Logger log = LoggerFactory.getLogger(HrPersonalizationRunService.class);

    /** 한 번의 실행 결과. */
    public enum Outcome {
        /** 회원이 없거나 동의하지 않았거나 활성 회원이 아니다. */
        SKIPPED_NO_CONSENT,
        /** 변환에 성공한 러닝이 없어 AI를 호출하지 않았다. */
        SKIPPED_NO_SESSIONS,
        /** AI06이 422 INPUT_INSUFFICIENT를 돌려 저장하지 않았다. */
        SKIPPED_INPUT_INSUFFICIENT,
        /** AI06 성공 응답을 저장했다. */
        SAVED,
        /** AI06 호출이 실패해 저장하지 않았다. */
        FAILED_AI,
        /** 저장이 실패했다. */
        FAILED_SAVE
    }

    private final W07PersonalizationSessionRepository sessionRepository;
    private final ConsentJdbcRepository consentRepository;
    private final W07ToAi06Converter converter;
    private final CourseElevationSource courseElevation;
    private final HrPersonalizePort aiPort;
    private final HrPersonalizationService personalizationService;

    /** 세션의 소유 회원. 디스패처가 회원 단위 직렬화에 쓴다. */
    public Optional<Long> findUserId(long sessionId) {
        return sessionRepository.findUserIdBySessionId(sessionId);
    }

    /** 회원 한 명의 개인화를 계산·저장한다. DB·저장 예외는 호출자(디스패처)가 처리한다. */
    public Outcome runForUser(long userId) {
        if (!hasConsent(userId)) {
            log.info("HR personalization skipped userId={} reason=NO_CONSENT", userId);
            return Outcome.SKIPPED_NO_CONSENT;
        }

        List<Ai06Session> sessions = convertRecentSessions(userId);
        if (sessions.isEmpty()) {
            log.info("HR personalization skipped userId={} reason=NO_CONVERTIBLE_SESSIONS", userId);
            return Outcome.SKIPPED_NO_SESSIONS;
        }

        // 변환에 시간이 걸릴 수 있으므로 호출 직전에 동의를 다시 확인한다.
        if (!hasConsent(userId)) {
            log.info("HR personalization skipped userId={} reason=NO_CONSENT_BEFORE_CALL", userId);
            return Outcome.SKIPPED_NO_CONSENT;
        }

        HrPersonalizeResult result =
                aiPort.personalize(new Ai06PersonalizeRequest(userId, sessions));
        return switch (result) {
            case HrPersonalizeResult.Success success -> save(userId, success);
            case HrPersonalizeResult.InputInsufficient ignored -> {
                log.info("HR personalization not saved userId={} reason=INPUT_INSUFFICIENT", userId);
                yield Outcome.SKIPPED_INPUT_INSUFFICIENT;
            }
            case HrPersonalizeResult.Failure failure -> {
                log.warn(
                        "HR personalization AI call failed userId={} reason={} status={}",
                        userId,
                        failure.reason(),
                        failure.httpStatus());
                yield Outcome.FAILED_AI;
            }
        };
    }

    private boolean hasConsent(long userId) {
        return consentRepository.findActiveUserConsent(userId).orElse(false);
    }

    private List<Ai06Session> convertRecentSessions(long userId) {
        List<SessionHeader> candidates =
                sessionRepository.findCompletedSessions(userId, CANDIDATE_LIMIT);
        ElevationSource elevation = courseElevation.source().orElse(null);
        List<Ai06Session> converted = new ArrayList<>();
        for (SessionHeader header : candidates) {
            if (converted.size() >= MAX_SESSIONS) {
                break;
            }
            // 러닝 하나씩 읽어 변환한다. 50 × 1441행 원본을 한꺼번에 메모리에 올리지 않는다.
            W07Session session =
                    new W07Session(
                            header.sessionId(),
                            header.startedAt(),
                            sessionRepository.findSamples(header.sessionId()),
                            sessionRepository.findRoutePoints(header.sessionId()));
            converter.convert(session, elevation).ifPresent(converted::add);
        }
        return converted;
    }

    private Outcome save(long userId, HrPersonalizeResult.Success success) {
        try {
            personalizationService.saveNextVersion(userId, success.command());
            return Outcome.SAVED;
        } catch (RuntimeException ex) {
            // DB 예외 메시지에 JSON·심박 값이 들어 있을 수 있어 클래스 이름만 남긴다.
            log.error(
                    "HR personalization save failed userId={} {}",
                    userId,
                    ex.getClass().getSimpleName());
            return Outcome.FAILED_SAVE;
        }
    }
}
