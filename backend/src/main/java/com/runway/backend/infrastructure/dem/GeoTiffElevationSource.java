package com.runway.backend.infrastructure.dem;

import com.runway.backend.domain.course.elevation.ElevationSource;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import mil.nga.tiff.FieldTagType;
import mil.nga.tiff.FileDirectory;
import mil.nga.tiff.TiffReader;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;

/**
 * 해시가 검증된 단일 EPSG:4326 GeoTIFF clip. 읽기는 한 번만 하고 TIFF reader 상태를 공유하지 않는다. 파일 준비·manifest 생성·Spring
 * 기동 연결은 배포/저장 연동 업무에서 이 팩토리를 사용한다.
 */
public final class GeoTiffElevationSource implements ElevationSource {
    private final int width;
    private final int height;
    private final double[] elevations;
    private final double firstLongitude;
    private final double firstLatitude;
    private final double pixelWidth;
    private final double pixelHeight;

    private GeoTiffElevationSource(FileDirectory directory) {
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
        int pixels = Math.multiplyExact(width, height);
        double nodata = noData(directory);
        var rasters = directory.readRasters();
        elevations = new double[pixels];
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                double value = rasters.getFirstPixelSample(col, row).doubleValue();
                elevations[row * width + col] =
                        !Double.isFinite(value) || value == nodata ? Double.NaN : value;
            }
        }
    }

    /** expectedSha256는 신뢰하는 manifest에서 얻는다. 사용자 입력 파일을 자동 선택하지 않는다. */
    public static GeoTiffElevationSource load(Path path, String expectedSha256) {
        try {
            if (expectedSha256 == null || !expectedSha256.matches("[a-fA-F0-9]{64}")) {
                throw unavailable();
            }
            // 동일 byte[]를 검증하고 파싱해 두 파일 읽기 사이의 교체 가능성을 없앤다.
            byte[] bytes = Files.readAllBytes(path);
            String actual =
                    HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(bytes));
            if (!actual.equalsIgnoreCase(expectedSha256)) throw unavailable();
            var directories = TiffReader.readTiff(bytes).getFileDirectories();
            if (directories.isEmpty()) throw unavailable();
            return new GeoTiffElevationSource(directories.getFirst());
        } catch (IOException | NoSuchAlgorithmException | RuntimeException ex) {
            // 파일명·내용·좌표를 오류 본문이나 로그로 노출하지 않는다.
            throw unavailable();
        }
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
        return elevations[y * width + x] * (1 - dx) * (1 - dy)
                + elevations[y * width + x + 1] * dx * (1 - dy)
                + elevations[(y + 1) * width + x] * (1 - dx) * dy
                + elevations[(y + 1) * width + x + 1] * dx * dy;
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
