# EOG Night-Shift Operator Console

HackUTD: ZeroDay, EOG Resources track ("Beat the Shutdown"). A console for night-shift operators
that finds failing pumps, pipeline leaks and worn pumps from sensor data, counts down to the
automatic shutdown, and recommends the lowest-cost response: send trucks, shut in wells early,
or let it trip.

## What it does

- **Finds every problem from the sensor readings alone.** Pump failures, pipeline leaks and worn
  pumps, each with plain-English evidence and a confidence score. Early warnings appear before a
  slow problem crosses the alert threshold.
- **Counts down to shutdown** for every failing pump, from the tank's live level and fill rate.
- **Picks the cheapest plan**: every mix of trucks (how many, how many trips), wells to shut in
  and the latest safe minute to shut them in, simulated against the tank until the repair is done.
  Failures in the same system are planned together because they share one truck fleet.
- **Alerts in the required order**: pump failures by soonest shutdown (ties by revenue at stake),
  then leaks, then worn pumps.
- **Replays the recorded week** on a timeline. Problems appear when the readings first show them,
  countdowns tick, tanks fill on the map, and you can pause on any moment to get the plans
  "as if it were now".
- **Recorded weather**: the temperature, rain and storms that actually occurred at each city at the
  replay time (Open-Meteo historical data), with alerts for storms and high wind.
- **Any dataset, no code changes**: drop a folder into `data/` or upload it from the browser.

## Layout

```
data/                 Datasets: each folder holds network.json, ops.json, telemetry.csv
backend/python/       Analysis engine: detection, countdowns, cost optimizer -> JSON
backend/springboot/   REST API: datasets, uploads, analysis; dataset upload page
frontend/             React console: map, timeline, alerts, costs, trucks
```

## Run it

You need Python 3.10+ with pandas, Java 17+ with Maven, and Node 18+.

**1. Python engine** (one time)
```bash
cd backend/python
pip install -r requirements.txt
python score.py ../../data/full_week    # checks detection and plans against the answer key
```

**2. API** (keep this terminal open)
```bash
cd backend/springboot
mvn spring-boot:run
```
Runs on http://localhost:8081. If the API can't find pandas, set `app.python-cmd` in
`backend/springboot/src/main/resources/application.properties` to the output of `which python`.

**3. Frontend** (another terminal)
```bash
cd frontend
npm install
npm run dev
```
Open http://localhost:5173. The header shows **● Backend** when analysis comes from the API; if
the API is down the console falls back to an in-browser engine (**● Offline mode**).

## Loading a new dataset (judging)

Any of these works, and the dataset appears in the **Controls** menu right away:

1. **Copy the folder** into `data/`, e.g. `data/test/network.json`, `ops.json`, `telemetry.csv`.
2. **Upload page**: open http://localhost:8081, pick the three files (or one zip), click Upload.
3. **Command line**:
   ```bash
   curl -F name=test -F network=@network.json -F ops=@ops.json -F telemetry=@telemetry.csv \
        http://localhost:8081/api/datasets
   ```

Then open **Controls → Data**, click **↻ Refresh list** and pick **TEST · judging data**.

The app reads only `network.json`, `ops.json` and `telemetry.csv`; answer keys are never loaded
(the API refuses to serve them). "Now" is the last timestamp in the telemetry, not the clock.

## Demo flow

1. Load a dataset at its latest moment: walk through the alerts, countdowns and best plans, with
   the cost of doing nothing next to each.
2. Press **▶ Replay week** (30× runs a week in about a minute) and watch problems appear and clear.
3. Click a cluster of red markers on the timeline to pause during simultaneous failures and show
   how the shared trucks are split, with a late well shut-in where trucks run out.

## API

| Method | Path | Returns |
|---|---|---|
| GET | `/api/health` | Status and the data directory in use |
| GET | `/api/datasets` | Every dataset folder in `data/`, with readable names |
| POST | `/api/datasets` | Upload a dataset (multipart: `name` + `network`, `ops`, `telemetry`, or `zip`) |
| GET | `/api/analysis?dataset=X[&now=2026-10-08T12:00:00Z]` | Events, countdowns, plans, alert order, truck schedule |
| GET | `/api/network?dataset=X` | network.json |
| GET | `/api/ops?dataset=X` | ops.json |
| GET | `/data/X/{network.json,ops.json,telemetry.csv}` | Raw files for the map and charts |

## How detection works

Worked out by comparing readings inside and outside the labelled events in the practice week.

| Problem | Signal |
|---|---|
| Pump failure | Pump status reads 2 (fault); flow stops and the tank fills |
| Pipeline leak | While pumping, pipeline-end pressure drops below normal and less water arrives than is pumped; it worsens over time |
| Worn pump | While pumping, discharge pressure and flow drift steadily below normal |

Slow problems are tracked on "pressure minus its healthy value", using only samples where the
pump is running, averaged over the last 8 readings. Normal noise is about 3 psi; an alert fires at
8 psi below normal and an early warning at 4 psi. Healthy pressure is learned from each facility's
own readings when it differs from the spec, so a new network still works. Start times come from
fitting a drop-plus-drift model; when a problem began while the pump was idle, the alert says so
and gives the possible window.

## Results

`python score.py ../../data/full_week` and the three snapshots: **72/72 events found, 0 false
alarms**. Every recommended plan matches the reference plan (same trucks, trips and wells), with
costs within about $20 of the reference figures, including the cases where three tanks share two
trucks.

## Simulated scenarios

`data/simulated-data-1` to `-5` are extra practice weeks generated by
`backend/python/generate_simulated_data.py` from the official network, with their own answer keys.
They are synthetic data, not part of the official challenge files.
