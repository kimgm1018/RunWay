package com.runway.backend.domain.session.stream;

/** S10 SSE 이벤트 이름. 모든 이벤트의 data는 S02 전체 세션 상태(스냅샷)다. */
public enum SessionStreamEventType {
    /** 상태·BPM·명령 결과 등 현재 상태. 연결 직후와 heartbeat에도 사용한다. */
    SESSION_STATE,
    /** 서버가 새 코칭 명령을 승인했다. data.coaching에 현재 유효 추천이 있다. */
    COACHING_GUIDE,
    /** 그룹 종료로 서버가 개인 END 명령을 승인했다. data.commandId가 그 명령 번호다. */
    SERVER_END,
    /** 종료 후 분석 상태가 바뀌었다. */
    ANALYSIS_STATUS
}
