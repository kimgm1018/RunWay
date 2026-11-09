package com.runway.backend.infrastructure.dem;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.util.zip.Deflater;
import org.junit.jupiter.api.Test;

class BoundedTiffCompressionTest {
    @Test
    void rejectsDeflateOverExpansionTruncationAndCorruption() throws Exception {
        byte[] compressed = deflate(new byte[8192]);
        assertThat(BoundedTiffCompression.decode(compressed, 8, 8192)).containsOnly((byte) 0);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(compressed, 8, 16))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(compressed, 8, 8193))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(new byte[] {1, 2}, 8, 16))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(
                java.util.Arrays.copyOf(compressed, compressed.length - 2), 8, 8192))
                .isInstanceOf(IOException.class);
        assertThat(BoundedTiffCompression.decode(compressed, 32946, 8192)).hasSize(8192);
    }

    @Test
    void decodesPackbitsAndRejectsOversizedOrTruncatedRuns() throws Exception {
        byte[] packed = {1, 10, 20, -2, 30, -128};
        assertThat(BoundedTiffCompression.decode(packed, 32773, 5))
                .containsExactly(10, 20, 30, 30, 30);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(packed, 32773, 4))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(new byte[] {2, 1}, 32773, 3))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(new byte[] {-2}, 32773, 3))
                .isInstanceOf(IOException.class);
    }

    @Test
    void decodesLzwDictionaryReferencesAndRejectsInvalidOrOversizedOutput() throws Exception {
        byte[] encoded = codes(256, 65, 66, 258, 260, 257); // A B AB ABA
        assertThat(BoundedTiffCompression.decode(encoded, 5, 7))
                .containsExactly(65, 66, 65, 66, 65, 66, 65);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(encoded, 5, 6))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(codes(256, 300, 257), 5, 1))
                .isInstanceOf(IOException.class);
        assertThatThrownBy(() -> BoundedTiffCompression.decode(codes(256, 65), 5, 1))
                .isInstanceOf(IOException.class);
    }

    private static byte[] codes(int... codes) {
        byte[] result = new byte[(codes.length * 9 + 7) / 8];
        int position = 0;
        for (int code : codes) {
            for (int bit = 8; bit >= 0; bit--, position++) {
                result[position / 8] |= (byte) (((code >> bit) & 1) << (7 - position % 8));
            }
        }
        return result;
    }

    private static byte[] deflate(byte[] input) {
        Deflater deflater = new Deflater();
        try {
            deflater.setInput(input);
            deflater.finish();
            byte[] buffer = new byte[input.length + 128];
            return java.util.Arrays.copyOf(buffer, deflater.deflate(buffer));
        } finally {
            deflater.end();
        }
    }
}
