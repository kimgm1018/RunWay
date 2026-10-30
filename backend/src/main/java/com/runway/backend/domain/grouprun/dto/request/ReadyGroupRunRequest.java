package com.runway.backend.domain.grouprun.dto.request;

public record ReadyGroupRunRequest(Boolean ready) {

    public boolean resolvedReady() {
        return ready == null || ready;
    }
}
