package com.runway.backend.infrastructure.dem;

import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import mil.nga.tiff.FieldTagType;
import mil.nga.tiff.FileDirectory;

import java.io.IOException;
import java.nio.file.Path;
import java.util.List;

/**
 * 해시가 검증된 단일 EPSG:4326 GeoTIFF. 파일을 한 번 열고 필요한 블록만 제한된 캐시에 보관한다. 파일 준비·manifest 생성·Spring
 * 기동 연결은 배포/저장 연동 업무에서 이 팩토리를 사용한다.
 */
public final class GeoTiffElevationSource implements ElevationSource, AutoCloseable {
    private final int width;
    private final int height;
    private final IndexedGeoTiffReader reader;
    private final double nodata;
    private final double firstLongitude;
    private final double firstLatitude;
    private final double pixelWidth;
    private final double pixelHeight;

    private GeoTiffElevationSource(IndexedGeoTiffReader reader) {
        this.reader = reader;
        FileDirectory directory = reader.directory();
        if (directory.get(FieldTagType.ModelTransformation) != null
                || directory.getSamplesPerPixel() != 1
                || (directory.getIntegerEntryValue(FieldTagType.Orientation) != null
                        && directory.getIntegerEntryValue(FieldTagType.Orientation) != 1)) {
            throw unavailable();
        }
        List<Integer> keys = directory.getIntegerListEntryValue(FieldTagType.GeoKeyDirectory);
        if (keys == null
                || keys.size() < 4
                || keys.get(0) != 1
                || keys.size() != 4 + 4 * keys.get(3)
                || key(keys, 1024, -1) != 2
                || key(keys, 2048, -1) != 4326
                || key(keys, 2054, 9102) != 9102
                || key(keys, 4099, 9001) != 9001) {
            throw unavailable();
        }
        int rasterType = key(keys, 1025, 1);
        if (rasterType != 1 && rasterType != 2) throw unavailable();
        List<Double> scale = directory.getModelPixelScale();
        List<Double> tiepoint = directory.getModelTiepoint();
        if (scale == null
                || scale.size() != 3
                || tiepoint == null
                || tiepoint.size() != 6
                || scale.stream().anyMatch(v -> !Double.isFinite(v))
                || tiepoint.stream().anyMatch(v -> !Double.isFinite(v))
                || scale.get(0) <= 0
                || scale.get(1) <= 0) throw unavailable();
        pixelWidth = scale.get(0);
        pixelHeight = scale.get(1);
        // Area: tiepoint denotes the corner. Point: tiepoint denotes the sample centre.
        double offset = rasterType == 1 ? .5 : 0;
        firstLongitude = tiepoint.get(3) + (offset - tiepoint.get(0)) * pixelWidth;
        firstLatitude = tiepoint.get(4) - (offset - tiepoint.get(1)) * pixelHeight;
        width = Math.toIntExact(directory.getImageWidth().longValue());
        height = Math.toIntExact(directory.getImageHeight().longValue());
        if (width < 2 || height < 2) throw unavailable();
        nodata = noData(directory);
    }

    /** expectedSha256는 신뢰하는 manifest에서 얻는다. */
    public static GeoTiffElevationSource load(Path path, String expectedSha256) {
        return load(path, expectedSha256, IndexedGeoTiffReader.DEFAULT_CACHE_BYTES);
    }

    /**
     * @param cacheBytes 해제 블록 캐시 바이트. 파일의 해제 블록 하나보다 작거나 범위 밖이면 설정 오류로 보고 {@code
     *     IndexedGeoTiffReader.CacheBudgetException}을 그대로 던진다(기동 실패). 파일·해시·형식 문제는 {@link ApiException}이다.
     */
    public static GeoTiffElevationSource load(Path path, String expectedSha256, long cacheBytes) {
        IndexedGeoTiffReader reader = null;
        try {
            reader = IndexedGeoTiffReader.open(path, expectedSha256, cacheBytes);
            return new GeoTiffElevationSource(reader);
        } catch (IndexedGeoTiffReader.CacheBudgetException ex) {
            throw ex;
        } catch (IOException | RuntimeException ex) {
            if (reader != null) {
                try {
                    reader.close();
                } catch (IOException ignored) {
                    // 파일명·내용·좌표를 오류 본문이나 로그로 노출하지 않는다.
                }
            }
            throw unavailable();
        }
    }

    @Override
    public void close() {
        try {
            reader.close();
        } catch (IOException ex) {
            throw unavailable();
        }
    }

    /** 블록 단위 표본 읽기. I/O·TIFF 해제·형식 실패는 {@link IOException}으로만 알린다. */
    @FunctionalInterface
    interface Sampler {
        double sample(int x, int y) throws IOException;
    }

    private double sample(int x, int y) {
        return sample(reader, x, y, nodata);
    }

    /**
     * 데이터 읽기 실패(I/O·TIFF 해제·형식, 닫힌 소스)만 {@code SERVICE_UNAVAILABLE}(C01 {@code GRADE_UNAVAILABLE})로 바꾼다.
     * 그 밖의 RuntimeException은 계산 불변식 결함이므로 감추지 않고 그대로 던진다(500 경로).
     */
    static double sample(Sampler sampler, int x, int y, double nodata) {
        double value;
        try {
            value = sampler.sample(x, y);
        } catch (IOException ex) {
            throw unavailable();
        }
        return !Double.isFinite(value) || value == nodata ? Double.NaN : value;
    }

    @Override
    public double elevationAt(double longitude, double latitude) {
        double col = (longitude - firstLongitude) / pixelWidth;
        double row = (firstLatitude - latitude) / pixelHeight;
        if (!Double.isFinite(col)
                || !Double.isFinite(row)
                || col < 0
                || row < 0
                || col >= width - 1
                || row >= height - 1) {
            return Double.NaN;
        }
        int x = (int) Math.floor(col);
        int y = (int) Math.floor(row);
        double dx = col - x;
        double dy = row - y;
        // Route Dem.sample와 같이 stencil의 NoData는 결측으로 전파한다.
        return sample(x, y) * (1 - dx) * (1 - dy)
                + sample(x + 1, y) * dx * (1 - dy)
                + sample(x, y + 1) * (1 - dx) * dy
                + sample(x + 1, y + 1) * dx * dy;
    }

    private static int key(List<Integer> keys, int id, int defaultValue) {
        for (int i = 4; i < keys.size(); i += 4) {
            if (keys.get(i) == id) {
                if (keys.get(i + 1) != 0 || keys.get(i + 2) != 1) throw unavailable();
                return keys.get(i + 3);
            }
        }
        return defaultValue;
    }

    private static double noData(FileDirectory directory) {
        var entry = directory.get(FieldTagType.GDAL_NODATA);
        if (entry == null) return Double.NaN;
        // NGA ASCII values are individual characters; getStringEntryValue returns only the first.
        Object values = entry.getValues();
        String text =
                values instanceof List<?> chars
                        ? chars.stream()
                                .map(Object::toString)
                                .collect(java.util.stream.Collectors.joining())
                        : values.toString();
        text = text.replace("\0", "").trim();
        return text.equalsIgnoreCase("nan") ? Double.NaN : Double.parseDouble(text);
    }

    private static ApiException unavailable() {
        return new ApiException(ErrorCode.SERVICE_UNAVAILABLE);
    }
}
