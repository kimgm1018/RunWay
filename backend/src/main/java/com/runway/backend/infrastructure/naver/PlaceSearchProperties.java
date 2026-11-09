package com.runway.backend.infrastructure.naver;

import lombok.Getter;
import lombok.Setter;
import org.springframework.boot.context.properties.ConfigurationProperties;

/** Secret을 포함하므로 toString을 생성하지 않는다. */
@Getter
@Setter
@ConfigurationProperties(prefix = "runway.places")
public class PlaceSearchProperties {
    private boolean enabled;
    private String searchClientId = "";
    private String searchClientSecret = "";
    private String mapsKeyId = "";
    private String mapsKey = "";

    public void validate() {
        if (!enabled) return;
        require(searchClientId, "BACKEND_NAVER_SEARCH_CLIENT_ID");
        require(searchClientSecret, "BACKEND_NAVER_SEARCH_CLIENT_SECRET");
        require(mapsKeyId, "BACKEND_NAVER_MAPS_KEY_ID");
        require(mapsKey, "BACKEND_NAVER_MAPS_KEY");
    }

    private static void require(String value, String name) {
        if (value == null || value.isBlank() || value.contains("\r") || value.contains("\n")) {
            throw new IllegalStateException(name + " 설정이 필요합니다.");
        }
    }
}
