package com.hackutd.eog.controller;

import com.hackutd.eog.service.AnalysisService;
import com.hackutd.eog.service.DatasetService;
import org.springframework.core.io.FileSystemResource;
import org.springframework.core.io.Resource;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.nio.file.Files;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

@RestController
public class ApiController {

    private final DatasetService datasets;
    private final AnalysisService analysis;

    public ApiController(DatasetService datasets, AnalysisService analysis) {
        this.datasets = datasets;
        this.analysis = analysis;
    }

    @GetMapping("/api/health")
    public Map<String, Object> health() {
        return Map.of("status", "ok", "dataDir", datasets.dataDir().toString());
    }

    /** Every dataset folder found in the data directory, including test/ once it's added. */
    @GetMapping("/api/datasets")
    public List<Map<String, Object>> list() throws IOException {
        return datasets.list();
    }

    /**
     * Add a dataset. Send multipart form data with a "name" plus either the three files
     * ("network", "ops", "telemetry") or one "zip" containing them.
     *   curl -F name=test -F network=@network.json -F ops=@ops.json -F telemetry=@telemetry.csv \
     *        http://localhost:8081/api/datasets
     */
    @PostMapping(value = "/api/datasets", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Map<String, Object> upload(@RequestParam String name,
                                      @RequestParam(required = false) MultipartFile network,
                                      @RequestParam(required = false) MultipartFile ops,
                                      @RequestParam(required = false) MultipartFile telemetry,
                                      @RequestParam(required = false) MultipartFile zip) throws IOException {
        Map<String, MultipartFile> files = new HashMap<>();
        if (network != null) files.put("network.json", network);
        if (ops != null) files.put("ops.json", ops);
        if (telemetry != null) files.put("telemetry.csv", telemetry);
        String saved = datasets.save(name.trim(), files, zip);
        return Map.of("saved", saved, "datasets", datasets.list());
    }

    /** Events, countdowns, cost plans and truck schedules. `now` is optional (time travel). */
    @GetMapping(value = "/api/analysis", produces = MediaType.APPLICATION_JSON_VALUE)
    public String analysis(@RequestParam String dataset, @RequestParam(required = false) String now)
            throws IOException, InterruptedException {
        return analysis.analyze(dataset, now);
    }

    @GetMapping(value = "/api/network", produces = MediaType.APPLICATION_JSON_VALUE)
    public String network(@RequestParam String dataset) throws IOException {
        return Files.readString(datasets.file(dataset, "network.json"));
    }

    @GetMapping(value = "/api/ops", produces = MediaType.APPLICATION_JSON_VALUE)
    public String ops(@RequestParam String dataset) throws IOException {
        return Files.readString(datasets.file(dataset, "ops.json"));
    }

    /**
     * Raw files at the same paths the frontend already fetches (/data/{dataset}/{file}),
     * so its loader works unchanged through the Vite proxy. Answer keys are never served.
     */
    @GetMapping("/data/{dataset}/{file}")
    public ResponseEntity<Resource> raw(@PathVariable String dataset, @PathVariable String file) {
        MediaType type = file.endsWith(".csv") ? MediaType.parseMediaType("text/csv") : MediaType.APPLICATION_JSON;
        return ResponseEntity.ok().contentType(type).body(new FileSystemResource(datasets.file(dataset, file)));
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException e) {
        return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(Map.of("error", e.getMessage()));
    }

    @ExceptionHandler(IllegalStateException.class)
    public ResponseEntity<Map<String, String>> failed(IllegalStateException e) {
        return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(Map.of("error", e.getMessage()));
    }
}
