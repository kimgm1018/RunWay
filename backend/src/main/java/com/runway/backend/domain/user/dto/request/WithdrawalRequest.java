package com.runway.backend.domain.user.dto.request;

public record WithdrawalRequest(Object password, Object agreed) {
    @Override public String toString() { return "WithdrawalRequest[REDACTED]"; }
}
