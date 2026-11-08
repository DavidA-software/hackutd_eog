import type { DetectedEvent, NetworkData, OpsData, TelemetryIndex, AlertSeverity } from '../types';
import { latestValue } from '../data/loader';

/**
 * Replay of the recorded week.
 *
 * The backend analyses the whole dataset once and returns every event with when it started,
 * when the readings first confirmed it (detected_unix) and when it ended. During a replay we
 * show the events that are detectable and not yet over at the replay time, and recompute
 * each failing tank's level and countdown from the real readings at that time.
 */

export function isoUtc(unix: number): string {
  return new Date(unix * 1000).toISOString().slice(0, 19) + 'Z';
}

function facilityOf(network: NetworkData, facilityId: string) {
  for (const s of network.systems) {
    const f = s.facilities.find((x) => x.id === facilityId);
    if (f) return f;
  }
  return null;
}

function fmtTime(unix: number) {
  return new Date(unix * 1000).toUTCString().slice(17, 22);
}

export function eventsAt(
  timeline: DetectedEvent[],
  network: NetworkData,
  ops: OpsData,
  telemetry: TelemetryIndex,
  t: number
): DetectedEvent[] {
  const shutdown = network.defaults.tank_limits_pct.shutdown;
  const repairH = ops.expected_repair_hours.pump_failure;
  const out: DetectedEvent[] = [];

  for (const e of timeline) {
    if (e.status === 'predicted') continue;
    const seenAt = e.detected_unix ?? e.onset_unix;
    if (seenAt > t) continue;
    if (e.end_unix != null && t >= e.end_unix) continue;

    const ev: DetectedEvent = { ...e, status: 'ongoing', end_unix: null };

    if (e.category === 'pump_failure') {
      const fac = facilityOf(network, e.facility);
      if (fac) {
        const level = latestValue(telemetry, fac.tank.id, 'level_pct', t) ?? e.level_pct ?? 0;
        const inflowBpd = latestValue(telemetry, fac.id, 'inflow_bpd', t) ?? 0;
        const cap = fac.tank.capacity_bbl;
        const pctPerHour = (inflowBpd / 24 / cap) * 100;
        const tripped = inflowBpd < 1 && level >= shutdown - 0.5;
        const repairEnd = e.end_unix ?? e.onset_unix + repairH * 3600;
        const remaining = Math.max(0, (repairEnd - t) / 3600);
        const hours = tripped ? 0 : pctPerHour > 0 ? Math.max(0, (shutdown - level) / pctPerHour) : undefined;

        ev.level_pct = Math.round(level * 10) / 10;
        ev.fill_rate_bpd = Math.round(inflowBpd);
        ev.hours_to_limit = hours !== undefined ? Math.round(hours * 100) / 100 : undefined;
        ev.repair_remaining_h = Math.round(remaining * 100) / 100;

        const base = (e.evidence ?? []).filter((line) => !line.startsWith('Tank '));
        const status = tripped
          ? `Tank hit shutdown; wells are shut in until the repair at ${fmtTime(repairEnd)} UTC`
          : hours !== undefined && hours > remaining
          ? `Tank at ${ev.level_pct}% and rising ${(inflowBpd / 24).toFixed(0)} bbl/h; repair at ${fmtTime(repairEnd)} UTC comes first`
          : `Tank at ${ev.level_pct}% and rising ${(inflowBpd / 24).toFixed(0)} bbl/h; shutdown in ${(hours ?? 0).toFixed(1)} h if nothing changes`;
        ev.evidence = [...base, status];

        let sev: AlertSeverity = 'major';
        if (tripped || (hours !== undefined && hours < 1.5)) sev = 'critical';
        else if ((e.recommended_action?.cost_of_doing_nothing ?? 0) > 0) sev = 'severe';
        ev.severity = sev;
      }
    } else {
      ev.severity = e.category === 'pipeline_leak' ? 'severe' : 'major';
    }
    out.push(ev);
  }

  // Alerts order (SPEC): pump failures, soonest shutdown first, ties by revenue at stake.
  const failures = out
    .filter((e) => e.category === 'pump_failure')
    .sort(
      (a, b) =>
        (a.hours_to_limit ?? Infinity) - (b.hours_to_limit ?? Infinity) ||
        (b.lost_revenue_per_hour ?? 0) - (a.lost_revenue_per_hour ?? 0)
    );
  failures.forEach((e, i) => (e.order = i + 1));
  const others = out.filter((e) => e.category !== 'pump_failure');
  others.forEach((e) => (e.order = undefined));
  return [...failures, ...others];
}
