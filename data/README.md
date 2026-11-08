# Datasets

Each folder here is one dataset with three files:

```
<name>/network.json
<name>/ops.json
<name>/telemetry.csv
```

To add the judging data, copy its folder in as `data/test/` (or upload it at http://localhost:8081).
It appears in the console's dataset list right away.

| Folder | "Now" (UTC) | Notes |
|---|---|---|
| `full_week/` | Sun 10-11 23:55 | Whole practice week, every event resolved |
| `snapshot_2026-10-08T1200/` | Thu 10-08 12:00 | Three S2 pump failures sharing two trucks |
| `snapshot_2026-10-09T0330/` | Fri 10-09 03:30 | S4 pump failure, a leak |
| `snapshot_2026-10-10T0900/` | Sat 10-10 09:00 | Three S4 pump failures sharing two trucks |
| `mock_test_2026-10-10T1530/` | Sat 10-10 15:30 | Dress rehearsal, no answer key |

`answer_key.json` files are for `backend/python/score.py` only. The app never reads them.
