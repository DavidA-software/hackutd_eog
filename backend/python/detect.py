"""
Find the three problem types in the sensor readings.

How each one shows up (worked out from the labelled full week):
  pump_failure      Pump status reads 2 (fault). Flow stops and the tank fills.
  pipeline_leak     While the pump runs, pressure at the disposal end drifts below its healthy
                    value (disposal + 50 psi) and less water arrives than the pump sends.
  pump_degradation  While the pump runs, discharge pressure drifts below its healthy value
                    (disposal + 150 psi) and the pump moves less water than its max flow.

Slow problems are tracked on a "residual": reading minus its healthy value, using only
samples where the pump has been running for at least one interval. Healthy residual noise
is about 3 psi (1 sigma).
"""
from dataclasses import dataclass, field

import numpy as np

from loader import Dataset

FAULT = 2
RUNNING = 1

# Healthy pressure offsets above the disposal site's pressure (SPEC.md "Pressure formulas").
PIPE_OFFSET_RUNNING = 50.0
DISCHARGE_OFFSET_RUNNING = 150.0

# Slow-problem detection: rolling mean of the last WINDOW running samples.
WINDOW = 8
ALERT_PSI = 8.0        # mean residual below -8 psi -> confirmed problem (~7 sigma of the mean)
WATCH_PSI = 4.0        # mean residual below -4 psi -> early warning ("predicted")
CLEAR_PSI = 3.0        # back above -3 psi -> problem has cleared
NOISE_PSI = 3.0
ONSET_LOOKBACK_S = 48 * 3600


@dataclass
class Event:
    system: str
    facility: str
    asset: str
    category: str
    onset_unix: int
    end_unix: int | None          # None while ongoing
    confidence: float
    evidence: list = field(default_factory=list)
    status: str = "ongoing"       # ongoing | resolved | predicted
    detected_unix: int | None = None  # first moment the readings confirm it (for replays)


def _runs(mask: np.ndarray):
    """(start, end_exclusive) index pairs of True runs."""
    edges = np.diff(np.r_[0, mask.astype(np.int8), 0])
    return list(zip(np.flatnonzero(edges == 1), np.flatnonzero(edges == -1)))


def detect_pump_failures(ds: Dataset) -> list[Event]:
    events = []
    for system, fac in ds.facilities():
        status = ds.get(fac["pump"]["id"], "status")
        for start, end in _runs(status == FAULT):
            ongoing = end >= len(ds.ts)
            events.append(Event(
                system=system["id"], facility=fac["id"], asset=fac["pump"]["id"],
                category="pump_failure",
                onset_unix=int(ds.ts[start]),
                end_unix=None if ongoing else int(ds.ts[end]),
                confidence=0.99,
                evidence=["Pump reports a fault (status 2) and has stopped moving water"],
                status="ongoing" if ongoing else "resolved",
                detected_unix=int(ds.ts[start]),
            ))
    return events


def _fit_onset(t: np.ndarray, r: np.ndarray, lo: int) -> tuple[int, int, int]:
    """
    Fit r = -(a + k * (t - t0)) for t >= t0 (a sudden drop plus a slow slide), 0 before.
    Returns (best_estimate, earliest, latest). A problem that starts while the pump is off
    can't be pinned down inside that quiet gap, so we report the range and its middle.
    """
    if len(t) == 0:
        return lo, lo, lo
    candidates = np.arange(lo - lo % 300, int(t[-1]) + 1, 300)
    sse = np.full(len(candidates), np.inf)
    for n, t0 in enumerate(candidates):
        on = t >= t0
        if on.sum() < 2:
            continue
        x = on.astype(float)
        d = np.where(on, (t - t0) / 3600.0, 0.0)
        A = np.column_stack([x, d])
        coef, *_ = np.linalg.lstsq(A, -r, rcond=None)
        coef = np.maximum(coef, 0.0)
        sse[n] = float(((r + A @ coef) ** 2).sum())
    best = float(sse.min())
    near = candidates[sse <= best + 2 * NOISE_PSI ** 2]
    earliest, latest = int(near.min()), int(near.max())
    return (earliest + latest) // 2 // 300 * 300, earliest, latest


def _healthy_level(values: np.ndarray, spec_value: float) -> float:
    """Typical running reading for this facility. Falls back to the spec value with little data."""
    if len(values) < 50:
        return spec_value
    # Problems only ever pull these pressures down, so estimate "normal" from the upper part of
    # the readings: 90th percentile minus 1.28 sigma of noise is the healthy mean.
    learned = float(np.percentile(values, 90) - 1.2816 * NOISE_PSI)
    # Trust the spec value when the data agrees with it; otherwise this network differs, use the data.
    return spec_value if abs(learned - spec_value) <= 5.0 else learned


def _window_text(earliest, latest):
    if latest - earliest <= 1800:
        return []
    from datetime import datetime, timezone
    f = lambda u: datetime.fromtimestamp(u, timezone.utc).strftime("%a %H:%M")
    return [f"Started between {f(earliest)} and {f(latest)} UTC (pump was idle, so no readings)"]


