package com.runway.backend.domain.device.service;

import com.runway.backend.domain.device.dto.request.ConsentChangeRequest;
import com.runway.backend.domain.device.dto.response.ConsentResponse;
import com.runway.backend.domain.device.dto.response.ConsentStatusResponse;
import com.runway.backend.domain.device.repository.ConsentJdbcRepository;
import com.runway.backend.domain.session.repository.SessionReferenceRepository;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import lombok.RequiredArgsConstructor;

import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Isolation;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.List;

/**
 * W04 건강정보 동의·철회와 W05 동의 상태 조회(devices-health.md W04·W05).
 *
 * <p>철회 잠금 순서: 회원 세션 생성 advisory lock → 회원 행 UPDATE(트랜잭션의 첫 쓰기) → 본인 진행 가능 세션(READY·RUNNING·
 * PAUSED) 행 FOR SHARE.
 *
 * <ul>
 *   <li>W06·준비도 자동 평가는 회원 행 FOR SHARE로 동의를 읽으므로 회원 행 UPDATE와 서로 기다린다.
 *   <li>W07은 회원 행을 잠그지 않고 세션 행(FOR NO KEY UPDATE)을 잡은 뒤 동의를 읽는다. 철회는 세션 행 FOR SHARE에서 진행 중 W07의 커밋을
 *       기다리고, 그 뒤 W07은 철회 커밋을 기다렸다가 철회 값을 읽는다. W07은 진행 가능 세션에만 새 batch를 받고 종료 상태는 되돌아가지 않으므로 종료된
 *       세션은 잠그지 않는다(과거 기록의 댓글·게시물 잠금과 간섭하지 않음).
 *   <li>세션 생성 advisory lock은 철회 도중 새로 만들어진 세션이 세션 행 잠금에서 빠지지 않게 한다. 세션 생성은 회원 행을 잠그지 않고, 세션 행만 잡는
 *       경로(W07·종료·인계)는 advisory lock과 회원 행을 기다리지 않으므로 순환 대기가 없다.
 * </ul>
 *
 * <p><b>교착 방지 규칙:</b> 세션 행이나 세션 생성 advisory lock을 잡은 트랜잭션은 그 뒤에 회원 행을 잠그면(FOR SHARE 포함) 안 된다. 철회가
 * 회원 행을 쥔 채 세션을 기다리므로 교착(40P01)이 된다. 세션 잠금 경로에서 동의를 확인할 때는 W07처럼 잠그지 않고 읽는다.
 *
 * <p>철회는 회원 행을 쥔 채 진행 중 W07의 커밋을 기다리므로, 그동안 같은 회원의 로그인·프로필 저장(회원 행 FOR UPDATE)도 기다린다(최대 2초 후 503).
 * 철회가 드물고 W07 트랜잭션이 짧아 수용했다(2026-11-02 사용자 결정).
 *
 * <p>동의(GRANT)는 순서 보장이 필요 없어 회원 행만 바꾼다. 철회는 기존 기록 삭제나 진행 중 운동 종료가 아니다.
 */
@Service
@RequiredArgsConstructor
public class ConsentService {

    static final String HEALTH_DATA = "HEALTH_DATA";

    /** 가입(U15)에서 true가 강제되는 필수 동의. 저장하지 않으며 활성 회원이면 동의 상태다. */
    private static final List<String> REQUIRED =
            List.of("TERMS_OF_SERVICE", "PERSONAL_INFO", "LOCATION_DATA");

    private final ConsentJdbcRepository repository;
    private final SessionReferenceRepository sessionReferenceRepository;

    /**
     * 형식 검증을 마친 요청이 바꿀 수 있는 유형(HEALTH_DATA)인지 확인하고 요청 값을 돌려준다. 필수 3종·알 수 없는 값은 422다. 트랜잭션 전에 호출해
     * 잘못된 요청이 잠금을 잡지 않게 한다.
     */
    public static boolean requireHealthConsent(ConsentChangeRequest request) {
        if (!HEALTH_DATA.equals(request.consentType())) {
            throw new ApiException(ErrorCode.INVALID_CONSENT_CONSENT_CHANGE);
        }
        return request.granted();
    }

    @Transactional(isolation = Isolation.READ_COMMITTED)
    public ConsentResponse change(long userId, boolean granted) {
        repository.limitLockWait();
        if (!granted) {
            sessionReferenceRepository.lockSessionCreation(userId);
        }
        if (repository.updateHealthConsent(userId, granted)) {
            if (!granted) {
                repository.lockOwnActiveSessions(userId);
            }
        } else {
            // 같은 값 재요청은 멱등 200. 비활성 회원도 갱신 0행이므로 여기서 구분한다.
            repository
                    .findActiveUserConsent(userId)
                    .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        }
        return new ConsentResponse(HEALTH_DATA, granted);
    }

    @Transactional(readOnly = true)
    public ConsentStatusResponse status(long userId) {
        boolean health =
                repository
                        .findActiveUserConsent(userId)
                        .orElseThrow(() -> new ApiException(ErrorCode.UNAUTHORIZED));
        List<ConsentResponse> items = new ArrayList<>();
        REQUIRED.forEach(type -> items.add(new ConsentResponse(type, true)));
        items.add(new ConsentResponse(HEALTH_DATA, health));
        return new ConsentStatusResponse(List.copyOf(items));
    }
}
