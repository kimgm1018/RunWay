package com.runway.backend.infrastructure.dem;

import java.io.IOException;
import java.util.Arrays;
import java.util.zip.DataFormatException;
import java.util.zip.Inflater;

/** Decoders write into a pre-sized block; compressed input cannot grow the output allocation. */
final class BoundedTiffCompression {
    private BoundedTiffCompression() {}

    static byte[] decode(byte[] input, int compression, int expected) throws IOException {
        if (compression == 1) {
            if (input.length != expected) throw invalid();
            return input;
        }
        byte[] output = new byte[expected];
        switch (compression) {
            case 8, 32946 -> inflate(input, output);
            case 32773 -> unpack(input, output);
            case 5 -> lzw(input, output);
            default -> throw invalid();
        }
        return output;
    }

    private static void inflate(byte[] input, byte[] output) throws IOException {
        Inflater inflater = new Inflater();
        try {
            inflater.setInput(input);
            int position = 0;
            while (position < output.length && !inflater.finished()) {
                int count = inflater.inflate(output, position, output.length - position);
                if (count == 0) throw invalid();
                position += count;
            }
            // Consume the trailer and detect over-expansion using one extra byte, never a growing buffer.
            byte[] extra = new byte[1];
            if (position != output.length || inflater.inflate(extra) != 0 || !inflater.finished()) {
                throw invalid();
            }
        } catch (DataFormatException ex) {
            throw invalid();
        } finally {
            inflater.end();
        }
    }

    private static void unpack(byte[] input, byte[] output) throws IOException {
        int source = 0;
        int target = 0;
        while (source < input.length) {
            int control = input[source++];
            if (control == -128) continue;
            int count = control >= 0 ? control + 1 : 1 - control;
            if (count > output.length - target) throw invalid();
            if (control >= 0) {
                if (count > input.length - source) throw invalid();
                System.arraycopy(input, source, output, target, count);
                source += count;
            } else {
                if (source >= input.length) throw invalid();
                Arrays.fill(output, target, target + count, input[source++]);
            }
            target += count;
        }
        if (target != output.length) throw invalid();
    }

    /** TIFF LZW: MSB first, clear=256, EOI=257, early code-width change. */
    private static void lzw(byte[] input, byte[] output) throws IOException {
        int[] prefix = new int[4096];
        byte[] suffix = new byte[4096];
        byte[] stack = new byte[4096];
        int next = 258;
        int bits = 9;
        int bit = 0;
        int previous = -1;
        int first = 0;
        int target = 0;
        boolean ended = false;
        while ((long) bit + bits <= (long) input.length * 8) {
            int code = 0;
            for (int i = 0; i < bits; i++, bit++) {
                code = (code << 1) | ((input[bit / 8] >> (7 - bit % 8)) & 1);
            }
            if (code == 256) {
                next = 258;
                bits = 9;
                previous = -1;
                continue;
            }
            if (code == 257) {
                ended = true;
                break;
            }
            int current = code;
            int size = 0;
            if (current == next && previous >= 0) {
                stack[size++] = (byte) first;
                current = previous;
            } else if (current >= next) throw invalid();
            while (current >= 258) {
                if (current >= next || size >= stack.length - 1) throw invalid();
                stack[size++] = suffix[current];
                current = prefix[current];
            }
            if (current > 255) throw invalid();
            first = current;
            stack[size++] = (byte) first;
            if (size > output.length - target) throw invalid();
            while (size > 0) output[target++] = stack[--size];
            if (previous >= 0 && next < 4096) {
                prefix[next] = previous;
                suffix[next++] = (byte) first;
                if (next == (1 << bits) - 1 && bits < 12) bits++;
            }
            previous = code;
        }
        if (!ended || target != output.length) throw invalid();
    }

    private static IOException invalid() {
        return new IOException("DEM block unavailable");
    }
}
