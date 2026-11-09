package com.runway.backend.domain.crew.entity;

import java.util.Optional;

/** 크루 가입 방식. APPROVAL은 크루장 승인(M06) 후 멤버, INSTANT는 M04 신청 즉시 멤버(정원 안). */
public enum CrewJoinPolicy {
    APPROVAL,
    INSTANT;

    /** 요청 문자열을 대소문자 그대로 해석한다. 허용값이 아니면 비어 있다. */
    public static Optional<CrewJoinPolicy> parse(String value) {
        for (CrewJoinPolicy policy : values()) {
            if (policy.name().equals(value)) {
                return Optional.of(policy);
            }
        }
        return Optional.empty();
    }
}
