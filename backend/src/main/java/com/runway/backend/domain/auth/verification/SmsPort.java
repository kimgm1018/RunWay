package com.runway.backend.domain.auth.verification;

/**
 * 휴대전화 인증 문자 발송(users.md U28, S15P31E105-560). 구현은 {@code infrastructure.sms}에 둔다.
 *
 * <p>전화번호·문구·공급자 응답을 로그와 예외에 남기지 않는다. 공급자에 중복 방지 키가 없으므로 한 번만 시도하고 자동으로 다시
 * 보내지 않는다.
 */
public interface SmsPort {
    /** 설정상 발송할 수 있는지. false면 호출하지 않고 503 SMS_UNAVAILABLE로 처리한다. */
    boolean enabled();

    /** 문자 1건을 한 번만 보낸다. 꺼져 있으면 보내지 않고 {@link Result#REJECTED}다. */
    Result send(String to, String text);

    enum Result {
        /** 공급자가 접수했다. 통신사 단계 실패는 확인하지 않는다. */
        ACCEPTED,
        /** 공급자가 명확히 거절했다. 문자는 가지 않았다. */
        REJECTED,
        /** 시간 초과·응답 유실·서버 오류로 결과를 모른다. 문자가 갔을 수 있다. */
        UNKNOWN
    }
}
