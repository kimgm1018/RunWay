package com.runway.backend.domain.runningrecord.dto.response;

import java.math.BigDecimal;

/** H06 {@code heartRateZones[]} 항목. */
public record RunningRecordHeartRateZoneResponse(int zone, BigDecimal ratio) {}
