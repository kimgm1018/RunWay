package com.runway.backend.infrastructure.dem;

import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;

/** Hand-written classic TIFF: 6x5 Float32 grid, 2x2 tiles or two-row strips. */
final class DemTestFiles {
    private DemTestFiles() {}

    static Path grid(Path path, boolean tiled, ByteOrder order) throws Exception {
        return grid(path, tiled, order, 32, 1);
    }

    /**
     * @param bits 32 (Float32) or 64 (Float64) samples
     * @param predictor Predictor tag value; samples are written as is (no differencing), so values
     *     other than 1 are only for decoder rejection tests
     */
    static Path grid(Path path, boolean tiled, ByteOrder order, int bits, int predictor) throws Exception {
        int bytes = bits / 8;
        int across = tiled ? 3 : 1;
        int blocks = across * 3;
        int tags = predictor == 1 ? 14 : 15;
        int payload = 8 + 2 + tags * 12 + 4;
        int scale = payload;
        int tiepoint = scale + 24;
        int keys = tiepoint + 48;
        int offsets = keys + 32;
        int counts = offsets + blocks * 4;
        int pixels = counts + blocks * 4;
        ByteBuffer data = ByteBuffer.allocate(pixels + 6 * 6 * bytes).order(order);
        data.putShort((short) (order == ByteOrder.LITTLE_ENDIAN ? 0x4949 : 0x4d4d));
        data.putShort((short) 42).putInt(8).putShort((short) tags);
        tag(data, 256, 4, 1, 6);
        tag(data, 257, 4, 1, 5);
        tag(data, 258, 3, 1, bits);
        tag(data, 259, 3, 1, 1);
        tag(data, 277, 3, 1, 1);
        tag(data, 284, 3, 1, 1);
        if (tiled) {
            tag(data, 322, 4, 1, 2);
            tag(data, 323, 4, 1, 2);
        } else {
            tag(data, 278, 4, 1, 2);
            tag(data, 262, 3, 1, 1);
        }
        tag(data, tiled ? 324 : 273, 4, blocks, offsets);
        tag(data, tiled ? 325 : 279, 4, blocks, counts);
        tag(data, 339, 3, 1, 3);
        if (predictor != 1) tag(data, 317, 3, 1, predictor);
        tag(data, 33550, 12, 3, scale);
        tag(data, 33922, 12, 6, tiepoint);
        tag(data, 34735, 3, 16, keys);
        data.putInt(0);
        data.position(scale);
        for (double v : new double[] {1, 1, 0, 0, 0, 0, 10, 50, 0}) data.putDouble(v);
        data.position(keys);
        for (int v : new int[] {1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326}) {
            data.putShort((short) v);
        }
        int position = pixels;
        for (int block = 0; block < blocks; block++) {
            int rows = tiled ? 2 : Math.min(2, 5 - block * 2);
            int columns = tiled ? 2 : 6;
            data.putInt(offsets + block * 4, position);
            data.putInt(counts + block * 4, columns * rows * bytes);
            data.position(position);
            for (int y = 0; y < rows; y++) {
                for (int x = 0; x < columns; x++) {
                    int row = block / across * 2 + y;
                    int col = block % across * columns + x;
                    if (bits == 64) data.putDouble(row * 10 + col);
                    else data.putFloat(row * 10 + col);
                }
            }
            position = data.position();
        }
        Files.write(path, java.util.Arrays.copyOf(data.array(), position));
        return path;
    }

    private static void tag(ByteBuffer data, int tag, int type, int count, int value) {
        data.putShort((short) tag).putShort((short) type).putInt(count);
        if (type == 3 && count == 1) data.putShort((short) value).putShort((short) 0);
        else data.putInt(value);
    }
}
