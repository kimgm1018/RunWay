package com.runway.backend.domain.grouprun.pace;

/** Recompute the pre-run recommendation after a committed membership/goal change. */
public record GroupPaceChanged(long groupRunId) {}
