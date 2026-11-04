package com.runway.backend.domain.device.dto.response;

/** W04 응답이자 W05 항목. granted는 현재 유효 동의 여부다. */
public record ConsentResponse(String consentType, boolean granted) {
    @Override
    public String toString() {
        return "ConsentResponse[REDACTED]";
    }
}
