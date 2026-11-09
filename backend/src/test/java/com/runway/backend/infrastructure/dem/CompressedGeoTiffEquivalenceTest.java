package com.runway.backend.infrastructure.dem;

import static com.runway.backend.infrastructure.dem.ImageIoTiffFixtures.HEIGHT;
import static com.runway.backend.infrastructure.dem.ImageIoTiffFixtures.NORTH;
import static com.runway.backend.infrastructure.dem.ImageIoTiffFixtures.PIXEL;
import static com.runway.backend.infrastructure.dem.ImageIoTiffFixtures.WEST;
import static com.runway.backend.infrastructure.dem.ImageIoTiffFixtures.WIDTH;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.runway.backend.domain.course.service.CourseGradeService;
import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.awt.image.Raster;
import java.io.RandomAccessFile;
import java.math.BigDecimal;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.util.HexFormat;
import java.util.List;
import mil.nga.tiff.FileDirectory;
import mil.nga.tiff.TiffReader;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;

/**
 * A-9/B-6: LZW, PackBits and DEFLATE blocks written by the JDK TIFF writer, with and without the
 * horizontal predictor, tiles and strips, both byte orders. The new block reader must return the
 * exact source raster, and where the 47c742a full-raster reader (NGA decoders) can read the file,
 * both readers must agree bit for bit on elevations and grades.
 */
class CompressedGeoTiffEquivalenceTest {
    @TempDir Path temporary;

