package com.runway.backend.domain.image;

import com.runway.backend.global.exception.ApiException;
import com.runway.backend.global.exception.ErrorCode;

import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.DirectoryIteratorException;
import java.nio.file.LinkOption;
import java.nio.file.NoSuchFileException;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Pattern;

@Component
public class VolumeImageStorage implements ImageStorage {

    private final Path root;

    public VolumeImageStorage(ImageStorageProperties properties) {
        this.root = properties.resolvedRoot();
    }

    @Override
    public void store(String imageKey, InputStream content, long contentLength) {
        Path target = resolve(imageKey);
        try {
            Files.createDirectories(target.getParent());
            Files.copy(content, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.UPLOAD_UNAVAILABLE);
        }
    }

    @Override
    public boolean exists(String imageKey) {
        return Files.isRegularFile(resolve(imageKey), LinkOption.NOFOLLOW_LINKS);
    }

    @Override
    public Optional<StoredImage> findByImageId(UUID imageId) {
        Optional<StoredImage> jpg = openById(imageId, "jpg", MediaType.IMAGE_JPEG_VALUE);
        if (jpg.isPresent()) {
            return jpg;
        }
        return openById(imageId, "png", MediaType.IMAGE_PNG_VALUE);
    }

    private Optional<StoredImage> openById(UUID imageId, String extension, String contentType) {
        String imageKey = "images/by-id/" + imageId + "." + extension;
        return openKey(imageKey, contentType);
    }

    @Override
    public Optional<StoredImage> findByKey(String imageKey) {
        if (imageKey.endsWith(".jpg")) {
            return openKey(imageKey, MediaType.IMAGE_JPEG_VALUE);
        }
        if (imageKey.endsWith(".png")) {
            return openKey(imageKey, MediaType.IMAGE_PNG_VALUE);
        }
        return Optional.empty();
    }

    private Optional<StoredImage> openKey(String imageKey, String contentType) {
        Path path = resolve(imageKey);
        if (!Files.isRegularFile(path, LinkOption.NOFOLLOW_LINKS)) {
            return Optional.empty();
        }
        try {
            long size = Files.size(path);
            InputStream content = Files.newInputStream(path, LinkOption.NOFOLLOW_LINKS);
            return Optional.of(new StoredImage(imageKey, contentType, content, size));
        } catch (IOException ex) {
            throw new ApiException(ErrorCode.UPLOAD_UNAVAILABLE);
        }
    }

    private Path resolve(String imageKey) {
        Path target = root.resolve(imageKey).normalize();
        if (!target.startsWith(root)) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_IMAGE_RESOLVE);
        }
        return target;
    }

    @Override
    public void deletePersonalImages(long userId) {
        if (userId <= 0) throw new ApiException(ErrorCode.UPLOAD_UNAVAILABLE);
        try {
            // Never recurse or enumerate a different owner's directory. Keeping the
            // canonical source until its by-id copy is gone makes retries discoverable.
            // run-route: the owner's server-rendered run thumbnails (S15P31E105-756), which have no by-id copy.
            for (String purpose : new String[] {"profile", "post", "run-route"}) {
                Path directory = resolve("images/" + purpose + "/" + userId);
                if (!safeDirectory(directory)) continue;
                try (var files = Files.newDirectoryStream(directory)) {
                    for (Path source : files) {
                        String name = source.getFileName().toString();
                        if (!name.matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.(jpg|png)"))
                            throw new IOException("Unexpected personal image entry");
                        if (!safeFile(source)) continue;
                        Path lookup = resolve("images/by-id/" + name);
                        if (safeFile(lookup)) deleteFile(lookup);
                        // Recheck the parent before each deletion, including retries.
                        if (safeFile(source)) deleteFile(source);
                    }
                }
                if (safeDirectory(directory)) deleteFile(directory);
            }
        } catch (IOException | DirectoryIteratorException exception) {
            // No filesystem paths or driver exception messages leave this boundary.
            throw new ApiException(ErrorCode.UPLOAD_UNAVAILABLE);
        }
    }

    private static final Pattern COURSE_BASEMAP_KEY =
            Pattern.compile(
                    Pattern.quote(COURSE_BASEMAP_KEY_PREFIX)
                            + "[1-9][0-9]{0,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png");

    private static final Pattern RUN_ROUTE_KEY =
            Pattern.compile(
                    Pattern.quote(RUN_ROUTE_KEY_PREFIX)
                            + "[1-9][0-9]{0,18}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\\.png");

    @Override
    public void deleteCourseBasemap(String imageKey) {
        deleteRendered(imageKey, COURSE_BASEMAP_KEY);
    }

    @Override
    public void deleteRunRouteBasemap(String imageKey) {
        deleteRendered(imageKey, RUN_ROUTE_KEY);
    }

    private void deleteRendered(String imageKey, Pattern format) {
        if (imageKey == null || !format.matcher(imageKey).matches()) {
            throw new ApiException(ErrorCode.VALIDATION_ERROR_IMAGE_RESOLVE);
        }
        Path target = resolve(imageKey);
        try {
            if (safeFile(target)) deleteFile(target);
        } catch (IOException | DirectoryIteratorException exception) {
            // No filesystem paths or driver exception messages leave this boundary.
            throw new ApiException(ErrorCode.UPLOAD_UNAVAILABLE);
        }
    }

    /** A single unlink, separated to inject interruption deterministically in tests. */
    protected void deleteFile(Path path) throws IOException {
        Files.deleteIfExists(path);
    }

    private boolean safeFile(Path path) throws IOException {
        if (!safeDirectory(path.getParent())) return false;
        try {
            var attributes = Files.readAttributes(path, BasicFileAttributes.class,
                    LinkOption.NOFOLLOW_LINKS);
            if (!attributes.isRegularFile() || attributes.isSymbolicLink())
                throw new IOException("Unexpected image file type");
            if (!path.toRealPath().equals(root.toRealPath().resolve(root.relativize(path))))
                throw new IOException("Unexpected image file location");
            return true;
        } catch (NoSuchFileException exception) {
            return false;
        }
    }

    private boolean safeDirectory(Path path) throws IOException {
        if (!path.normalize().startsWith(root)) throw new IOException("Invalid image directory");
        try {
            var base = Files.readAttributes(root, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (!base.isDirectory() || base.isSymbolicLink())
                throw new IOException("Unexpected image root type");
            Path realRoot = root.toRealPath();
            Path current = root;
            for (Path part : root.relativize(path)) {
                current = current.resolve(part);
                var attributes = Files.readAttributes(current, BasicFileAttributes.class,
                        LinkOption.NOFOLLOW_LINKS);
                if (!attributes.isDirectory() || attributes.isSymbolicLink()
                        || !current.toRealPath().equals(realRoot.resolve(root.relativize(current))))
                    throw new IOException("Unexpected image directory type");
            }
            return true;
        } catch (NoSuchFileException exception) {
            return false;
        }
    }
}
