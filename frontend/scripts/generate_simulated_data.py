#!/usr/bin/env python3
"""
Generate simulated datasets in the same format as public/data/full_week.

Each output folder (public/data/simulated-data-N) gets:
  network.json     copied unchanged from the source folder
  ops.json         copied, with dataset_id set to "simulated_N"
  telemetry.csv    5-minute readings for every series, same row order as the source
  answer_key.json  every event that started by "now" (for checking only, never load in the app)

Physics follows Instructions/HackUTD-ZeroDay-main/SPEC.md and constants measured
from full_week/telemetry.csv:
  - healthy pump runs at max_flow_bpd (~0.6% noise), sawtooth between setpoints
  - pump_failure: status 2, flow 0, tank fills at inflow until repair (expected_repair_hours)
    or shutdown %, at which point the wells shut in (status 0, water 0) and level holds
  - pump_degradation: running flow falls linearly to ~86% of max, discharge psi drops
  - pipeline_leak: receive flow loss grows ~1% -> ~8-13%, pipeline pressure drops

Usage: python3 scripts/generate_simulated_data.py   (run from frontend/)
"""
import csv
import json
import math
import random
import shutil
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent / "public" / "data"
SOURCE = ROOT / "full_week"
STEP = 300  # seconds between readings

# One scenario per output folder: start date, hours of data, and event mix.
SCENARIOS = [
    # n, start (UTC, Monday), hours until "now", ongoing-cluster size (0 = none)
    dict(n=1, start="2026-10-12T00:00:00Z", hours=84.0, cluster=3, seed=101),
    dict(n=2, start="2026-10-19T00:00:00Z", hours=62.5, cluster=2, seed=202),
    dict(n=3, start="2026-10-26T00:00:00Z", hours=75.0, cluster=3, seed=303),
    dict(n=4, start="2026-11-02T00:00:00Z", hours=90.0, cluster=1, seed=404),
    dict(n=5, start="2026-11-09T00:00:00Z", hours=70.0, cluster=0, seed=505),
]


