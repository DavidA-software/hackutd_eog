# EOG Night-Shift Operator Console

HackUTD: ZeroDay, EOG Resources track ("Beat the Shutdown"). A console that finds failing pumps,
pipeline leaks and worn pumps from sensor data, counts down to shutdown, and recommends the
lowest-cost response: trucks, shutting in wells, or letting it trip.

## Layout

```
data/                 Datasets. Each folder holds network.json, ops.json, telemetry.csv
backend/python/       Analysis engine: detection, countdowns, cost optimizer -> JSON
backend/springboot/   REST API: datasets, uploads, analysis; serves the dataset upload page
frontend/             React console (map, alerts, trucks, costs)
```

## Run it

You need Python 3.10+, Java 17+ with Maven, and Node 18+.

**1. Python engine** (one time)
```bash
cd backend/python
pip install -r requirements.txt
python analyze.py ../../data/full_week     # prints the analysis JSON
python score.py ../../data                 # checks results against the practice answer keys
```

**2. API** (keep this terminal open)
```bash
cd backend/springboot
mvn spring-boot:run
```
Open http://localhost:8081 for the dataset page, or http://localhost:8081/api/datasets.
If `python3` isn't the Python with pandas installed (for example with conda), set its full path
in `backend/springboot/src/main/resources/application.properties` (`app.python-cmd`, use the
output of `which python`).

**3. Frontend** (another terminal)
```bash
cd frontend
npm install
npm run dev
```

## Loading a new dataset (judging)

Any of these works; the dataset shows up in the list immediately, no code changes:

1. **Copy the folder** into `data/`, e.g. `data/test/network.json`, `data/test/ops.json`, `data/test/telemetry.csv`.
2. **Upload page:** open http://localhost:8081, pick the three files (or one zip of them), click Upload.
3. **Command line:**
   ```bash
   curl -F name=test -F network=@network.json -F ops=@ops.json -F telemetry=@telemetry.csv \
        http://localhost:8081/api/datasets
   ```
4. **Analyze a folder anywhere** without the API: `python backend/python/analyze.py /path/to/test`

The app reads only `network.json`, `ops.json` and `telemetry.csv`. Answer keys are never loaded
(the API refuses to serve them). "Now" is the last timestamp in the telemetry, not the clock.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | Status and the data directory in use |
| GET | `/api/datasets` | Every dataset folder found in `data/` |
| POST | `/api/datasets` | Upload a dataset (multipart: `name` + `network`, `ops`, `telemetry`, or `zip`) |
| GET | `/api/analysis?dataset=X[&now=2026-10-08T12:00:00Z]` | Events, countdowns, plans, alert order, truck schedule |
| GET | `/api/network?dataset=X` | network.json |
| GET | `/api/ops?dataset=X` | ops.json |
| GET | `/data/X/{network.json,ops.json,telemetry.csv}` | Raw files (same paths the frontend loader uses) |

To route the frontend through the API, add a proxy to `frontend/vite.config.ts`:
```ts
server: { proxy: { '/api': 'http://localhost:8081', '/data': 'http://localhost:8081' } },
```

## How detection works

Worked out by comparing readings inside and outside the labelled events in the practice week.

| Problem | Signal |
|---|---|
| Pump failure | Pump status reads 2 (fault); flow stops and the tank fills |
| Pipeline leak | While pumping, pipeline-end pressure drops below normal and less water arrives than is pumped; it worsens over time |
| Worn pump | While pumping, discharge pressure and flow drift steadily below normal |

Slow problems are tracked on "pressure minus its healthy value" using only samples where the pump
is running, averaged over the last 8 readings. Normal noise is about 3 psi; an alert fires at
8 psi below normal, and an early warning ("predicted") at 4 psi. Start times are estimated by
fitting a drop-plus-drift model; when a problem began while the pump was idle, the alert says so
and gives the possible window.

## How plans are chosen

For each pump failure, every combination of trucks (count and trips), wells to shut in, and
shut-in start time (latest safe minute) is simulated against the tank until the repair finishes.
The cheapest plan that keeps the tank under shutdown wins, unless letting it trip is cheaper.
Failures in the same system are planned together because they share one truck fleet.

## Results on the practice data

`python score.py ../../data`: **72/72 events found, 0 false alarms** across the full week and all
three snapshots. Every recommended plan matches the reference plan's choice (same trucks, trips
and wells), with costs within about $20 of the reference figures.