    /**
     * ngaReadable=false: NGA 3.0.0 {@code LZWCompression} throws ("Corrupted code at scan line", "No
     * more remaining bytes") on LZW blocks that contain mid-stream Clear codes, so the old reader
     * could not load these files at all (observed 2026-11-09). The source raster is the reference.
     */
    @ParameterizedTest(name = "{0}")
    @CsvSource({
        "lzw-float-strip-be, LZW, true, false, 0, BE, false",
        "lzw-float-tile-le, LZW, true, false, 128, LE, false",
        "lzw-byte-tile-be, LZW, false, false, 64, BE, true",
        "lzw-byte-strip-le, LZW, false, false, 0, LE, true",
        "lzw-byte-predictor-strip-be, LZW, false, true, 0, BE, true",
        "lzw-byte-predictor-tile-le, LZW, false, true, 64, LE, true",
        "packbits-float-strip-be, PackBits, true, false, 0, BE, true",
        "packbits-float-tile-le, PackBits, true, false, 128, LE, true",
        "packbits-byte-tile-be, PackBits, false, false, 64, BE, true",
        "deflate32946-float-tile-be, Deflate, true, false, 128, BE, true",
        "deflate8-float-strip-le, ZLib, true, false, 0, LE, true",
        "deflate32946-byte-predictor-tile-be, Deflate, false, true, 64, BE, true",
        "deflate8-byte-predictor-strip-le, ZLib, false, true, 0, LE, true",
        "deflate32946-byte-strip-be, Deflate, false, false, 0, BE, true",
    })
    void decodesJdkWrittenBlocksExactlyAndMatchesFullRasterReader(String name, String compression,
            boolean floats, boolean predictor, int tile, String order, boolean ngaReadable)
            throws Exception {
        Path file = ImageIoTiffFixtures.write(temporary.resolve(name + ".tif"), compression, floats,
                predictor, tile, order.equals("LE") ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN, null);
        FileDirectory directory = TiffReader.readTiff(file.toFile()).getFileDirectories().get(0);
        assertThat(directory.getPredictor() == null ? 1 : directory.getPredictor()).isEqualTo(predictor ? 2 : 1);
        assertThat(directory.isTiled()).isEqualTo(tile > 0);
        if (compression.equals("LZW")) {
            int[] stats = largestLzwBlockStats(file, directory);
            // 9→10→11→12-bit transitions (float and byte tiles) and mid-stream Clear codes (float).
            if (floats || tile > 0) assertThat(stats[1]).as("widest code bits").isEqualTo(12);
            if (floats) assertThat(stats[0]).as("Clear codes incl. mid-stream").isGreaterThanOrEqualTo(2);
        }

        Raster truth = ImageIoTiffFixtures.terrain(floats).getRaster();
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), IndexedGeoTiffReader.DEFAULT_CACHE_BYTES)) {
            for (int y = 0; y < HEIGHT; y++) {
                for (int x = 0; x < WIDTH; x++) {
                    double expected = floats ? truth.getSampleFloat(x, y, 0) : truth.getSample(x, y, 0);
                    long actual = Double.doubleToLongBits(reader.sample(x, y));
                    if (actual != Double.doubleToLongBits(expected)) {
                        assertThat(actual).as("pixel %d,%d", x, y).isEqualTo(Double.doubleToLongBits(expected));
                    }
                }
            }
        }
        if (ngaReadable) {
            assertMatchesFullRaster(file);
        } else {
            // Keep the documented baseline limitation visible rather than silently skipping it.
            assertThatThrownBy(() -> FullRasterElevationSource.load(file, hash(file)))
                    .isInstanceOf(ApiException.class);
        }
    }

    /** A valid property value must still fit at least one decoded block of the loaded file. */
    @Test
    void rejectsValidSettingSmallerThanTheFilesDecodedBlock() throws Exception {
        // A padded 1024x1024 Float32 tile needs 4 MiB, even for this smaller source image.
        Path file = ImageIoTiffFixtures.write(temporary.resolve("large-tile.tif"), "Deflate", true,
                false, 1024, ByteOrder.LITTLE_ENDIAN, null);
        assertThatThrownBy(() -> GeoTiffElevationSource.load(file, hash(file), 1024 * 1024))
                .isInstanceOf(IndexedGeoTiffReader.CacheBudgetException.class)
                .hasMessageContaining("runway.course.dem.cache-bytes")
                .hasMessageContaining("4194304")
                .hasMessageNotContaining(file.toString());
        new org.springframework.boot.test.context.runner.ApplicationContextRunner()
                .withUserConfiguration(CourseDemConfig.class)
                .withPropertyValues("runway.course.dem.path=" + file.toAbsolutePath(),
                        "runway.course.dem.sha256=" + hash(file),
                        "runway.course.dem.cache-bytes=1048576")
                .run(context -> {
                    assertThat(context).hasFailed();
                    assertThat(context.getStartupFailure())
                            .hasStackTraceContaining("runway.course.dem.cache-bytes")
                            .hasStackTraceContaining("4194304");
                });
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), 4 * 1024 * 1024)) {
            assertThat(reader.sample(0, 0)).isEqualTo(123.5);
        }
    }

    /** B-9: a large ImageDescription no longer exhausts the metadata budget (128 bytes per character). */
    @Test
    void acceptsLargeByteTypeTagsByCountingTheirBytes() throws Exception {
        Path file = ImageIoTiffFixtures.write(temporary.resolve("description.tif"), "Deflate", true,
                false, 128, ByteOrder.LITTLE_ENDIAN, "x".repeat(100_000));
        assertMatchesFullRaster(file);
    }

    @ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(ints = {1, 6, 7})
    void acceptsLargeUnusedByteSignedByteAndUndefinedTags(int type) throws Exception {
        Path file = ImageIoTiffFixtures.write(temporary.resolve("byte-tag.tif"), "Deflate", true,
                false, 128, ByteOrder.LITTLE_ENDIAN, "x".repeat(100_000));
        byte[] bytes = Files.readAllBytes(file);
        // 작성기가 요청한 바이트 순서를 따르지 않을 수 있어 TIFF 헤더("II"/"MM")로 순서를 정한다.
        var data = java.nio.ByteBuffer.wrap(bytes)
                .order(bytes[0] == 'I' ? ByteOrder.LITTLE_ENDIAN : ByteOrder.BIG_ENDIAN);
        int ifd = data.getInt(4);
        boolean changed = false;
        for (int i = 0; i < Short.toUnsignedInt(data.getShort(ifd)); i++) {
            int entry = ifd + 2 + i * 12;
            if (Short.toUnsignedInt(data.getShort(entry)) == 270) {
                data.putShort(entry + 2, (short) type);
                changed = true;
            }
        }
        assertThat(changed).isTrue();
        Files.write(file, bytes);
        try (var reader = IndexedGeoTiffReader.open(file, hash(file), IndexedGeoTiffReader.DEFAULT_CACHE_BYTES)) {
            assertThat(reader.sample(0, 0)).isEqualTo(123.5);
        }
    }

    private static void assertMatchesFullRaster(Path file) throws Exception {
        var old = FullRasterElevationSource.load(file, hash(file));
        try (var source = GeoTiffElevationSource.load(file, hash(file))) {
            int mismatches = 0;
            for (int row = -2; row <= 2 * HEIGHT + 2; row++) {
                for (int col = -2; col <= 2 * WIDTH + 2; col++) {
                    double lon = WEST + col * PIXEL / 2;
                    double lat = NORTH - row * PIXEL / 2;
                    if (Double.doubleToLongBits(source.elevationAt(lon, lat))
                            != Double.doubleToLongBits(old.elevationAt(lon, lat))) mismatches++;
                }
            }
            assertThat(mismatches).isZero();
            var route = GeoJsonLineString.of(List.of(List.of(WEST + .2, NORTH - .2),
                    List.of(WEST + 2.8, NORTH - .4), List.of(WEST + 1.5, NORTH - 2.5)));
            assertThat(new CourseGradeService(source).calculate(route, new BigDecimal("5000")))
                    .isEqualTo(new CourseGradeService(old).calculate(route, new BigDecimal("5000")));
        }
    }

    /**
     * Fixture sanity check only (not a decoder): scans the TIFF LZW code stream of the largest block
     * and returns {Clear codes, widest code bits}. MSB-first, early width change as in TIFF 6.0.
     */
    private static int[] largestLzwBlockStats(Path file, FileDirectory directory) throws Exception {
        List<? extends Number> offsets = directory.isTiled() ? directory.getTileOffsets() : directory.getStripOffsets();
        List<Number> counts = directory.isTiled() ? directory.getTileByteCounts() : directory.getStripByteCounts();
        int largest = 0;
        for (int i = 1; i < counts.size(); i++) {
            if (counts.get(i).longValue() > counts.get(largest).longValue()) largest = i;
        }
        byte[] block = new byte[counts.get(largest).intValue()];
        try (var input = new RandomAccessFile(file.toFile(), "r")) {
            input.seek(offsets.get(largest).longValue());
            input.readFully(block);
        }
        int bits = 9;
        int next = 258;
        int previous = -1;
        int clears = 0;
        int widest = 9;
        for (long bit = 0; bit + bits <= block.length * 8L; ) {
            int code = 0;
            for (int i = 0; i < bits; i++, bit++) {
                code = (code << 1) | ((block[(int) (bit / 8)] >> (7 - bit % 8)) & 1);
            }
            if (code == 256) {
                clears++;
                bits = 9;
                next = 258;
                previous = -1;
                continue;
            }
            if (code == 257) break;
            if (previous >= 0 && next < 4096 && ++next == (1 << bits) - 1 && bits < 12) bits++;
            widest = Math.max(widest, bits);
            previous = code;
        }
        return new int[] {clears, widest};
    }

    private static String hash(Path path) throws Exception {
        return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(Files.readAllBytes(path)));
    }
}