def _slow_events(ds, system, fac, residual_all, running, category, asset, describe):
    """Generic drift detector over running samples of one residual series."""
    t = ds.ts[running]
    r = residual_all[running]
    if len(r) < WINDOW:
        return []
    mean = np.convolve(r, np.ones(WINDOW) / WINDOW, mode="full")[: len(r)]
    mean[: WINDOW - 1] = 0.0

    events, i, last_end = [], WINDOW - 1, int(ds.ts[0])
    while i < len(r):
        if mean[i] >= -ALERT_PSI:
            i += 1
            continue
        # Confirmed. Walk forward until it clears.
        j = i
        while j < len(r) and mean[j] < -CLEAR_PSI:
            j += 1
        lo = max(last_end, int(t[i]) - ONSET_LOOKBACK_S)
        seg = (t >= lo) & (t <= t[min(j, len(r)) - 1])
        onset, earliest, latest = _fit_onset(t[seg], r[seg], lo)
        if j < len(r):
            # Cleared: the repair happened between the last bad sample and the first good one
            # (often while the pump sat idle), so take the middle of that gap.
            last_bad = j - 1
            while last_bad > i and r[last_bad] >= -ALERT_PSI:
                last_bad -= 1
            first_good = last_bad + 1
            end = int((t[last_bad] + t[min(first_good, len(r) - 1)]) // 2 // 300 * 300)
            status = "resolved"
        else:
            end, status = None, "ongoing"
        at = min(j, len(r)) - 1 if status == "ongoing" else i   # now if ongoing, else when detected
        z = abs(mean[at]) / (NOISE_PSI / np.sqrt(WINDOW))
        events.append(Event(
            system=system["id"], facility=fac["id"], asset=asset, category=category,
            onset_unix=onset, end_unix=end,
            confidence=round(float(min(0.99, 0.6 + 0.04 * z)), 2),
            evidence=describe(float(mean[at]), int(t[at])) + _window_text(earliest, latest),
            status=status,
            detected_unix=int(t[i]),
        ))
        last_end = end or last_end
        i = j + 1

    # Early warning on the newest readings when nothing is confirmed yet.
    ongoing = any(e.end_unix is None for e in events)
    if not ongoing and mean[-1] < -WATCH_PSI and t[-1] >= ds.now_unix - 6 * 3600:
        lo = max(last_end, int(t[-1]) - ONSET_LOOKBACK_S)
        seg = t >= lo
        z = abs(mean[-1]) / (NOISE_PSI / np.sqrt(WINDOW))
        events.append(Event(
            system=system["id"], facility=fac["id"], asset=asset, category=category,
            onset_unix=_fit_onset(t[seg], r[seg], lo)[0], end_unix=None,
            confidence=round(float(min(0.75, 0.3 + 0.05 * z)), 2),
            evidence=["Early warning: " + describe(float(mean[-1]), int(t[-1]))[0]],
            status="predicted",
            detected_unix=ds.now_unix,
        ))
    return events


def detect_slow_problems(ds: Dataset) -> list[Event]:
    events = []
    for system, fac in ds.facilities():
        disposal = system["disposal_site"]["pressure_psi"]
        pump, pipe = fac["pump"]["id"], fac["pipeline"]["id"]
        status = ds.get(pump, "status")
        # Running now and in the previous interval (skips start-up transients).
        running = (status == RUNNING) & (np.r_[0, status[:-1]] == RUNNING)

        # Healthy running pressure is learned from each facility's own readings (median), so a
        # network with different pressure offsets than the spec's placeholders still works.
        pipe_p = ds.get(pipe, "pressure_psi")
        pipe_res = pipe_p - _healthy_level(pipe_p[running], disposal + PIPE_OFFSET_RUNNING)
        flow = ds.get(pump, "flow_bpd")
        recv = ds.get(pipe, "receive_flow_bpd")

        def leak_text(m, at, flow=flow, recv=recv, running=running):
            idx = np.flatnonzero(running & (ds.ts <= at))[-WINDOW:]
            lost = float(np.mean((flow - recv)[idx])) if len(idx) else 0.0
            return [f"Pipeline end pressure {abs(m):.0f} psi below normal while pumping",
                    f"About {max(lost, 0):.0f} bbl/day pumped but not arriving at disposal"]

        events += _slow_events(ds, system, fac, pipe_res, running, "pipeline_leak", pipe, leak_text)

        dis_p = ds.get(pump, "discharge_psi")
        dis_res = dis_p - _healthy_level(dis_p[running], disposal + DISCHARGE_OFFSET_RUNNING)
        max_flow = fac["pump"]["max_flow_bpd"]

        def degr_text(m, at, flow=flow, running=running, max_flow=max_flow):
            idx = np.flatnonzero(running & (ds.ts <= at))[-WINDOW:]
            pct = 100 * float(np.mean(flow[idx])) / max_flow if len(idx) else 100.0
            return [f"Pump discharge pressure {abs(m):.0f} psi below normal",
                    f"Pump moving {pct:.0f}% of its rated flow"]

        events += _slow_events(ds, system, fac, dis_res, running, "pump_degradation", pump, degr_text)
    return events


def detect_all(ds: Dataset) -> list[Event]:
    failures = detect_pump_failures(ds)
    slow = detect_slow_problems(ds)
    # A worn pump that then fails is two events: the wear ends when the failure starts.
    for e in slow:
        if e.category != "pump_degradation":
            continue
        for f in failures:
            stop = e.end_unix if e.end_unix is not None else ds.now_unix + 1
            if f.asset == e.asset and e.onset_unix < f.onset_unix < stop:
                e.end_unix, e.status = f.onset_unix, "resolved"
                e.evidence = e.evidence + ["Pump went on to fail outright; tracked as a separate pump failure"]
                break
    events = failures + slow
    events.sort(key=lambda e: (e.onset_unix, e.facility))
    return events
