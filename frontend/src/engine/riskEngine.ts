import type {
  NetworkData,
  TelemetryIndex,
  DetectedEvent,
  Notification,
} from '../types';
import { latestValue, valuesInRange } from '../data/loader';

let notifCounter = 0;
function newNotifId() {
  return `NOTIF_${String(++notifCounter).padStart(4, '0')}`;
}

/**
 * Risk score for a facility: 0 (no risk) to 100 (critical).
 */
export function facilityRiskScore(
  _facilityId: string,
  tankId: string,
  pumpId: string,
  _pipelineId: string,
  telemetry: TelemetryIndex,
  now_unix: number
): number {
  const tankLevel = latestValue(telemetry, tankId, 'level_pct', now_unix) ?? 50;
  const pumpStatus = latestValue(telemetry, pumpId, 'status', now_unix) ?? 1;
  const pumpFlow = latestValue(telemetry, pumpId, 'flow_bpd', now_unix) ?? 0;
  const maxExpectedFlow = latestValue(telemetry, pumpId, 'flow_bpd', now_unix - 3600) ?? pumpFlow;

  let score = 0;

  // Tank level contribution (0-50)
  if (tankLevel >= 92) score += 50;
  else if (tankLevel >= 85) score += 35;
  else if (tankLevel >= 70) score += 20;
  else if (tankLevel >= 55) score += 8;

  // Pump failure (0-30)
  if (pumpStatus === 2) score += 30;
  else if (pumpFlow < maxExpectedFlow * 0.85) score += 15;

  // Trend: is level rising fast? (0-20)
  const recent = valuesInRange(telemetry, tankId, 'level_pct', now_unix - 3600, now_unix);
  if (recent.length >= 2) {
    const delta = recent[recent.length - 1].value - recent[0].value;
    if (delta > 10) score += 20;
    else if (delta > 5) score += 12;
    else if (delta > 2) score += 5;
  }

  return Math.min(100, score);
}

/**
 * Generate system notifications from detected events.
 * HIGH severity → automated action notification.
 * MED/LOW severity → ask user notification.
 */
export function generateNotifications(
  events: DetectedEvent[],
  existing: Notification[],
  now_unix: number
): Notification[] {
  const existingEventIds = new Set(existing.map((n) => n.event_id).filter(Boolean));
  const newNotifs: Notification[] = [];

  for (const evt of events) {
    if (existingEventIds.has(evt.id)) continue;

    const isHigh = evt.severity === 'critical' || evt.severity === 'severe';
    const title = buildTitle(evt);
    const message = buildMessage(evt);
    const systemAction = isHigh ? buildSystemAction(evt) : undefined;
    const currentStatus = buildCurrentStatus(evt);

    newNotifs.push({
      id: newNotifId(),
      ts: now_unix,
      severity: evt.severity,
      title,
      message,
      system_action: systemAction,
      current_status: currentStatus,
      event_id: evt.id,
      read: false,
      requires_user_action: !isHigh,
      user_options: !isHigh ? buildUserOptions(evt) : undefined,
    });
  }

  return newNotifs;
}

function buildTitle(evt: DetectedEvent): string {
  if (evt.category === 'pump_failure') {
    return `Pump Failure — ${evt.facility}`;
  }
  if (evt.category === 'pump_degradation') {
    return `Pump Degrading — ${evt.facility}`;
  }
  return `Pipeline Leak — ${evt.facility}`;
}

function buildMessage(evt: DetectedEvent): string {
  if (evt.category === 'pump_failure') {
    const h = evt.hours_to_limit;
    const level = evt.level_pct?.toFixed(1) ?? 'unknown';
    const ttl = h != null ? `~${h.toFixed(1)}h to shutdown limit` : 'time to limit unknown';
    return `${evt.asset} has stopped. Tank ${evt.facility.replace(/_/g, ' ')} is at ${level}% and rising — ${ttl}.`;
  }
  if (evt.category === 'pump_degradation') {
    return `${evt.asset} efficiency is declining. Field inspection recommended before failure occurs.`;
  }
  return `Flow/pressure anomaly detected on ${evt.asset}. Possible leak — immediate field inspection required.`;
}

function buildSystemAction(evt: DetectedEvent): string {
  if (evt.category === 'pump_failure') {
    const plan = evt.recommended_action?.cheapest;
    if (!plan) return 'No automatic action taken.';
    if (plan.type === 'truck') {
      return `System automatically dispatched ${plan.truck_count} emergency truck(s) to ${evt.facility}. ${plan.trip_count} trip(s) planned (~$${plan.total_cost.toLocaleString()}).`;
    }
    if (plan.type === 'shut_in') {
      return `System automatically shut in ${plan.well_id} to reduce inflow rate. (~$${plan.total_cost.toLocaleString()}).`;
    }
  }
  return 'Alert generated. Awaiting operator action.';
}

