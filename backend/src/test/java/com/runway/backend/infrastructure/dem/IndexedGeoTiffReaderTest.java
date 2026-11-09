package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.elevation.PreparedCourseGrade;
import com.runway.backend.domain.course.service.CourseGradeService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.channels.FileChannel;
import java.nio.ByteOrder;
import java.nio.file.StandardOpenOption;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import java.util.concurrent.Executors;
import java.util.concurrent.Callable;
import java.util.stream.IntStream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;

@ExtendWith(OutputCaptureExtension.class)
class IndexedGeoTiffReaderTest {
    @TempDir Path temporary;

    @ParameterizedTest
    @ValueSource(strings = {"area", "point", "deflate", "tiled", "predictor3", "nodata", "nonzero-tiepoint"})
    void matchesFullRasterElevationsAndGradesBitForBit(String name) throws Exception {
        Path file = fixture(name);
        var old = FullRasterElevationSource.load(file, hash(file));
        try (var source = GeoTiffElevationSource.load(file, hash(file))) {
            for (double y = -.25; y <= 15.25; y += .25) {
                for (double x = -.25; x <= 15.25; x += .25) {
                    assertThat(Double.doubleToLongBits(source.elevationAt(10.5 + x, 49.5 - y)))
                            .isEqualTo(Double.doubleToLongBits(old.elevationAt(10.5 + x, 49.5 - y)));
                }
            }
            var route = GeoJsonLineString.of(List.of(List.of(10.75, 47.0), List.of(14.0, 47.0),
                    List.of(14.0, 42.0), List.of(23.75, 36.0)));
            assertThat(new CourseGradeService(source).calculate(route, new BigDecimal("5000")))
                    .isEqualTo(new CourseGradeService(old).calculate(route, new BigDecimal("5000")));
            if (name.equals("nodata")) {
                var partial = GeoJsonLineString.of(List.of(List.of(10.5, 48.0),
                        List.of(10.5, 49.5), List.of(12.5, 49.5)));
                assertThat(new CourseGradeService(source).calculate(partial, new BigDecimal("5000")))
                        .isEqualTo(new CourseGradeService(old).calculate(partial, new BigDecimal("5000")));
            }
        }
    }

