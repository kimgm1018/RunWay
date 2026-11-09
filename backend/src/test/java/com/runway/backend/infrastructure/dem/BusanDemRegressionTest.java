package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;

import com.runway.backend.domain.course.service.CourseGradeService;
import com.runway.backend.global.geo.GeoJsonLineString;
import java.math.BigDecimal;
import java.nio.file.Path;
import java.util.List;
import mil.nga.tiff.FieldTagType;
import mil.nga.tiff.FileDirectory;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;

/** Real-file regression against the unchanged 47c742a full-raster implementation. */
@EnabledIfEnvironmentVariable(named = "BACKEND_COURSE_DEM_PATH", matches = ".+")
class BusanDemRegressionTest {
    private static final String HASH = "45faaa5e36c710a235658e1172183279007ac3b3fdcc29a14246222fdabb3a1f";

    @Test
    void matchesBaselineGrades() {
        Path file = Path.of(System.getenv("BACKEND_COURSE_DEM_PATH"));
        var baseline = FullRasterElevationSource.load(file, HASH);
        try (var source = GeoTiffElevationSource.load(file, HASH)) {
            for (double[] point : new double[][] {{129.0786, 35.1586}, {129.20, 35.10},
                    {128.75, 35.10}, {129.33, 35.20}, {129.40, 35.10}, {129.0, 35.45}}) {
                assertThat(Double.doubleToLongBits(source.elevationAt(point[0], point[1])))
                        .isEqualTo(Double.doubleToLongBits(baseline.elevationAt(point[0], point[1])));
            }
            for (var route : List.of(
                    GeoJsonLineString.of(List.of(List.of(129.1000, 35.1450), List.of(129.0786, 35.1586))),
                    GeoJsonLineString.of(List.of(List.of(129.19, 35.10), List.of(129.20, 35.10))),
                    GeoJsonLineString.of(List.of(List.of(129.32, 35.20), List.of(129.40, 35.20))))) {
                assertThat(new CourseGradeService(source).calculate(route, new BigDecimal("2500")))
                        .isEqualTo(new CourseGradeService(baseline).calculate(route, new BigDecimal("2500")));
            }
        }
    }

    /**
     * A-8/B-8: pixel centres across the whole clip, every edge pixel and one pixel beyond (NaN),
     * plus quarter / half pixel offsets. A stride of 4 bounds the comparison work; the lead checks
     * the real-file runtime, with a 60-second test limit.
     */
    @Test
    @org.junit.jupiter.api.Timeout(60)
    void matchesFullRasterBitForBitOnDenseGridOverWholeClip() throws Exception {
        Path file = Path.of(System.getenv("BACKEND_COURSE_DEM_PATH"));
        var baseline = FullRasterElevationSource.load(file, HASH);
        try (var reader = IndexedGeoTiffReader.open(file, HASH, IndexedGeoTiffReader.DEFAULT_CACHE_BYTES);
                var source = GeoTiffElevationSource.load(file, HASH)) {
            FileDirectory directory = reader.directory();
            int width = directory.getImageWidth().intValue();
            int height = directory.getImageHeight().intValue();
            List<Double> scale = directory.getModelPixelScale();
            List<Double> tiepoint = directory.getModelTiepoint();
            double pixelWidth = scale.get(0);
            double pixelHeight = scale.get(1);
            // Pixel centres: PixelIsArea (GeoKey 1025 = 1, default) tiepoints the corner.
            double centre = rasterType(directory) == 1 ? .5 : 0;
            double west = tiepoint.get(3) + (centre - tiepoint.get(0)) * pixelWidth;
            double north = tiepoint.get(4) - (centre - tiepoint.get(1)) * pixelHeight;

            long compared = 0;
            long mismatches = 0;
            String first = null;
            for (int row = -1; row <= height; row += 4) {
                for (int col = -1; col <= width; col += 4) {
                    double lon = west + col * pixelWidth;
                    double lat = north - row * pixelHeight;
                    compared++;
                    if (differs(source, baseline, lon, lat)) {
                        mismatches++;
                        if (first == null) first = col + "," + row;
                    }
                }
            }
            double[][] offsets = {{.25, .25}, {.5, .5}, {.75, .25}, {.25, .75}};
            for (int row = 0; row < height; row += 4) {
                for (int col = 0; col < width; col += 4) {
                    for (double[] offset : offsets) {
                        double lon = west + (col + offset[0]) * pixelWidth;
                        double lat = north - (row + offset[1]) * pixelHeight;
                        compared++;
                        if (differs(source, baseline, lon, lat)) {
                            mismatches++;
                            if (first == null) first = (col + offset[0]) + "," + (row + offset[1]);
                        }
                    }
                }
            }
            // Include the exact last valid stencil, rejected last row/column and outside edges.
            for (int row = -1; row <= height; row++) {
                for (int col : new int[] {-1, 0, width - 2, width - 1, width}) {
                    if (differs(source, baseline, west + col * pixelWidth, north - row * pixelHeight)) {
                        mismatches++;
                        if (first == null) first = col + "," + row;
                    }
                }
            }
            for (int col = -1; col <= width; col++) {
                for (int row : new int[] {-1, 0, height - 2, height - 1, height}) {
                    if (differs(source, baseline, west + col * pixelWidth, north - row * pixelHeight)) {
                        mismatches++;
                        if (first == null) first = col + "," + row;
                    }
                }
            }
            assertThat(compared).isGreaterThan((long) width * height / 4);
            assertThat(mismatches).as("first differing pixel %s", first).isZero();
        }
    }

    private static boolean differs(GeoTiffElevationSource source, FullRasterElevationSource baseline,
            double lon, double lat) {
        return Double.doubleToLongBits(source.elevationAt(lon, lat))
                != Double.doubleToLongBits(baseline.elevationAt(lon, lat));
    }

    private static int rasterType(FileDirectory directory) {
        List<Integer> keys = directory.getIntegerListEntryValue(FieldTagType.GeoKeyDirectory);
        for (int i = 4; i + 3 < keys.size(); i += 4) {
            if (keys.get(i) == 1025) return keys.get(i + 3);
        }
        return 1;
    }
}
