package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.stream.IntStream;

class GeoTiffElevationSourceTest {
    @TempDir Path temporary;
    private final java.util.List<GeoTiffElevationSource> sources = new java.util.ArrayList<>();

    @AfterEach
    void closeSources() {
        sources.forEach(GeoTiffElevationSource::close);
    }

    private GeoTiffElevationSource open(Path path) throws Exception {
        var source = GeoTiffElevationSource.load(path, sha256(path));
        sources.add(source);
        return source;
    }

    @ParameterizedTest
    @ValueSource(strings = {"area", "point", "deflate", "tiled", "predictor3", "nonzero-tiepoint"})
    void readsPixelCentresAndBilinearValuesFromIndependentGeoTiff(String name) throws Exception {
        var path = fixture(name);
        var source = open(path);
        assertThat(source.elevationAt(10.5, 49.5)).isCloseTo(0, within(1e-9));
        assertThat(source.elevationAt(11, 49)).isCloseTo(5.5, within(1e-9));
        assertThat(source.elevationAt(12.75, 46.25)).isCloseTo(34.75, within(1e-9));
        // As in Route Dem.sample: a 2x2 stencil must fit inside the clip.
        assertThat(source.elevationAt(9, 50)).isNaN();
        assertThat(source.elevationAt(25.5, 34.5)).isNaN();
        assertThat(source.elevationAt(Double.NaN, 49)).isNaN();
    }

    @Test
    void treatsNoDataAsMissingInsteadOfNegativeElevation() throws Exception {
        var path = fixture("nodata");
        var source = open(path);
        assertThat(source.elevationAt(11, 49)).isNaN();
        assertThat(source.elevationAt(12, 48)).isEqualTo(16.5);
    }

    @ParameterizedTest
    @ValueSource(strings = {"projected", "rotated", "multiband", "missing-scale"})
    void rejectsUnsupportedCoordinateSystemsInsteadOfMisreadingCoordinates(String name)
            throws Exception {
        var path = fixture(name);
        assertThatThrownBy(() -> GeoTiffElevationSource.load(path, sha256(path)))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
    }

    @Test
    void rejectsUnverifiedMissingOrCorruptFilesWithoutLeakingLocalPaths() throws Exception {
        var path = fixture("area");
        for (String checksum : new String[] {"", "0".repeat(64), "not-a-sha"}) {
            assertThatThrownBy(() -> GeoTiffElevationSource.load(path, checksum))
                    .isInstanceOf(ApiException.class)
                    .hasMessageNotContaining(path.toString());
        }
        var corrupt = temporary.resolve("private-file.tif");
        Files.writeString(corrupt, "not a TIFF");
        assertThatThrownBy(() -> GeoTiffElevationSource.load(corrupt, sha256(corrupt)))
                .isInstanceOf(ApiException.class)
                .hasMessageNotContaining("private-file");
        assertThatThrownBy(
                        () ->
                                GeoTiffElevationSource.load(
                                        temporary.resolve("absent"), "0".repeat(64)))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void supportsConcurrentQueriesWithoutMutableTiffReaderState() throws Exception {
        var path = fixture("tiled");
        var source = open(path);
        var results =
                IntStream.range(0, 1000)
                        .parallel()
                        .mapToDouble(i -> source.elevationAt(11, 49))
                        .toArray();
        assertThat(results).containsOnly(5.5);
    }

    @Test
    void mapsOnlyDataReadFailuresToServiceUnavailableAndPropagatesInvariantBugs() {
        // I/O, TIFF decode and format failures arrive as IOException: C01 GRADE_UNAVAILABLE.
        assertThatThrownBy(
                        () ->
                                GeoTiffElevationSource.sample(
                                        (x, y) -> {
                                            throw new java.io.IOException("block");
                                        },
                                        0,
                                        0,
                                        Double.NaN))
                .isInstanceOfSatisfying(
                        ApiException.class,
                        e -> assertThat(e.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
        // Any other RuntimeException is a programming error and keeps the 500 path.
        assertThatThrownBy(
                        () ->
                                GeoTiffElevationSource.sample(
                                        (x, y) -> {
                                            throw new IllegalStateException("invariant");
                                        },
                                        0,
                                        0,
                                        Double.NaN))
                .isExactlyInstanceOf(IllegalStateException.class);
        assertThatThrownBy(
                        () ->
                                GeoTiffElevationSource.sample(
                                        (x, y) -> {
                                            throw new ArrayIndexOutOfBoundsException();
                                        },
                                        0,
                                        0,
                                        Double.NaN))
                .isExactlyInstanceOf(ArrayIndexOutOfBoundsException.class);
        // Values are unchanged; nodata and non-finite values are missing.
        assertThat(GeoTiffElevationSource.sample((x, y) -> 12.5, 0, 0, -9999)).isEqualTo(12.5);
        assertThat(GeoTiffElevationSource.sample((x, y) -> -9999, 0, 0, -9999)).isNaN();
        assertThat(GeoTiffElevationSource.sample((x, y) -> Double.POSITIVE_INFINITY, 0, 0, -9999))
                .isNaN();
    }

    private Path fixture(String name) throws Exception {
        return Path.of(getClass().getResource("/course-grade/dem/" + name + ".tif").toURI());
    }

    private static String sha256(Path path) throws Exception {
        return HexFormat.of()
                .formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
    }
}