    @Test
    void boundsCacheAndDeduplicatesConcurrentMisses() throws Exception {
        Path file = fixture("tiled");
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 1024);
                var executor = Executors.newFixedThreadPool(8)) {
            var jobs = IntStream.range(0, 64).<Callable<Double>>mapToObj(i -> () -> reader.sample(i % 16, i / 16)).toList();
            var results = executor.invokeAll(jobs);
            for (int i = 0; i < results.size(); i++) {
                assertThat(results.get(i).get()).isEqualTo((i / 16) * 10.0 + i % 16);
            }
            assertThat(reader.cachedBytes()).isEqualTo(1024);
            assertThat(reader.blockReads()).isEqualTo(1);
        }
    }

    @Test
    void rejectsCacheBudgetSmallerThanOneDecodedBlockAsConfigurationError() throws Exception {
        Path file = fixture("tiled"); // one 16x16 Float32 tile = 1024 decoded bytes
        for (long budget : new long[] {0, -1, 1023, IndexedGeoTiffReader.MAX_CACHE_BYTES + 1}) {
            assertThatThrownBy(() -> IndexedGeoTiffReader.open(file, hash(file), budget))
                    .isInstanceOf(IndexedGeoTiffReader.CacheBudgetException.class)
                    .hasMessageContaining("runway.course.dem.cache-bytes")
                    .hasMessageNotContaining(file.toString());
            // Not mapped to the data error (GRADE_NOT_READY): the caller fails startup instead.
            assertThatThrownBy(() -> GeoTiffElevationSource.load(file, hash(file), budget))
                    .isInstanceOf(IndexedGeoTiffReader.CacheBudgetException.class);
        }
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 1024)) {
            assertThat(reader.sample(15, 3)).isEqualTo(45);
        }
    }

    @Test
    void rejectsTruncatedBlocksAndClosesResources() throws Exception {
        Path file = temporary.resolve("truncated.tif");
        Files.copy(fixture("tiled"), file);
        try (var source = GeoTiffElevationSource.load(file, hash(file));
                var writer = FileChannel.open(file, StandardOpenOption.WRITE)) {
            writer.truncate(8);
            assertThatThrownBy(() -> source.elevationAt(11, 49)).isInstanceOf(ApiException.class)
                    .hasMessageNotContaining(file.toString());
            assertThatThrownBy(() -> source.elevationAt(11, 49)).isInstanceOf(ApiException.class);
        }
        var source = GeoTiffElevationSource.load(fixture("area"), hash(fixture("area")));
        source.close();
        source.close();
        assertThatThrownBy(() -> source.elevationAt(11, 49)).isInstanceOf(ApiException.class);
    }

    @Test
    void evictsLeastRecentlyUsedBlocksAndInterpolatesAcrossFourTiles() throws Exception {
        Path file = DemTestFiles.grid(temporary.resolve("tiles.tif"), true, ByteOrder.LITTLE_ENDIAN);
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 32)) {
            assertThat(reader.sample(0, 0)).isZero(); // A
            assertThat(reader.sample(2, 0)).isEqualTo(2); // B
            assertThat(reader.sample(1, 0)).isEqualTo(1); // A becomes most recent
            assertThat(reader.sample(4, 0)).isEqualTo(4); // C evicts B
            assertThat(reader.cachedBytes()).isEqualTo(32);
            assertThat(reader.blockReads()).isEqualTo(3);
            assertThat(reader.sample(0, 0)).isZero();
            assertThat(reader.blockReads()).isEqualTo(3);
            assertThat(reader.sample(2, 0)).isEqualTo(2);
            assertThat(reader.blockReads()).isEqualTo(4);
            for (int repeat = 0; repeat < 20; repeat++) {
                for (int y = 0; y < 5; y++) {
                    for (int x = 0; x < 6; x++) {
                        assertThat(reader.sample(x, y)).isEqualTo(y * 10.0 + x);
                        assertThat(reader.cachedBytes()).isLessThanOrEqualTo(32);
                    }
                }
            }
        }
        try (var source = GeoTiffElevationSource.load(file, hash(file), 32)) {
            assertThat(source.elevationAt(12.0, 48.0)).isEqualTo(16.5);
        }
    }

    @Test
    void readsDifferentBlocksConcurrentlyAndClosesDuringQueries() throws Exception {
        for (boolean tiled : List.of(true, false)) {
            for (ByteOrder order : List.of(ByteOrder.LITTLE_ENDIAN, ByteOrder.BIG_ENDIAN)) {
                Path file = DemTestFiles.grid(temporary.resolve("grid-" + tiled + order + ".tif"), tiled, order);
                var old = FullRasterElevationSource.load(file, hash(file));
                // 48 bytes: one two-row strip, or three 2x2 tiles, so both layouts evict constantly.
                try (var source = GeoTiffElevationSource.load(file, hash(file), 48);
                        var executor = Executors.newFixedThreadPool(8)) {
                    var jobs = IntStream.range(0, 800).<Callable<Long>>mapToObj(i -> () -> {
                        double lon = 10.75 + i % 5;
                        double lat = 49.25 - i % 4;
                        double value = source.elevationAt(lon, lat);
                        assertThat(Double.doubleToLongBits(value))
                                .isEqualTo(Double.doubleToLongBits(old.elevationAt(lon, lat)));
                        return Double.doubleToLongBits(value);
                    }).toList();
                    for (var result : executor.invokeAll(jobs)) result.get();
                    var start = new java.util.concurrent.CountDownLatch(1);
                    var reads = IntStream.range(0, 8).<Callable<Void>>mapToObj(i -> () -> {
                        start.await();
                        try {
                            assertThat(source.elevationAt(12, 48)).isEqualTo(16.5);
                        } catch (ApiException ex) {
                            assertThat(ex.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE);
                        }
                        return null;
                    }).toList();
                    var futures = reads.stream().map(executor::submit).toList();
                    start.countDown();
                    source.close();
                    for (var result : futures) result.get();
                }
            }
        }
    }

    @Test
    void preparedCourseGradeCloseClosesRealSourceAndAcceptsNotReadyAndStub() throws Exception {
        Path file = fixture("area");
        var source = GeoTiffElevationSource.load(file, hash(file));
        var prepared = PreparedCourseGrade.of(source);
        prepared.close();
        prepared.close();
        assertThatThrownBy(() -> source.elevationAt(11, 49)).isInstanceOf(ApiException.class);
        PreparedCourseGrade.notReady().close();
        PreparedCourseGrade.of((x, y) -> 1).close();
    }

    @Test
    void interruptedReaderThreadDoesNotCloseTheSharedFile() throws Exception {
        Path file = DemTestFiles.grid(temporary.resolve("interrupt.tif"), true, ByteOrder.LITTLE_ENDIAN);
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 16)) {
            Thread.currentThread().interrupt();
            try {
                assertThat(reader.sample(2, 0)).isEqualTo(2); // cache miss while interrupted
            } finally {
                assertThat(Thread.interrupted()).as("interrupt status is preserved").isTrue();
            }
            assertThat(reader.sample(4, 4)).isEqualTo(44); // later misses still read the file
            assertThat(reader.blockReads()).isEqualTo(2);
        }
        try (var source = GeoTiffElevationSource.load(file, hash(file), 16)) {
            var result = new java.util.concurrent.atomic.AtomicReference<Object>();
            Thread worker = new Thread(() -> {
                Thread.currentThread().interrupt();
                try {
                    result.set(source.elevationAt(12, 48));
                } catch (RuntimeException ex) {
                    result.set(ex);
                }
            });
            worker.start();
            worker.join();
            assertThat(result.get()).isEqualTo(16.5);
            assertThat(source.elevationAt(10.75, 49.25)).isEqualTo(2.75);
        }
    }

    @Test
    void rejectsOversizedMetadataOffsetsAndBlocksBeforeAllocation() throws Exception {
        Path file = DemTestFiles.grid(temporary.resolve("bad-index.tif"), true, ByteOrder.LITTLE_ENDIAN);
        byte[] original = Files.readAllBytes(file);
        for (int variant = 0; variant < 4; variant++) {
            byte[] mutated = original.clone();
            var data = java.nio.ByteBuffer.wrap(mutated).order(ByteOrder.LITTLE_ENDIAN);
            if (variant == 0) data.putInt(4, -4); // unsigned IFD offset outside file
            if (variant == 1) data.putInt(10 + 11 * 12 + 4, -1); // enormous pixel scale count
            if (variant == 2) data.putInt(10 + 6 * 12 + 8, Integer.MAX_VALUE); // tile width
            if (variant == 3) { // tile byte count cannot exceed the per-block input limit
                int counts = data.getInt(10 + 9 * 12 + 8);
                data.putInt(counts, 8 * 1024 * 1024 + 1);
            }
            Files.write(file, mutated);
            assertThatThrownBy(() -> GeoTiffElevationSource.load(file, hash(file)))
                    .isInstanceOf(ApiException.class).hasMessageNotContaining(file.toString());
        }
    }

    @Test
    void rejectsUndecodableFirstOrLastBlockAtStartup(CapturedOutput output) throws Exception {
        Path file = temporary.resolve("bad-block.tif");
        byte[] bytes = Files.readAllBytes(fixture("tiled"));
        var data = java.nio.ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int offset = data.getInt(entryValue(data, 324)); // single tile offset is inline
        bytes[offset] = 0;
        bytes[offset + 1] = 0; // invalid zlib header
        Files.write(file, bytes);
        assertThatThrownBy(() -> IndexedGeoTiffReader.open(file, hash(file), 1024))
                .isInstanceOf(java.io.IOException.class);
        assertThatThrownBy(() -> GeoTiffElevationSource.load(file, hash(file)))
                .isInstanceOfSatisfying(ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
        assertThat(output.getAll()).contains("block=0").doesNotContain(file.toString());

        Path last = DemTestFiles.grid(temporary.resolve("bad-last.tif"), true, ByteOrder.LITTLE_ENDIAN);
        setBlockByteCount(last, 8, 12); // 2x2 Float32 tile needs 16 bytes
        assertThatThrownBy(() -> GeoTiffElevationSource.load(last, hash(last), 16))
                .isInstanceOf(ApiException.class);
        assertThat(output.getAll()).contains("block=8");

        // Unsupported predictor/sample combinations (NGA TiffException) are caught at startup too.
        Path predictor = DemTestFiles.grid(temporary.resolve("predictor2-float64.tif"), true,
                ByteOrder.LITTLE_ENDIAN, 64, 2);
        assertThatThrownBy(() -> GeoTiffElevationSource.load(predictor, hash(predictor), 32))
                .isInstanceOfSatisfying(ApiException.class,
                        ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
    }

    @Test
    void requestTimeBlockFailureIsNotCachedAndLogsOnlyTheBlockIndex(CapturedOutput output) throws Exception {
        Path file = DemTestFiles.grid(temporary.resolve("bad-middle.tif"), true, ByteOrder.LITTLE_ENDIAN);
        setBlockByteCount(file, 4, 12); // middle tile; first and last tiles stay valid
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 64)) {
            assertThat(reader.blockReads()).isZero(); // the startup probe is not cached or counted
            assertThat(reader.cachedBytes()).isZero();
            for (int i = 0; i < 2; i++) {
                assertThatThrownBy(() -> reader.sample(2, 2)).isInstanceOf(java.io.IOException.class);
                assertThat(reader.blockReads()).isZero();
                assertThat(reader.cachedBytes()).isZero();
            }
            assertThat(reader.sample(0, 0)).isZero();
        }
        assertThat(output.getAll()).contains("block=4").doesNotContain(file.toString())
                .doesNotContain(temporary.toString());
        try (var source = GeoTiffElevationSource.load(file, hash(file), 64)) {
            assertThatThrownBy(() -> source.elevationAt(12.5, 47.5))
                    .isInstanceOfSatisfying(ApiException.class,
                            ex -> assertThat(ex.errorCode()).isEqualTo(ErrorCode.SERVICE_UNAVAILABLE));
            assertThat(source.elevationAt(10.75, 49.25)).isEqualTo(2.75);
        }
    }

    /** Absolute file position of the 4-byte value field of the first-IFD entry with this tag. */
    private static int entryValue(java.nio.ByteBuffer data, int tag) {
        int ifd = data.getInt(4);
        int entries = Short.toUnsignedInt(data.getShort(ifd));
        for (int i = 0; i < entries; i++) {
            int entry = ifd + 2 + i * 12;
            if (Short.toUnsignedInt(data.getShort(entry)) == tag) return entry + 8;
        }
        throw new IllegalArgumentException("tag " + tag);
    }

    private static void setBlockByteCount(Path file, int block, int count) throws Exception {
        byte[] bytes = Files.readAllBytes(file);
        var data = java.nio.ByteBuffer.wrap(bytes).order(ByteOrder.LITTLE_ENDIAN);
        int counts = data.getInt(entryValue(data, 325)); // nine tiles: the value field holds the array offset
        data.putInt(counts + block * 4, count);
        Files.write(file, bytes);
    }

    static Path fixture(String name) throws Exception {
        return Path.of(IndexedGeoTiffReaderTest.class.getResource("/course-grade/dem/" + name + ".tif").toURI());
    }

    static String hash(Path path) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
    }
}
