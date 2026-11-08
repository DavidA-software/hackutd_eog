package com.hackutd.eog.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * A dataset is any folder inside the data directory holding network.json, ops.json and
 * telemetry.csv. Judges can add one by dropping a folder in, or by uploading the three files
 * (or a zip of them) through POST /api/datasets or the upload page at http://localhost:8080/.
 */
@Service
public class DatasetService {

    public static final List<String> REQUIRED = List.of("network.json", "ops.json", "telemetry.csv");
    private static final Pattern SAFE_NAME = Pattern.compile("^[A-Za-z0-9_.-]{1,80}$");

    private final Path dataDir;

    public DatasetService(@Value("${app.data-dir}") String dataDir) throws IOException {
        this.dataDir = Path.of(dataDir).toAbsolutePath().normalize();
        Files.createDirectories(this.dataDir);
    }

    public Path dataDir() {
        return dataDir;
    }

    public List<Map<String, Object>> list() throws IOException {
        List<Map<String, Object>> out = new ArrayList<>();
        try (Stream<Path> dirs = Files.list(dataDir)) {
            for (Path d : dirs.filter(Files::isDirectory).sorted().toList()) {
                if (isDataset(d)) {
                    String name = d.getFileName().toString();
                    out.add(Map.of(
                            "name", name,
                            "path", name,
                            "description", describe(name)));
                }
            }
        }
        return out;
    }

    private static String describe(String name) {
        if (name.equals("test")) return "Judging dataset";
        if (name.startsWith("mock_test")) return "Dress rehearsal (no answer key)";
        if (name.startsWith("snapshot")) return "Week cut early, problems in progress";
        if (name.equals("full_week")) return "Whole practice week";
        return "Uploaded dataset";
    }

    public boolean isDataset(Path folder) {
        return REQUIRED.stream().allMatch(f -> Files.isRegularFile(folder.resolve(f)));
    }

    /** Resolve a dataset name to its folder, refusing anything outside the data directory. */
    public Path folder(String name) {
        if (name == null || !SAFE_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("Invalid dataset name: " + name);
        }
        Path folder = dataDir.resolve(name).normalize();
        if (!folder.getParent().equals(dataDir) || !isDataset(folder)) {
            throw new IllegalArgumentException("Dataset not found: " + name);
        }
        return folder;
    }

    /** Only the three challenge files may be read through the API; never answer keys. */
    public Path file(String dataset, String file) {
        if (!REQUIRED.contains(file)) {
            throw new IllegalArgumentException("Not an allowed file: " + file);
        }
        return folder(dataset).resolve(file);
    }

    /** Save an uploaded dataset: either the three files, or one zip containing them. */
    public String save(String name, Map<String, MultipartFile> files, MultipartFile zip) throws IOException {
        if (name == null || !SAFE_NAME.matcher(name).matches()) {
            throw new IllegalArgumentException("Dataset name may use letters, numbers, _ . - only");
        }
        Path target = dataDir.resolve(name).normalize();
        if (!target.getParent().equals(dataDir)) {
            throw new IllegalArgumentException("Invalid dataset name");
        }
        Path staging = Files.createTempDirectory(dataDir, ".upload-");
        try {
            if (zip != null && !zip.isEmpty()) {
                unzipRequired(zip.getInputStream(), staging);
            } else {
                for (String f : REQUIRED) {
                    MultipartFile part = files.get(f);
                    if (part == null || part.isEmpty()) {
                        throw new IllegalArgumentException("Missing " + f);
                    }
                    part.transferTo(staging.resolve(f));
                }
            }
            if (!isDataset(staging)) {
                throw new IllegalArgumentException("Upload must contain network.json, ops.json and telemetry.csv");
            }
            Files.createDirectories(target);
            for (String f : REQUIRED) {
                Files.move(staging.resolve(f), target.resolve(f), StandardCopyOption.REPLACE_EXISTING);
            }
            return name;
        } finally {
            try (Stream<Path> left = Files.list(staging)) {
                for (Path p : left.toList()) Files.deleteIfExists(p);
            }
            Files.deleteIfExists(staging);
        }
    }

    /** Pull the three required files out of a zip, wherever they sit inside it. */
    private void unzipRequired(InputStream in, Path staging) throws IOException {
        try (ZipInputStream zin = new ZipInputStream(in)) {
            ZipEntry e;
            while ((e = zin.getNextEntry()) != null) {
                if (e.isDirectory() || e.getName().contains("__MACOSX")) continue;
                String base = Path.of(e.getName()).getFileName().toString();
                if (REQUIRED.contains(base)) {
                    Files.copy(zin, staging.resolve(base), StandardCopyOption.REPLACE_EXISTING);
                }
            }
        }
    }
}
