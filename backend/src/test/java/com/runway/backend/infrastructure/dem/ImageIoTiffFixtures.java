package com.runway.backend.infrastructure.dem;

import java.awt.Transparency;
import java.awt.color.ColorSpace;
import java.awt.image.BufferedImage;
import java.awt.image.ComponentColorModel;
import java.awt.image.DataBuffer;
import java.awt.image.WritableRaster;
import java.io.IOException;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;
import javax.imageio.IIOImage;
import javax.imageio.ImageIO;
import javax.imageio.ImageTypeSpecifier;
import javax.imageio.ImageWriteParam;
import javax.imageio.ImageWriter;
import javax.imageio.metadata.IIOMetadata;
import javax.imageio.plugins.tiff.BaselineTIFFTagSet;
import javax.imageio.plugins.tiff.GeoTIFFTagSet;
import javax.imageio.plugins.tiff.TIFFDirectory;
import javax.imageio.plugins.tiff.TIFFField;
import javax.imageio.plugins.tiff.TIFFTag;
import javax.imageio.stream.ImageOutputStream;

/**
 * Compressed GeoTIFF fixtures written by the JDK TIFF writer, an encoder independent of both the NGA
 * decoders (old full-raster reader) and {@link BoundedTiffCompression} (new block reader).
 *
 * <p>Float32 terrain has noisy low mantissa bits, so each LZW block is long enough to pass the
 * 9→10→11→12-bit code widths and to emit mid-stream Clear codes (the 3,836-entry table fills after
 * about 5.4 KB of output). A flat plateau and a NaN patch give PackBits repeat runs and LZW
 * repeated-string codes.
 */
final class ImageIoTiffFixtures {
    static final int WIDTH = 300;
    static final int HEIGHT = 260;
    static final double WEST = 10.0;
    static final double NORTH = 50.0;
    static final double PIXEL = 0.01;

    private ImageIoTiffFixtures() {}

    /**
     * @param compression JDK TIFF compression type: "LZW", "PackBits", "Deflate" (32946) or "ZLib" (8)
     * @param floats Float32 samples, otherwise unsigned 8-bit samples
     * @param predictor horizontal differencing predictor (the JDK writer supports it for 8-bit LZW,
     *     Deflate and ZLib only)
     * @param tileSize 0 for strips, otherwise square tiles (multiple of 16)
     * @param description optional ImageDescription text, null for none
     */
    static Path write(Path path, String compression, boolean floats, boolean predictor,
            int tileSize, ByteOrder order, String description) throws IOException {
        BufferedImage image = terrain(floats);
        ImageWriter writer = ImageIO.getImageWritersByFormatName("tiff").next();
        Files.deleteIfExists(path);
        try (ImageOutputStream out = ImageIO.createImageOutputStream(path.toFile())) {
            out.setByteOrder(order);
            writer.setOutput(out);
            ImageWriteParam param = writer.getDefaultWriteParam();
            param.setCompressionMode(ImageWriteParam.MODE_EXPLICIT);
            param.setCompressionType(compression);
            if (tileSize > 0) {
                param.setTilingMode(ImageWriteParam.MODE_EXPLICIT);
                param.setTiling(tileSize, tileSize, 0, 0);
            }
            IIOMetadata defaults = writer.getDefaultImageMetadata(
                    ImageTypeSpecifier.createFromRenderedImage(image), param);
            TIFFDirectory directory = TIFFDirectory.createFromMetadata(defaults);
            GeoTIFFTagSet geo = GeoTIFFTagSet.getInstance();
            directory.addTIFFField(new TIFFField(geo.getTag(GeoTIFFTagSet.TAG_MODEL_PIXEL_SCALE),
                    TIFFTag.TIFF_DOUBLE, 3, new double[] {PIXEL, PIXEL, 0}));
            directory.addTIFFField(new TIFFField(geo.getTag(GeoTIFFTagSet.TAG_MODEL_TIE_POINT),
                    TIFFTag.TIFF_DOUBLE, 6, new double[] {0, 0, 0, WEST, NORTH, 0}));
            char[] keys = {1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326};
            directory.addTIFFField(new TIFFField(geo.getTag(GeoTIFFTagSet.TAG_GEO_KEY_DIRECTORY),
                    TIFFTag.TIFF_SHORT, keys.length, keys));
            BaselineTIFFTagSet baseline = BaselineTIFFTagSet.getInstance();
            if (predictor) {
                directory.addTIFFField(new TIFFField(baseline.getTag(BaselineTIFFTagSet.TAG_PREDICTOR),
                        BaselineTIFFTagSet.PREDICTOR_HORIZONTAL_DIFFERENCING));
            }
            if (description != null) {
                directory.addTIFFField(new TIFFField(
                        baseline.getTag(BaselineTIFFTagSet.TAG_IMAGE_DESCRIPTION),
                        TIFFTag.TIFF_ASCII, 1, new String[] {description}));
            }
            writer.write(null, new IIOImage(image, null, directory.getAsMetadata()), param);
        } finally {
            writer.dispose();
        }
        return path;
    }

    /** The exact source raster written to every fixture of the same sample type. */
    static BufferedImage terrain(boolean floats) {
        return floats ? floatTerrain() : byteTerrain();
    }

    private static BufferedImage floatTerrain() {
        ComponentColorModel model = new ComponentColorModel(ColorSpace.getInstance(ColorSpace.CS_GRAY),
                false, false, Transparency.OPAQUE, DataBuffer.TYPE_FLOAT);
        WritableRaster raster = model.createCompatibleWritableRaster(WIDTH, HEIGHT);
        Random random = new Random(590);
        for (int y = 0; y < HEIGHT; y++) {
            for (int x = 0; x < WIDTH; x++) {
                float value;
                if (x < 40 && y < 30) value = 123.5f; // plateau: repeat runs
                else if (x >= 200 && x < 204 && y >= 100 && y < 103) value = Float.NaN;
                else value = (float) (80 + 60 * Math.sin(x / 17.0) * Math.cos(y / 23.0)
                        + random.nextGaussian() * 2.5);
                raster.setSample(x, y, 0, value);
            }
        }
        return new BufferedImage(model, raster, false, null);
    }

    private static BufferedImage byteTerrain() {
        BufferedImage image = new BufferedImage(WIDTH, HEIGHT, BufferedImage.TYPE_BYTE_GRAY);
        WritableRaster raster = image.getRaster();
        Random random = new Random(591);
        for (int y = 0; y < HEIGHT; y++) {
            for (int x = 0; x < WIDTH; x++) {
                int value = x < 40 && y < 30 ? 77 : (x * 3 + y * 5 + random.nextInt(9)) & 0xff;
                raster.setSample(x, y, 0, value);
            }
        }
        return image;
    }
}