def iso(ts: int) -> str:
    return datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def to_unix(s: str) -> int:
    return int(datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


def fmt(v: float) -> str:
    return f"{round(v, 1):.1f}"


class Planner:
    """Picks non-overlapping event windows per facility."""

    def __init__(self, rng, facilities, t0, now):
        self.rng, self.t0, self.now = rng, t0, now
        self.facilities = facilities
        self.busy = {f["id"]: [] for f in facilities}

    def free(self, fid, a, b, pad=2 * 3600):
        return all(b + pad <= x or a >= y + pad for x, y in self.busy[fid])

    def take(self, fid, a, b):
        self.busy[fid].append((a, b))

    def grid(self, t):  # snap to 10-minute grid
        return self.t0 + int(round((t - self.t0) / 600.0)) * 600


def build_events(sc, net, ops, t0, now):
    rng = random.Random(sc["seed"])
    systems = net["systems"]
    facs = [(s["id"], f) for s in systems for f in s["facilities"]]
    plan = Planner(rng, [f for _, f in facs], t0, now)
    repair = ops["expected_repair_hours"]["pump_failure"] * 3600
    events = []

    def add(cat, sid, f, onset, end, **kw):
        asset = f["pipeline"]["id"] if cat == "pipeline_leak" else f["pump"]["id"]
        events.append(dict(category=cat, system=sid, facility=f["id"], asset=asset,
                           onset=onset, end=end, fac=f, **kw))
        plan.take(f["id"], onset, end)

    # 1. Ongoing failure cluster: several pumps in one system fail within ~1 hour.
    if sc["cluster"]:
        sys_pick = rng.choice([s for s in systems if len(s["facilities"]) >= sc["cluster"]])
        members = rng.sample(sys_pick["facilities"], sc["cluster"])
        base = plan.grid(now - rng.uniform(1.5, 3.5) * 3600)
        for i, f in enumerate(members):
            onset = base + i * 1800
            add("pump_failure", sys_pick["id"], f, onset, onset + repair)

    # 2. Leaks and worn pumps (one of each left ongoing at "now").
    for cat, count in (("pipeline_leak", 2), ("pump_degradation", 2)):
        for i in range(count):
            for _ in range(200):
                sid, f = rng.choice(facs)
                dur = rng.uniform(20, 28) * 3600 if cat == "pipeline_leak" else rng.uniform(24, 36) * 3600
                if i == 0:  # ongoing: started recently enough to still be running at now
                    onset = plan.grid(now - rng.uniform(6, 14) * 3600)
                else:
                    onset = plan.grid(t0 + rng.uniform(4, 30) * 3600)
                end = onset + dur
                if plan.free(f["id"], onset, end):
                    extra = {}
                    if cat == "pipeline_leak":
                        extra["leak_max"] = rng.uniform(0.08, 0.13)
                    else:
                        extra["degr_min"] = rng.uniform(0.85, 0.88)
                    add(cat, sid, f, onset, end, **extra)
                    break

    # 3. A worn pump that later fails outright (two separate events, per SPEC).
    for _ in range(200):
        sid, f = rng.choice(facs)
        onset = plan.grid(t0 + rng.uniform(2, 20) * 3600)
        dur = rng.uniform(28, 36) * 3600
        fail_on = plan.grid(onset + dur)
        if fail_on + repair < now - 3600 and plan.free(f["id"], onset, fail_on + repair):
            add("pump_degradation", sid, f, onset, fail_on, degr_min=rng.uniform(0.85, 0.88))
            add("pump_failure", sid, f, fail_on, fail_on + repair)
            break

    # 4. Standalone failures earlier in the window (resolved by now).
    for _ in range(3):
        for _ in range(200):
            sid, f = rng.choice(facs)
            onset = plan.grid(t0 + rng.uniform(3, sc["hours"] - 10) * 3600)
            if onset + repair < now - 1800 and plan.free(f["id"], onset, onset + repair):
                add("pump_failure", sid, f, onset, onset + repair)
                break

    events.sort(key=lambda e: e["onset"])
    return events


def simulate(sc, net, ops, order, t0, now, events):
    rng = random.Random(sc["seed"] * 7 + 1)
    shutdown = net["defaults"]["tank_limits_pct"]["shutdown"]
    steps = int((now - t0) // STEP) + 1
    by_fac = {}
    for e in events:
        by_fac.setdefault(e["facility"], []).append(e)

    disp_psi = {f["id"]: s["disposal_site"]["pressure_psi"] for s in net["systems"] for f in s["facilities"]}
    facs = {f["id"]: f for s in net["systems"] for f in s["facilities"]}

    # Per-facility state
    state = {}
    for fid, f in facs.items():
        p = f["pump"]
        lvl = rng.uniform(p["stop_level_pct"] + 5, p["start_level_pct"] - 5)
        state[fid] = dict(bbl=lvl / 100 * f["tank"]["capacity_bbl"], running=rng.random() < 0.4, shut=False)

    readings = {}  # (asset, metric) -> list of values per step
    trace = {fid: [] for fid in facs}  # true level per step, for the answer key

    def put(asset, metric, i, v):
        readings.setdefault((asset, metric), [None] * steps)[i] = v

    for i in range(steps):
        t = t0 + i * STEP
        for fid, f in facs.items():
            st = state[fid]
            cap = f["tank"]["capacity_bbl"]
            p = f["pump"]
            evs = by_fac.get(fid, [])
            fault = any(e["category"] == "pump_failure" and e["onset"] <= t < e["end"] for e in evs)
            degr, leak = 1.0, 0.0
            for e in evs:
                if not (e["onset"] <= t < e["end"]):
                    continue
                frac = (t - e["onset"]) / (e["end"] - e["onset"])
                if e["category"] == "pump_degradation":
                    degr = 1 - (1 - e["degr_min"]) * frac
                elif e["category"] == "pipeline_leak":
                    leak = 0.01 + (e["leak_max"] - 0.01) * frac
            if not fault:
                st["shut"] = False  # repair done: wells resume immediately

            # Wells and inflow
            inflow = 0.0
            for w in f["wells"]:
                if st["shut"]:
                    put(w["id"], "water_bpd", i, "0.0")
                    put(w["id"], "status", i, "0")
                else:
                    wv = round(w["baseline_water_bpd"] * (1 + rng.gauss(0, 0.006)), 1)
                    inflow += wv
                    put(w["id"], "water_bpd", i, fmt(wv))
                    put(w["id"], "status", i, "1")
            put(fid, "inflow_bpd", i, fmt(inflow))

            # Pump state
            lvl = st["bbl"] / cap * 100
            if fault:
                pstat, flow = 2, 0.0
            else:
                if st["running"] and lvl <= p["stop_level_pct"]:
                    st["running"] = False
                elif not st["running"] and lvl >= p["start_level_pct"]:
                    st["running"] = True
                pstat = 1 if st["running"] else 0
                flow = p["max_flow_bpd"] * degr * (1 + rng.gauss(0, 0.006)) if st["running"] else 0.0

            # Record tank level (before this step's change), exact 92 while shut in
            shown = float(shutdown) if st["shut"] else max(0.0, lvl + rng.gauss(0, 0.02))
            put(f["tank"]["id"], "level_pct", i, f"{round(shown, 2)}")
            trace[fid].append(lvl)

            dp = disp_psi[fid]
            put(p["id"], "status", i, str(pstat))
            put(p["id"], "flow_bpd", i, fmt(flow))
            if pstat == 1:
                put(p["id"], "discharge_psi", i, fmt(dp + 150 - (1 - degr) * 400 + rng.gauss(0, 2.5)))
                put(f["pipeline"]["id"], "receive_flow_bpd", i, fmt(flow * (1 - leak) * (1 + rng.gauss(0, 0.003))))
                put(f["pipeline"]["id"], "pressure_psi", i, fmt(dp + 50 - leak * 700 + rng.gauss(0, 2.5)))
            else:
                put(p["id"], "discharge_psi", i, fmt(dp + rng.gauss(0, 2.5)))
                put(f["pipeline"]["id"], "receive_flow_bpd", i, "0.0")
                put(f["pipeline"]["id"], "pressure_psi", i, fmt(dp + rng.gauss(0, 2.5)))

            # Advance tank volume to the next step
            if not st["shut"]:
                st["bbl"] = max(0.0, st["bbl"] + (inflow - flow) * STEP / 86400)
                if fault and st["bbl"] / cap * 100 >= shutdown:
                    st["bbl"] = shutdown / 100 * cap
                    st["shut"] = True  # automatic shut-in

    return readings, trace, steps


def answer_key(net, ops, events, trace, t0, now):
    shutdown = net["defaults"]["tank_limits_pct"]["shutdown"]
    prices = ops["prices"]
    out = []
    ongoing_fail = []
    for e in events:
        if e["onset"] > now:
            continue
        f = e["fac"]
        resolved = e["end"] <= now
        rec = dict(id=None, system=e["system"], facility=e["facility"], asset=e["asset"],
                   category=e["category"], onset=iso(e["onset"]), onset_unix=e["onset"])
        if e["category"] != "pump_failure":
            rec.update(end=iso(e["end"]) if resolved else None,
                       end_unix=e["end"] if resolved else None,
                       reference_action="field_inspection",
                       status="resolved" if resolved else "ongoing")
            out.append(rec)
            continue

        cap = f["tank"]["capacity_bbl"]
        inflow_bph = sum(w["baseline_water_bpd"] for w in f["wells"]) / 24
        lvl = trace[e["facility"]]
        i_on = (e["onset"] - t0) // STEP
        i_last = min((min(e["end"], now) - t0) // STEP, len(lvl) - 1)
        rec["level_pct"] = round(lvl[i_on])

        # Trip time: first crossing of shutdown in the simulated trace, else projection.
        trips = None
        for i in range(i_on, i_last + 1):
            if lvl[i] >= shutdown - 1e-6:
                prev = lvl[i - 1]
                frac = (shutdown - prev) / max(1e-9, lvl[i] - prev)
                trips = t0 + (i - 1) * STEP + int(frac * STEP)
                break
        if trips is None:
            hrs = (shutdown - lvl[i_last]) * cap / 100 / inflow_bph
            proj = t0 + i_last * STEP + int(hrs * 3600)
            trips = proj if proj < e["end"] else None
        trips = None if trips is None else int(round(trips / 60.0)) * 60
        rec.update(trips_at=iso(trips) if trips else None, trips_at_unix=trips,
                   end=iso(e["end"]) if resolved else None,
                   end_unix=e["end"] if resolved else None)
        if trips is None:
            peak = max(lvl[i_on:i_last + 1])
            if not resolved:
                peak = lvl[i_last] + (e["end"] - now) / 3600 * inflow_bph / cap * 100
            rec["reference_action"] = f"none (peaks ~{peak:.1f}%, never trips)"
        else:
            # Cheapest-plan optimisation belongs to the backend; not computed here.
            rec["reference_action"] = None
            rec["reference_action_note"] = "not computed by the generator; score plans with the backend optimizer"
        rec["status"] = "resolved" if resolved else "ongoing"
        if not resolved:
            lvl_now = lvl[len(lvl) - 1]
            tripped = trips is not None and trips <= now
            rec["level_final_pct"] = float(shutdown) if tripped else round(lvl_now, 1)
            rec["hours_to_limit_final"] = 0.0 if tripped else round((shutdown - lvl_now) * cap / 100 / inflow_bph, 1)
            rec["lost_revenue_per_hour"] = round(sum(
                w["oil_bpd"] * prices["oil_per_bbl"] + w["gas_mcfd"] * prices["gas_per_mcf"] for w in f["wells"]) / 24, 1)
            ongoing_fail.append(rec)
        out.append(rec)

    # Alerts-view order for ongoing pump failures
    ongoing_fail.sort(key=lambda r: (r["hours_to_limit_final"], -r["lost_revenue_per_hour"]))
    for k, r in enumerate(ongoing_fail, 1):
        r["order"] = k
    for k, r in enumerate(out, 1):
        r["id"] = f"EVENT_{k}"
    return out


def main():
    net = json.loads((SOURCE / "network.json").read_text())
    ops = json.loads((SOURCE / "ops.json").read_text())

    # Row order inside one timestamp, copied from the source CSV
    order = []
    with open(SOURCE / "telemetry.csv") as fh:
        rd = csv.reader(fh)
        next(rd)
        first_ts = None
        for row in rd:
            if first_ts is None:
                first_ts = row[1]
            if row[1] != first_ts:
                break
            order.append((row[2], row[3]))

    for sc in SCENARIOS:
        t0 = to_unix(sc["start"])
        now = t0 + int(sc["hours"] * 3600)
        now -= (now - t0) % STEP
        events = build_events(sc, net, ops, t0, now)
        readings, trace, steps = simulate(sc, net, ops, order, t0, now, events)

        out_dir = ROOT / f"simulated-data-{sc['n']}"
        out_dir.mkdir(parents=True, exist_ok=True)
        shutil.copy(SOURCE / "network.json", out_dir / "network.json")
        ops_out = dict(ops, dataset_id=f"simulated_{sc['n']}")
        (out_dir / "ops.json").write_text(json.dumps(ops_out, indent=2) + "\n")

        with open(out_dir / "telemetry.csv", "w", newline="") as fh:
            wr = csv.writer(fh, lineterminator="\n")
            wr.writerow(["timestamp", "ts_unix", "asset_id", "metric", "value"])
            for i in range(steps):
                t = t0 + i * STEP
                ts = iso(t)
                for asset, metric in order:
                    wr.writerow([ts, t, asset, metric, readings[(asset, metric)][i]])

        key = answer_key(net, ops, events, trace, t0, now)
        (out_dir / "answer_key.json").write_text(json.dumps(key, indent=2) + "\n")
        n_on = sum(1 for e in key if e["status"] == "ongoing")
        print(f"simulated-data-{sc['n']}: now={iso(now)} rows={steps * len(order)} events={len(key)} ongoing={n_on}")


if __name__ == "__main__":
    main()
