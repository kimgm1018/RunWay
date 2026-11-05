package com.runway.backend.domain.session.stream;

/**
 * 세션 상태를 바꾼 트랜잭션이 발행하는 S10 전달 요청. 커밋 뒤에만 구독자에게 최신 스냅샷을 보낸다(롤백된 변경은 보내지 않는다). 내용은 세션 ID와 이벤트
 * 이름뿐이며 스냅샷은 전송 시점에 다시 읽는다.
 *
 * @param commandId SERVER_END의 END 명령 번호. 그 밖의 이벤트는 null
 */
public record SessionStreamChanged(long sessionId, SessionStreamEventType type, Long commandId) {

    public static SessionStreamChanged state(long sessionId) {
        return new SessionStreamChanged(sessionId, SessionStreamEventType.SESSION_STATE, null);
    }

    public static SessionStreamChanged coaching(long sessionId) {
        return new SessionStreamChanged(sessionId, SessionStreamEventType.COACHING_GUIDE, null);
    }

    public static SessionStreamChanged serverEnd(long sessionId, long commandId) {
        return new SessionStreamChanged(sessionId, SessionStreamEventType.SERVER_END, commandId);
    }

    public static SessionStreamChanged analysis(long sessionId) {
        return new SessionStreamChanged(sessionId, SessionStreamEventType.ANALYSIS_STATUS, null);
    }
}
