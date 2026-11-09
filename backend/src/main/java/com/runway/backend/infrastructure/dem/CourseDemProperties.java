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
    private long cacheBytes = IndexedGeoTiffReader.DEFAULT_CACHE_BYTES;

    /** 해제 블록 캐시 바이트. 기본 32 MiB, 허용 1 MiB~256 MiB이며 기동 시 DEM 해제 블록 하나 이상인지도 확인한다. */
    public long getCacheBytes() {
        return cacheBytes;
    }

    /** 범위 밖 값과 숫자가 아닌 값은 설정 이름을 담은 바인딩 오류로 기동을 실패시킨다(해시·형식 실패와 구분). */
    public void setCacheBytes(long cacheBytes) {
        if (cacheBytes < IndexedGeoTiffReader.MIN_CACHE_BYTES
                || cacheBytes > IndexedGeoTiffReader.MAX_CACHE_BYTES) {
            throw new IllegalArgumentException(
                    IndexedGeoTiffReader.CACHE_BYTES_PROPERTY
                            + " must be "
                            + IndexedGeoTiffReader.MIN_CACHE_BYTES
                            + ".."
                            + IndexedGeoTiffReader.MAX_CACHE_BYTES
                            + " bytes (1 MiB..256 MiB): "
                            + cacheBytes);
        }
        this.cacheBytes = cacheBytes;
    }

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
