package com.runway.backend.infrastructure.dem;

import mil.nga.tiff.FieldType;
import mil.nga.tiff.FileDirectory;
import mil.nga.tiff.TiffReader;
import mil.nga.tiff.compression.Predictor;
import mil.nga.tiff.util.TiffException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Objects;

/**
 * Classic TIFF index and byte-bounded LRU. The input must remain immutable until close.
 *
 * <p>Reads use {@link RandomAccessFile} under this object's monitor: unlike an interruptible {@code
 * FileChannel}, an interrupted caller cannot close the shared file for every later request.
 */
final class IndexedGeoTiffReader implements AutoCloseable, GeoTiffElevationSource.Sampler {
    static final String CACHE_BYTES_PROPERTY = "runway.course.dem.cache-bytes";
    static final long DEFAULT_CACHE_BYTES = 32L * 1024 * 1024;
    static final long MIN_CACHE_BYTES = 1024L * 1024;
    static final long MAX_CACHE_BYTES = 256L * 1024 * 1024;
    private static final int MAX_BLOCK_BYTES = 8 * 1024 * 1024;
    private static final int MAX_METADATA_BYTES = 8 * 1024 * 1024;
    private static final int GEO_ASCII_PARAMS = 34737;
    private static final int GDAL_NODATA = 42113;
    private static final long FAILURE_WARN_INTERVAL_NANOS = 60_000_000_000L;
    private static final Logger log = LoggerFactory.getLogger(IndexedGeoTiffReader.class);

    private final RandomAccessFile file;
    private final ByteOrder order;
    private final FileDirectory directory;
    private final int width;
    private final int height;
    private final int blockWidth;
    private final int blockHeight;
    private final int blocksAcross;
    private final int bytesPerSample;
    private final int maxBlockBytes;
    private final FieldType sampleType;
    private final int compression;
    private final int predictor;
    private final int planarConfiguration;
    private final boolean tiled;
    private final long[] offsets;
    private final int[] lengths;
    private final long cacheLimit;
    private final LinkedHashMap<Integer, byte[]> cache = new LinkedHashMap<>(16, .75f, true);
    private long cachedBytes;
    private long blockReads;
    private boolean closed;
    private int lastFailedBlock = -1;
    private long lastFailureWarn;

    /** A configuration error, not a data error: it fails startup instead of leaving C01 not ready. */
    static final class CacheBudgetException extends IllegalStateException {
        CacheBudgetException(String message) {
            super(message);
        }
    }

