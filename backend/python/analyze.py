"""
Beat the Shutdown - analysis engine.

    python analyze.py <dataset_folder> [--now 2026-10-08T12:00:00Z] [--out analysis.json]

Reads only network.json, ops.json and telemetry.csv from the folder. "Now" is the last
timestamp in the telemetry (or --now for time travel), never the system clock.

Output events use the same shape as the frontend's DetectedEvent type (frontend/src/types.ts).
"""
import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from detect import detect_all
from loader import Dataset, load_dataset
from planner import Plan, Situation, Well, best_plans, cheapest, plan_system

INFLOW_AVG_S = 30 * 60


def iso(unix):
    return None if unix is None else datetime.fromtimestamp(int(unix), timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(text):
    return int(datetime.strptime(text, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc).timestamp())


# ── Building a planning situation from the readings ──────────────────────────

def well_revenue_per_hour(well, prices):
    return (well["oil_bpd"] * prices["oil_per_bbl"] + well["gas_mcfd"] * prices["gas_per_mcf"]) / 24


def situation_at(ds: Dataset, system, fac, onset_unix, t0) -> Situation:
    ops, prices = ds.ops, ds.ops["prices"]
    limits = ds.network["defaults"]["tank_limits_pct"]
    cap = fac["tank"]["capacity_bbl"]
    i = ds.index_at(t0)
    lo = ds.index_at(t0 - INFLOW_AVG_S)

    wells, all_off = [], True
    for w in fac["wells"]:
        on = ds.get(w["id"], "status")[i] == 1
        all_off &= not on
        live = float(np.mean(ds.get(w["id"], "water_bpd")[lo:i + 1]))
        base = float(w["baseline_water_bpd"])
        # Use the well's declared rate unless the live (noisy) reading says it has really changed.
        water_bpd = (base if abs(live - base) <= 0.1 * base else live) if on else 0.0
        wells.append(Well(w["id"], water_bpd / 24, well_revenue_per_hour(w, prices)))

    level = float(ds.get(fac["tank"]["id"], "level_pct")[i])
    tripped = all_off and level >= limits["shutdown"] - 0.5
    if tripped:  # wells are off only because of the trip: cost is their full revenue
        wells = [Well(w["id"], 0.0, well_revenue_per_hour(w, prices)) for w in fac["wells"]]

    fops = ops["systems"][system["id"]]["facilities"][fac["id"]]
    repair_end = onset_unix + ops["expected_repair_hours"]["pump_failure"] * 3600
    return Situation(
        facility=fac["id"],
        volume_bbl=level / 100 * cap,
        capacity_bbl=cap,
        shutdown_bbl=limits["shutdown"] / 100 * cap,
        wells=wells,
        horizon_h=max(0.0, (repair_end - t0) / 3600),
        response_min=fops["response_min"],
        cycle_min=fops["cycle_min"],
        truck_bbl=ops["emergency_trucking"]["truck_capacity_bbl"],
        trip_cost=ops["emergency_trucking"]["cost_per_trip"],
        tripped=tripped,
    )


# ── Converting plans to the frontend's types ─────────────────────────────────

def describe(p: Plan, s: Situation) -> str:
    parts = []
    if p.trucks:
        parts.append(f"{p.trucks} truck{'s' if p.trucks > 1 else ''}, "
                     f"{p.trips_per_truck} trip{'s' if p.trips_per_truck > 1 else ''} each")
    if p.shut_in:
        parts.append(f"shut in {', '.join(p.shut_in)} at +{p.shut_in_at_min:.0f} min")
    if parts:
        return "; ".join(parts) + f" (tank peaks ~{p.peak_pct:.0f}%)"
    if s.tripped:
        return f"Already shut in; wells dark for the remaining {p.downtime_h:.1f} h of repair"
    if p.trip_h is None:
        return f"No action needed: tank peaks ~{p.peak_pct:.0f}% and never trips"
    return f"Tank trips in {p.trip_h:.1f} h; wells dark for {p.downtime_h:.1f} h until the repair"


def to_frontend_plan(p: Plan, s: Situation, t0: int, fleet_free: int) -> dict:
    truck = {
        "type": "truck",
        "truck_count": p.trucks,
        "trip_count": p.trucks * p.trips_per_truck,
        "trips_per_truck": p.trips_per_truck,
        "total_cost": round(p.truck_cost),
        "dispatch_time_min": s.response_min,
        "trucks_available": fleet_free,
        "arrivals_unix": [int(t0 + a * 60) for a in p.arrivals_min],
        "description": describe(Plan(trucks=p.trucks, trips_per_truck=p.trips_per_truck, peak_pct=p.peak_pct), s),
    }
    shut = {
        "type": "shut_in",
        "well_id": p.shut_in[0] if p.shut_in else "",
        "well_ids": list(p.shut_in),
        "shut_in_at_min": p.shut_in_at_min,
        "shut_in_hours": round(s.horizon_h - p.shut_in_at_min / 60, 2),
        "total_cost": round(p.shut_in_cost),
        "description": describe(Plan(shut_in=p.shut_in, shut_in_at_min=p.shut_in_at_min, peak_pct=p.peak_pct), s),
    }
    if p.do_nothing:
        return {
            "type": "do_nothing",
            "trips_at_unix": None if p.trip_h is None else int(t0 + p.trip_h * 3600),
            "downtime_hours": round(p.downtime_h, 2),
            "total_cost": round(p.cost),
            "description": describe(p, s),
        }
    if p.trucks and p.shut_in:
        return {"type": "combo", "trucks": truck, "shut_in": shut,
                "total_cost": round(p.cost), "description": describe(p, s)}
    return truck if p.trucks else shut


def spec_actions(p: Plan, fac_id: str) -> list:
    """Actions in the SPEC.md events.json shape."""
    acts = []
    if p.trucks:
        acts.append({"type": "dispatch_truck", "facility_id": fac_id,
                     "trucks": p.trucks, "trips_per_truck": p.trips_per_truck})
    if p.shut_in:
        acts.append({"type": "shut_in_wells", "wells": list(p.shut_in), "start_after_min": int(p.shut_in_at_min)})
    return acts or [{"type": "none"}]


def recommended_action(chosen: Plan, options: dict, s: Situation, t0: int, fleet_free: int) -> dict:
    nothing = options["do_nothing"]
    plans = [p for p in options.values() if p is not None]
    plans.sort(key=lambda p: p.cost)
    return {
        "cheapest": to_frontend_plan(chosen, s, t0, fleet_free),
        "all_plans": [to_frontend_plan(p, s, t0, fleet_free) for p in plans],
        "cost_of_doing_nothing": round(nothing.cost),
        "savings": max(0, round(nothing.cost - chosen.cost)),
        "planned_at_unix": int(t0),
    }


# ── Main analysis ────────────────────────────────────────────────────────────

def severity(ev: dict) -> str:
    if ev["status"] == "predicted":
        return "minor"
    if ev["status"] == "resolved":
        return "minor"
    if ev["category"] == "pipeline_leak":
        return "severe"
    if ev["category"] == "pump_degradation":
        return "major"
    h = ev.get("hours_to_limit")
    cost = ev.get("recommended_action", {}).get("cost_of_doing_nothing", 0)
    if h is not None and h < 1.5:
        return "critical"
    return "severe" if cost > 0 else "major"


def analyze(ds: Dataset) -> dict:
    systems = {s["id"]: s for s in ds.systems()}
    facs = {f["id"]: (s, f) for s, f in ds.facilities()}
    fleet = {sid: ds.ops["systems"][sid]["emergency_fleet_size"] for sid in systems}

    raw = detect_all(ds)
    events = []
    for n, e in enumerate(raw, start=1):
        ev = {
            "id": f"EV-{n:03d}", "system": e.system, "facility": e.facility, "asset": e.asset,
            "category": e.category, "status": e.status,
            "onset_unix": e.onset_unix, "onset_ts": iso(e.onset_unix),
            "end_unix": e.end_unix, "end_ts": iso(e.end_unix),
            "confidence": e.confidence, "evidence": e.evidence,
            "detected_unix": e.detected_unix,
        }
        if e.category != "pump_failure":
            ev["recommended_actions"] = [{"type": "field_inspection", "asset_id": e.asset}]
        events.append(ev)

    failures = [e for e in events if e["category"] == "pump_failure"]

    # Resolved failures: planned at their onset, in order. Trucks stay busy on earlier plans.
    busy = {sid: [] for sid in systems}   # system -> list of busy-until unix per dispatched truck
    for ev in (e for e in failures if e["status"] == "resolved"):
        system, fac = facs[ev["facility"]]
        t0 = ev["onset_unix"]
        free = fleet[system["id"]] - sum(1 for b in busy[system["id"]] if b > t0)
        s = situation_at(ds, system, fac, t0, t0)
        options = best_plans(s, free)
        chosen = cheapest(options)
        busy[system["id"]] += [t0 + (s.response_min + chosen.trips_per_truck * s.cycle_min) * 60] * chosen.trucks
        attach_failure(ev, s, chosen, options, t0, free, fac)

    # Ongoing failures: planned together from "now"; nothing is dispatched yet, whole fleet free.
    now = ds.now_unix
    by_system = {}
    for ev in (e for e in failures if e["status"] == "ongoing"):
        by_system.setdefault(ev["system"], []).append(ev)
    for sid, evs in by_system.items():
        sits = [situation_at(ds, *facs[ev["facility"]], ev["onset_unix"], now) for ev in evs]
        results = plan_system(sits, fleet[sid])
        for ev, s, (chosen, options) in zip(evs, sits, results):
            attach_failure(ev, s, chosen, options, now, fleet[sid], facs[ev["facility"]][1])
            if len(evs) > 1:
                ev["shared_fleet_with"] = [o["id"] for o in evs if o is not ev]

    for ev in events:
        ev["severity"] = severity(ev)

    # Alerts view (SPEC.md): ongoing pump failures by soonest shutdown, ties by revenue at stake;
    # then leaks and worn pumps; early warnings last.
    ongoing_f = [e for e in failures if e["status"] == "ongoing"]
    ongoing_f.sort(key=lambda e: (e["hours_to_limit"] if e["hours_to_limit"] is not None else float("inf"),
                                  -e["lost_revenue_per_hour"]))
    for rank, ev in enumerate(ongoing_f, start=1):
        ev["order"] = rank
    others = [e for e in events if e["status"] == "ongoing" and e["category"] != "pump_failure"]
    others.sort(key=lambda e: (e["category"] != "pipeline_leak", e["onset_unix"]))
    predicted = [e for e in events if e["status"] == "predicted"]
    alerts = [e["id"] for e in ongoing_f + others + predicted]

    return {
        "dataset": ds.name,
        "start_unix": ds.start_unix, "start_ts": iso(ds.start_unix),
        "now_unix": now, "now_ts": iso(now),
        "events": events,
        "alerts": alerts,
        "trucks": truck_schedule(events, ds),
        "summary": {
            "ongoing_pump_failures": len(ongoing_f),
            "ongoing_leaks": sum(e["category"] == "pipeline_leak" for e in others),
            "ongoing_worn_pumps": sum(e["category"] == "pump_degradation" for e in others),
            "early_warnings": len(predicted),
            "resolved": sum(e["status"] == "resolved" for e in events),
            "cost_if_no_action": sum(e["recommended_action"]["cost_of_doing_nothing"] for e in ongoing_f),
            "cost_with_plan": sum(e["recommended_action"]["cheapest"]["total_cost"] for e in ongoing_f),
        },
    }


def attach_failure(ev, s: Situation, chosen: Plan, options: dict, t0: int, free: int, fac):
    q = s.inflow_bph
    hours = 0.0 if s.tripped else ((s.shutdown_bbl - s.volume_bbl) / q if q > 0 else None)
    ev.update({
        "level_pct": round(100 * s.volume_bbl / s.capacity_bbl, 1),
        "fill_rate_bpd": round(q * 24, 1),
        "hours_to_limit": None if hours is None else round(max(hours, 0.0), 2),
        "trips_at": None if hours is None or hours > s.horizon_h else int(t0 + max(hours, 0) * 3600),
        "repair_remaining_h": round(s.horizon_h, 2),
        "lost_revenue_per_hour": round(s.rev_per_hour, 2),
        "recommended_action": recommended_action(chosen, options, s, t0, free),
        "recommended_actions": spec_actions(chosen, fac["id"]),
    })
    if ev["hours_to_limit"] is not None and ev["status"] == "ongoing":
        ev["evidence"] = ev["evidence"] + [
            f"Tank at {ev['level_pct']}% and rising {q:.0f} bbl/h; shutdown in {ev['hours_to_limit']:.1f} h if nothing changes"]


def truck_schedule(events, ds: Dataset) -> list:
    """One entry per truck in each ongoing plan, for the truck tracker."""
    out = []
    for ev in events:
        if ev["status"] != "ongoing" or ev["category"] != "pump_failure":
            continue
        plan = ev["recommended_action"]["cheapest"]
        trucks = plan if plan["type"] == "truck" else plan.get("trucks") if plan["type"] == "combo" else None
        if not trucks:
            continue
        cycle = ds.ops["systems"][ev["system"]]["facilities"][ev["facility"]]["cycle_min"]
        for n in range(trucks["truck_count"]):
            arrivals = trucks["arrivals_unix"]
            out.append({
                "id": f"{ev['id']}-T{n + 1}", "system_id": ev["system"], "facility_id": ev["facility"],
                "event_id": ev["id"], "dispatched_at": ev["recommended_action"]["planned_at_unix"],
                "arrivals_unix": arrivals, "free_at_unix": arrivals[-1] + cycle * 60,
                "capacity_bbl": ds.ops["emergency_trucking"]["truck_capacity_bbl"],
            })
    return out


def main(argv=None):
    parser = argparse.ArgumentParser(description="Analyze a Beat the Shutdown dataset folder.")
    parser.add_argument("folder", type=Path)
    parser.add_argument("--now", help="Time travel: analyze as if it were this UTC time, e.g. 2026-10-08T12:00:00Z")
    parser.add_argument("--out", type=Path, help="Write JSON here instead of printing it")
    args = parser.parse_args(argv)

    ds = load_dataset(args.folder, parse_iso(args.now) if args.now else None)
    text = json.dumps(analyze(ds), indent=2)
    if args.out:
        args.out.write_text(text)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
