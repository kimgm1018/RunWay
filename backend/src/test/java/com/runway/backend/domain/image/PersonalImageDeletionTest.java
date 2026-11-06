package com.runway.backend.domain.image;

import static org.assertj.core.api.Assertions.*;

import com.runway.backend.global.exception.ApiException;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class PersonalImageDeletionTest {
    @TempDir Path root;
    @TempDir Path external;

    ImageStorageProperties properties() {
        var properties = new ImageStorageProperties();
        properties.setVolumePath(root.toString());
        return properties;
    }

    Path pair(VolumeImageStorage storage, String purpose, long owner) {
        String name = UUID.randomUUID() + ".png";
        String key = "images/" + purpose + "/" + owner + "/" + name;
        storage.store(key, new ByteArrayInputStream(new byte[] {1, 2}), 2);
        storage.store("images/by-id/" + name, new ByteArrayInputStream(new byte[] {1, 2}), 2);
        return root.resolve(key);
    }

    Path copy(Path source) {
        return root.resolve("images/by-id").resolve(source.getFileName());
    }

    @Test
    void deletesPersonalPairsAndPreservesCrewAndOtherOwners() {
        var storage = new VolumeImageStorage(properties());
        var profile = pair(storage, "profile", 1);
        var post = pair(storage, "post", 1);
        var crew = pair(storage, "crew", 1);
        var other = pair(storage, "profile", 2);
        storage.deletePersonalImages(1);
        storage.deletePersonalImages(1);
        assertThat(profile).doesNotExist();
        assertThat(copy(profile)).doesNotExist();
        assertThat(post).doesNotExist();
        assertThat(copy(post)).doesNotExist();
        assertThat(crew).exists();
        assertThat(copy(crew)).exists();
        assertThat(other).exists();
        assertThat(copy(other)).exists();
    }

    @Test
    void interruptedUnlinkRetainsSourceAndNewInstanceCanResume() {
        var failOnce = new VolumeImageStorage(properties()) {
            @Override
            protected void deleteFile(Path path) throws IOException {
                if (path.startsWith(root.resolve("images/profile")))
                    throw new IOException("synthetic interruption");
                super.deleteFile(path);
            }
        };
        var source = pair(failOnce, "profile", 1);
        assertThatThrownBy(() -> failOnce.deletePersonalImages(1))
                .isInstanceOfSatisfying(ApiException.class,
                        error -> assertThat(error.code()).isEqualTo("UPLOAD_UNAVAILABLE"));
        assertThat(source).exists();
        assertThat(copy(source)).doesNotExist();
        new VolumeImageStorage(properties()).deletePersonalImages(1);
        assertThat(source).doesNotExist();
        assertThat(copy(source)).doesNotExist();
    }

    @Test
    void invalidEntriesAreNotRecursivelyDeletedAndUnknownOrphansArePreserved() throws Exception {
        var storage = new VolumeImageStorage(properties());
        var unexpected = root.resolve("images/profile/1/nested");
        Files.createDirectories(unexpected);
        Files.writeString(unexpected.resolve("keep.txt"), "synthetic");
        String orphan = "images/by-id/" + UUID.randomUUID() + ".png";
        storage.store(orphan, new ByteArrayInputStream(new byte[] {1}), 1);
        assertThatThrownBy(() -> storage.deletePersonalImages(1)).isInstanceOf(ApiException.class);
        assertThat(unexpected.resolve("keep.txt")).exists();
        storage.deletePersonalImages(2);
        assertThat(root.resolve(orphan)).exists();
        assertThatThrownBy(() -> storage.deletePersonalImages(-1)).isInstanceOf(ApiException.class);
    }

    @Test
    void ownerDirectoryLinkCannotDeleteOutsideTheConfiguredRoot() throws Exception {
        var storage = new VolumeImageStorage(properties());
        var outside = Files.createDirectory(external.resolve("outside"));
        var outsideFile = outside.resolve(UUID.randomUUID() + ".png");
        Files.writeString(outsideFile, "synthetic");
        Files.createDirectories(root.resolve("images/profile"));
        var link = root.resolve("images/profile/1");
        linkDirectory(link, outside);
        try {
            assertThatThrownBy(() -> storage.deletePersonalImages(1)).isInstanceOf(ApiException.class);
            assertThat(outsideFile).hasContent("synthetic");
        } finally {
            Files.delete(link);
        }
    }

    @Test
    void byIdDirectoryLinkCannotDeleteAnotherLocation() throws Exception {
        var storage = new VolumeImageStorage(properties());
        var source = pair(storage, "profile", 1);
        Files.delete(copy(source));
        Files.delete(root.resolve("images/by-id"));
        var outside = Files.createDirectory(external.resolve("outside"));
        var outsideFile = outside.resolve(source.getFileName());
        Files.writeString(outsideFile, "synthetic");
        var link = root.resolve("images/by-id");
        linkDirectory(link, outside);
        try {
            assertThatThrownBy(() -> storage.deletePersonalImages(1)).isInstanceOf(ApiException.class);
            assertThat(source).exists();
            assertThat(outsideFile).hasContent("synthetic");
        } finally {
            Files.delete(link);
        }
    }

    static void linkDirectory(Path link, Path target) throws Exception {
        if (System.getProperty("os.name").startsWith("Windows")) {
            var process = new ProcessBuilder("cmd", "/c", "mklink", "/J",
                    link.toString(), target.toString()).redirectErrorStream(true).start();
            process.getInputStream().readAllBytes();
            assertThat(process.waitFor()).isZero();
        } else {
            Files.createSymbolicLink(link, target);
        }
    }
}