    /**
     * @param cacheBytes decoded block budget; at most {@link #MAX_CACHE_BYTES} and at least one decoded
     *     block of this file. The {@value #CACHE_BYTES_PROPERTY} setting additionally requires {@link
     *     #MIN_CACHE_BYTES}.
     */
    static IndexedGeoTiffReader open(Path path, String expectedSha256, long cacheBytes)
            throws IOException {
        if (cacheBytes <= 0 || cacheBytes > MAX_CACHE_BYTES) {
            throw new CacheBudgetException(
                    CACHE_BYTES_PROPERTY + " must be 1.." + MAX_CACHE_BYTES + " bytes: " + cacheBytes);
        }
        if (expectedSha256 == null || !expectedSha256.matches("[a-fA-F0-9]{64}")) throw invalid();
        BasicFileAttributes before = Files.readAttributes(path, BasicFileAttributes.class);
        RandomAccessFile file = new RandomAccessFile(path.toFile(), "r");
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[64 * 1024];
            long position = 0;
            int count;
            while ((count = file.read(buffer)) > 0) {
                position += count;
                digest.update(buffer, 0, count);
            }
            if (position != before.size()
                    || !HexFormat.of().formatHex(digest.digest()).equalsIgnoreCase(expectedSha256)) {
                throw invalid();
            }
            ByteBuffer header = read(file, 0, 8, before.size());
            short marker = header.getShort();
            ByteOrder order;
            if (marker == 0x4949) order = ByteOrder.LITTLE_ENDIAN;
            else if (marker == 0x4d4d) order = ByteOrder.BIG_ENDIAN;
            else throw invalid();
            header.order(order);
            if (header.getShort(2) != 42) throw invalid();
            FileDirectory directory = metadata(file, header, before.size());
            var result = new IndexedGeoTiffReader(file, order, directory, before.size(), cacheBytes);
            BasicFileAttributes after = Files.readAttributes(path, BasicFileAttributes.class);
            if (file.length() != before.size() || before.size() != after.size()
                    || !before.lastModifiedTime().equals(after.lastModifiedTime())
                    || !Objects.equals(before.fileKey(), after.fileKey())) throw invalid();
            result.probeFirstAndLastBlocks();
            return result;
        } catch (CacheBudgetException ex) {
            closeQuietly(file);
            throw ex;
        } catch (IOException | RuntimeException | NoSuchAlgorithmException ex) {
            closeQuietly(file);
            throw invalid();
        }
    }

    private IndexedGeoTiffReader(RandomAccessFile file, ByteOrder order, FileDirectory directory,
            long fileSize, long cacheLimit) throws IOException {
        this.file = file;
        this.order = order;
        this.directory = directory;
        this.cacheLimit = cacheLimit;
        width = positive(directory.getImageWidth());
        height = positive(directory.getImageHeight());
        if (width < 2 || height < 2 || directory.getSamplesPerPixel() != 1) throw invalid();
        tiled = directory.isTiled();
        blockWidth = positive(directory.getTileWidth());
        blockHeight = positive(directory.getTileHeight());
        blocksAcross = Math.toIntExact((width + (long) blockWidth - 1) / blockWidth);
        sampleType = directory.getFieldTypeForSample(0);
        bytesPerSample = switch (sampleType) {
            case BYTE, SBYTE -> 1;
            case SHORT, SSHORT -> 2;
            case LONG, SLONG, FLOAT -> 4;
            case DOUBLE -> 8;
            default -> throw invalid();
        };
        if (directory.getBitsPerSample().size() != 1) throw invalid();
        compression = directory.getCompression() == null ? 1 : directory.getCompression();
        if (compression != 1 && compression != 5 && compression != 8
                && compression != 32946 && compression != 32773) throw invalid();
        predictor = directory.getPredictor() == null ? 1 : directory.getPredictor();
        if (predictor < 1 || predictor > 3) throw invalid();
        planarConfiguration = directory.getPlanarConfiguration() == null
                ? 1 : directory.getPlanarConfiguration();
        maxBlockBytes = checkedBlockSize(tiled ? blockHeight : Math.min(height, blockHeight));
        if (cacheLimit < maxBlockBytes) {
            throw new CacheBudgetException(CACHE_BYTES_PROPERTY + " (" + cacheLimit
                    + " bytes) is smaller than one decoded DEM block (" + maxBlockBytes + " bytes)");
        }
        List<? extends Number> blockOffsets = tiled ? directory.getTileOffsets() : directory.getStripOffsets();
        List<Number> blockLengths = tiled ? directory.getTileByteCounts() : directory.getStripByteCounts();
        long blocks = blocksAcross * ((height + (long) blockHeight - 1) / blockHeight);
        if (blocks > MAX_METADATA_BYTES / 128 || blockOffsets == null || blockLengths == null
                || blockOffsets.size() != blocks || blockLengths.size() != blocks) throw invalid();
        offsets = new long[(int) blocks];
        lengths = new int[(int) blocks];
        for (int i = 0; i < blocks; i++) {
            offsets[i] = blockOffsets.get(i).longValue();
            long length = blockLengths.get(i).longValue();
            if (length <= 0 || length > MAX_BLOCK_BYTES) throw invalid();
            range(offsets[i], length, fileSize);
            lengths[i] = (int) length;
        }
    }

    FileDirectory directory() {
        return directory;
    }

    /**
     * Decodes the first and last block once, without caching, so an obviously broken file (or an
     * unsupported predictor/sample combination) leaves C01 not ready instead of failing per request.
     * Other blocks are still checked only when first used.
     */
    private synchronized void probeFirstAndLastBlocks() throws IOException {
        int[] probes = offsets.length == 1 ? new int[] {0} : new int[] {0, offsets.length - 1};
        for (int index : probes) {
            try {
                decodeBlock(index);
            } catch (IOException ex) {
                log.warn("코스 DEM 시험 해제 실패: block={}. 경사 계산을 준비되지 않음으로 둔다.", index);
                throw ex;
            }
        }
    }

    /** No block reference escapes the monitor, including during cache eviction and close. */
    @Override
    public synchronized double sample(int x, int y) throws IOException {
        if (closed || x < 0 || y < 0 || x >= width || y >= height) throw invalid();
        int index = (y / blockHeight) * blocksAcross + x / blockWidth;
        byte[] block = cache.get(index);
        if (block == null) {
            try {
                block = decodeBlock(index);
            } catch (IOException ex) {
                warnBlockFailure(index);
                throw ex;
            }
            blockReads++;
            if (block.length <= cacheLimit) {
                while (cachedBytes + block.length > cacheLimit) {
                    var eldest = cache.entrySet().iterator();
                    var entry = eldest.next();
                    cachedBytes -= entry.getValue().length;
                    eldest.remove();
                }
                cache.put(index, block);
                cachedBytes += block.length;
            }
        }
        int offset = ((y % blockHeight) * blockWidth + x % blockWidth) * bytesPerSample;
        ByteBuffer sample = ByteBuffer.wrap(block).order(order);
        return switch (sampleType) {
            case BYTE -> Byte.toUnsignedInt(sample.get(offset));
            case SBYTE -> sample.get(offset);
            case SHORT -> Short.toUnsignedInt(sample.getShort(offset));
            case SSHORT -> sample.getShort(offset);
            case LONG -> Integer.toUnsignedLong(sample.getInt(offset));
            case SLONG -> sample.getInt(offset);
            case FLOAT -> sample.getFloat(offset);
            case DOUBLE -> sample.getDouble(offset);
            default -> throw invalid();
        };
    }

    /** Reads, decompresses and un-predicts one block. Data and TIFF decode failures become IOException. */
    private byte[] decodeBlock(int index) throws IOException {
        int rows = tiled ? blockHeight
                : Math.min(blockHeight, height - (index / blocksAcross) * blockHeight);
        int expected = checkedBlockSize(rows);
        byte[] input = read(file, offsets[index], lengths[index], file.length()).array();
        byte[] block = BoundedTiffCompression.decode(input, compression, expected);
        try {
            block = Predictor.decode(block, predictor, blockWidth, rows,
                    directory.getBitsPerSample(), planarConfiguration);
        } catch (TiffException ex) {
            throw invalid();
        }
        if (block.length != expected) throw invalid();
        return block;
    }

    /** Block index only: never the path, coordinates or hash. Repeats of the same block are rate limited. */
    private void warnBlockFailure(int index) {
        long now = System.nanoTime();
        if (index != lastFailedBlock || now - lastFailureWarn >= FAILURE_WARN_INTERVAL_NANOS) {
            lastFailedBlock = index;
            lastFailureWarn = now;
            log.warn("코스 DEM 블록 읽기·해제 실패: block={}", index);
        }
    }

    synchronized long cachedBytes() {
        return cachedBytes;
    }

    synchronized long blockReads() {
        return blockReads;
    }

    @Override
    public synchronized void close() throws IOException {
        closed = true;
        cache.clear();
        cachedBytes = 0;
        file.close();
    }

    private int checkedBlockSize(int rows) throws IOException {
        long pixels = (long) blockWidth * rows;
        if (pixels > MAX_BLOCK_BYTES / bytesPerSample) throw invalid();
        long size = pixels * bytesPerSample;
        if (size <= 0 || size > MAX_BLOCK_BYTES) throw invalid();
        return (int) size;
    }

    private static int positive(Number number) throws IOException {
        if (number == null || number.longValue() <= 0 || number.longValue() > Integer.MAX_VALUE) throw invalid();
        return number.intValue();
    }

    /**
     * Relocate only IFD payloads into a small TIFF; NGA parses tags, never the raster. Byte-type tags
     * (BYTE, ASCII, SBYTE, UNDEFINED) that elevation lookup never uses, such as ImageDescription or
     * XMP, are counted by their bytes and dropped before NGA turns each byte into an object.
     */
    private static FileDirectory metadata(RandomAccessFile file, ByteBuffer header, long fileSize)
            throws IOException {
        ByteOrder order = header.order();
        long ifdOffset = Integer.toUnsignedLong(header.getInt(4));
        int entries = Short.toUnsignedInt(read(file, ifdOffset, 2, fileSize).order(order).getShort());
        if (entries == 0 || entries > 256) throw invalid();
        int tableSize = 2 + entries * 12 + 4;
        byte[] table = read(file, ifdOffset, tableSize, fileSize).array();
        ByteBuffer fields = ByteBuffer.wrap(table).order(order);
        byte[] keptEntries = new byte[entries * 12];
        List<int[]> relocations = new ArrayList<>(); // {value field in keptEntries, payload offset}
        ByteArrayOutputStream payloads = new ByteArrayOutputStream();
        long budget = tableSize;
        int kept = 0;
        for (int i = 0; i < entries; i++) {
            int entry = 2 + i * 12;
            int tag = Short.toUnsignedInt(fields.getShort(entry));
            int type = Short.toUnsignedInt(fields.getShort(entry + 2));
            int size = switch (type) {
                case 1, 2, 6, 7 -> 1;
                case 3, 8 -> 2;
                case 4, 9, 11 -> 4;
                case 5, 10, 12 -> 8;
                default -> throw invalid();
            };
            long count = Integer.toUnsignedLong(fields.getInt(entry + 4));
            long bytes = count * size;
            boolean keep = size != 1 || tag == GEO_ASCII_PARAMS || tag == GDAL_NODATA;
            // Includes boxed NGA values, duplicate index arrays and temporary relocation buffers.
            // Kept byte-type values become one NGA object per byte, hence the per-element estimate.
            budget += size == 1 ? bytes * 4 + (keep ? count * 64 : 0) : count * 128 + bytes * 4;
            if (budget > MAX_METADATA_BYTES) throw invalid();
            if (!keep) continue;
            int at = kept * 12;
            System.arraycopy(table, entry, keptEntries, at, 12);
            kept++;
            if (bytes > 4) {
                long offset = Integer.toUnsignedLong(fields.getInt(entry + 8));
                byte[] payload = read(file, offset, Math.toIntExact(bytes), fileSize).array();
                relocations.add(new int[] {at + 8, payloads.size()});
                payloads.writeBytes(payload);
            }
        }
        int keptTable = 2 + kept * 12 + 4;
        ByteBuffer compact = ByteBuffer.allocate(8 + keptTable + payloads.size()).order(order);
        compact.put(header.array(), 0, 8);
        compact.putInt(4, 8);
        compact.putShort(8, (short) kept);
        compact.position(10);
        compact.put(keptEntries, 0, kept * 12);
        compact.putInt(0); // Only the first IFD is used, as before.
        compact.put(payloads.toByteArray());
        for (int[] relocation : relocations) {
            compact.putInt(10 + relocation[0], 8 + keptTable + relocation[1]);
        }
        return TiffReader.readTiff(compact.array()).getFileDirectories().getFirst();
    }

    private static ByteBuffer read(RandomAccessFile file, long offset, int count, long size)
            throws IOException {
        range(offset, count, size);
        byte[] bytes = new byte[count];
        file.seek(offset);
        file.readFully(bytes);
        return ByteBuffer.wrap(bytes);
    }

    private static void range(long offset, long length, long size) throws IOException {
        if (offset < 0 || length < 0 || offset > size || length > size - offset) throw invalid();
    }

    private static void closeQuietly(RandomAccessFile file) {
        try {
            file.close();
        } catch (IOException ignored) {
            // Preserve the original failure; never include paths in public errors.
        }
    }

    private static IOException invalid() {
        return new IOException("DEM data unavailable");
    }
}