function buildCurrentStatus(evt: DetectedEvent): string {
  if (evt.category === 'pump_failure') {
    const h = evt.hours_to_limit;
    return h != null && h > 0
      ? `${h.toFixed(1)} hours until shutdown at current fill rate.`
      : 'Tank is stable or repair in progress.';
  }
  return 'Monitoring in progress.';
}

function buildUserOptions(evt: DetectedEvent): string[] {
  if (evt.category === 'pump_degradation') {
    return ['Schedule field inspection', 'Acknowledge & monitor', 'Dismiss'];
  }
  if (evt.category === 'pipeline_leak') {
    return ['Dispatch inspector now', 'Acknowledge & monitor', 'Dismiss'];
  }
  if (evt.category === 'pump_failure') {
    return ['Send truck', 'Shut in well', 'No action', 'Dismiss'];
  }
  return ['Acknowledge', 'Dismiss'];
}

/**
 * Predict upcoming risks from trends (pump degradation → failure, tank trending up).
 */
export function predictUpcomingRisks(
  network: NetworkData,
  telemetry: TelemetryIndex,
  now_unix: number
): DetectedEvent[] {
  const predictions: DetectedEvent[] = [];
  let predCounter = 0;

  for (const system of network.systems) {
    for (const facility of system.facilities) {
      const tankId = facility.tank.id;
      const pumpId = facility.pump.id;
      const pumpStatus = latestValue(telemetry, pumpId, 'status', now_unix) ?? 1;

      if (pumpStatus === 2) continue; // already a failure, not a prediction

      // Check 8-hour trend on tank level
      const eightHourStart = now_unix - 8 * 3600;
      const tankTrend = valuesInRange(telemetry, tankId, 'level_pct', eightHourStart, now_unix);

      if (tankTrend.length >= 4) {
        // Linear regression slope
        const n = tankTrend.length;
        const xs = tankTrend.map((p) => p.ts - eightHourStart);
        const ys = tankTrend.map((p) => p.value);
        const sumX = xs.reduce((a, b) => a + b, 0);
        const sumY = ys.reduce((a, b) => a + b, 0);
        const sumXY = xs.reduce((s, x, i) => s + x * ys[i], 0);
        const sumX2 = xs.reduce((s, x) => s + x * x, 0);
        const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX); // pct per second
        const slopePerHour = slope * 3600;

        if (slopePerHour > 1.5) {
          // Tank rising > 1.5% per hour — flag as predicted concern
          const currentLevel = ys[ys.length - 1];
          const hoursTo92 = (92 - currentLevel) / slopePerHour;

          if (hoursTo92 > 0 && hoursTo92 < 12) {
            predictions.push({
              id: `PRED_${++predCounter}`,
              system: system.id,
              facility: facility.id,
              asset: pumpId,
              category: 'pump_failure',
              onset_unix: now_unix,
              severity: hoursTo92 < 4 ? 'major' : 'minor',
              status: 'predicted',
              level_pct: currentLevel,
              hours_to_limit: hoursTo92,
              confidence: Math.min(0.8, slopePerHour / 5),
            });
          }
        }
      }

      // Pump degradation → predict failure
      const flowHistory = valuesInRange(telemetry, pumpId, 'flow_bpd', now_unix - 6 * 3600, now_unix);
      if (flowHistory.length >= 4) {
        const first = flowHistory.slice(0, 2).reduce((s, p) => s + p.value, 0) / 2;
        const last = flowHistory.slice(-2).reduce((s, p) => s + p.value, 0) / 2;
        const maxFlow = facility.pump.max_flow_bpd;
        const dropRate = (first - last) / (6 * maxFlow); // fraction per hour
        if (dropRate > 0.01 && first > last * 1.03) {
          const hoursToFailure = (last / maxFlow) / (dropRate + 0.001);
          if (hoursToFailure < 24) {
            predictions.push({
              id: `PRED_${++predCounter}`,
              system: system.id,
              facility: facility.id,
              asset: pumpId,
              category: 'pump_degradation',
              onset_unix: now_unix,
              severity: hoursToFailure < 6 ? 'major' : 'minor',
              status: 'predicted',
              confidence: Math.min(0.7, dropRate * 40),
            });
          }
        }
      }
    }
  }

  return predictions;
}
