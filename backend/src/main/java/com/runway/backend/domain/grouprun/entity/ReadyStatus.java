package com.runway.backend.domain.grouprun.entity;

public enum ReadyStatus {
    READY,
    WAITING;

    public static ReadyStatus fromReady(boolean ready) {
        return ready ? READY : WAITING;
    }
}
