package com.runway.backend.infrastructure.dem;

import org.springframework.boot.context.properties.ConfigurationProperties;

/**
 * 경사 계산용 DEM clip(GeoTIFF) 위치와 신뢰하는 manifest의 SHA-256. 둘 중 하나라도 비면 경사 계산은 준비되지 않음이다.
 * 파일 배포·manifest는 인프라 후속 업무다(ADR-0019).
 */
@ConfigurationProperties(prefix = "runway.course.dem")
public class CourseDemProperties {

    private String path = "";
    private String sha256 = "";

    public String getPath() {
        return path;
    }

    public void setPath(String path) {
        this.path = path;
    }

    public String getSha256() {
        return sha256;
    }

    public void setSha256(String sha256) {
        this.sha256 = sha256;
    }
}
