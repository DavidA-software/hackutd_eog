package com.hackutd.eog.service;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.TimeUnit;
import java.util.regex.Pattern;

/**
 * Runs backend/python/analyze.py for a dataset and caches the JSON it returns.
 * The cache key includes the files' modification times, so re-uploading a dataset refreshes it.
 */
@Service
public class AnalysisService {

    private static final Pattern ISO_UTC = Pattern.compile("^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}Z$");

    private final DatasetService datasets;
    private final String pythonCmd;
    private final Path script;
    private final long timeoutSeconds;
    private final Map<String, String> cache = new ConcurrentHashMap<>();

    public AnalysisService(DatasetService datasets,
                           @Value("${app.python-cmd}") String pythonCmd,
                           @Value("${app.analyze-script}") String script,
                           @Value("${app.analysis-timeout-seconds:120}") long timeoutSeconds) {
        this.datasets = datasets;
        this.pythonCmd = pythonCmd;
        this.script = Path.of(script).toAbsolutePath().normalize();
        this.timeoutSeconds = timeoutSeconds;
    }

    public String analyze(String dataset, String now) throws IOException, InterruptedException {
        Path folder = datasets.folder(dataset);
        if (now != null && !now.isBlank() && !ISO_UTC.matcher(now).matches()) {
            throw new IllegalArgumentException("now must look like 2026-10-08T12:00:00Z");
        }
        String key = dataset + "|" + (now == null ? "" : now) + "|" + stamp(folder);
        String cached = cache.get(key);
        if (cached != null) return cached;

        List<String> cmd = new ArrayList<>(List.of(pythonCmd, script.toString(), folder.toString()));
        if (now != null && !now.isBlank()) {
            cmd.add("--now");
            cmd.add(now);
        }
        Path out = Files.createTempFile("analysis-", ".json");
        Path err = Files.createTempFile("analysis-", ".log");
        try {
            Process p = new ProcessBuilder(cmd)
                    .directory(script.getParent().toFile())
                    .redirectOutput(out.toFile())
                    .redirectError(err.toFile())
                    .start();
            if (!p.waitFor(timeoutSeconds, TimeUnit.SECONDS)) {
                p.destroyForcibly();
                throw new IllegalStateException("Analysis timed out after " + timeoutSeconds + "s");
            }
            if (p.exitValue() != 0) {
                throw new IllegalStateException("Analysis failed: " + Files.readString(err, StandardCharsets.UTF_8));
            }
            String json = Files.readString(out, StandardCharsets.UTF_8);
            cache.put(key, json);
            return json;
        } finally {
            Files.deleteIfExists(out);
            Files.deleteIfExists(err);
        }
    }

    private String stamp(Path folder) throws IOException {
        StringBuilder sb = new StringBuilder();
        for (String f : DatasetService.REQUIRED) {
            sb.append(Files.getLastModifiedTime(folder.resolve(f)).toMillis()).append(':');
        }
        return sb.toString();
    }
}
