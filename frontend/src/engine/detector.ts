import type {
  NetworkData,
  OpsData,
  TelemetryIndex,
  DetectedEvent,
  AlertSeverity,
} from '../types';
import { latestValue, valuesInRange } from '../data/loader';
import { computeRecommendedAction } from './planner';

const SHUTDOWN_PCT = 92;
const WARNING_PCT = 85;

// Rolling window for degradation detection (4 hours in seconds)
const DEGRADATION_WINDOW_S = 4 * 3600;
// Min efficiency drop % to flag degradation
const DEGRADATION_THRESHOLD = 0.08;
// Leak threshold: pump_flow vs pipeline_receive mismatch ratio
const LEAK_FLOW_RATIO_THRESHOLD = 0.07;
// Leak pressure drop threshold vs max pipeline pressure
const LEAK_PRESSURE_DROP_THRESHOLD = 0.12;

let eventCounter = 0;

function newId() {
  return `EVT_${String(++eventCounter).padStart(3, '0')}`;
}

function getSeverity(level_pct: number, hours_to_limit: number | null): AlertSeverity {
  if (level_pct >= SHUTDOWN_PCT) return 'critical';
  if (hours_to_limit !== null && hours_to_limit < 1.5) return 'critical';
  if (hours_to_limit !== null && hours_to_limit < 3) return 'red';
  if (level_pct >= WARNING_PCT) return 'red';
  if (level_pct >= 70) return 'yellow';
  return 'green';
}

/**
 * Main detection function — returns all detected events at `now_unix`.
 */
export function detectEvents(
  network: NetworkData,
  ops: OpsData,
  telemetry: TelemetryIndex,
  now_unix: number
): DetectedEvent[] {
  eventCounter = 0;
  const events: DetectedEvent[] = [];

  for (const system of network.systems) {
    const systemOps = ops.systems[system.id];

    for (const facility of system.facilities) {
      const facilityOps = systemOps?.facilities[facility.id];

      // ── Tank level & pump status ────────────────────────────────────────────
      const pumpStatus = latestValue(telemetry, facility.pump.id, 'status', now_unix);
      const pumpFlow = latestValue(telemetry, facility.pump.id, 'flow_bpd', now_unix) ?? 0;
      const tankLevel = latestValue(telemetry, facility.tank.id, 'level_pct', now_unix);
      const inflow = latestValue(telemetry, facility.id, 'inflow_bpd', now_unix) ?? 0;
      const pipelineReceive = latestValue(telemetry, facility.pipeline.id, 'receive_flow_bpd', now_unix) ?? 0;
      const pipelinePressure = latestValue(telemetry, facility.pipeline.id, 'pressure_psi', now_unix) ?? 0;
      const dischargePsi = latestValue(telemetry, facility.pump.id, 'discharge_psi', now_unix) ?? 0;

      // ── 1. Pump Failure Detection ──────────────────────────────────────────
      if (pumpStatus === 0 || (pumpFlow < 50 && inflow > 200)) {
        // Check that tank is actually rising (not just pump in off cycle)
        const windowStart = now_unix - 3600;
        const tankHistory = valuesInRange(telemetry, facility.tank.id, 'level_pct', windowStart, now_unix);

        let rising = false;
        let fillRate = 0;
        if (tankHistory.length >= 2) {
          const oldest = tankHistory[0];
          const newest = tankHistory[tankHistory.length - 1];
          const deltaLevel = newest.value - oldest.value;
          const deltaHrs = (newest.ts - oldest.ts) / 3600;
          if (deltaLevel > 2 && deltaHrs > 0) {
            rising = true;
            // Convert % change to bpd fill rate
            const capBbl = facility.tank.capacity_bbl;
            fillRate = (deltaLevel / 100) * capBbl / deltaHrs * 24;
          }
        }

        // Also flag if pump status is explicitly 0 even if tank hasn't risen much yet
        const pumpExplicitOff = pumpStatus === 0 && inflow > 100;

        if (rising || pumpExplicitOff) {
          const level = tankLevel ?? 50;
          const netInflowBpd = inflow; // when pump is off, all inflow accumulates
          const netInflowPerHour = netInflowBpd / 24;
          const capBbl = facility.tank.capacity_bbl;
          const usedBbl = (level / 100) * capBbl;
          const limitBbl = (SHUTDOWN_PCT / 100) * capBbl;
          const remainingBbl = Math.max(0, limitBbl - usedBbl);
          const hoursToLimit = netInflowPerHour > 0 ? remainingBbl / netInflowPerHour : null;

          // Find onset: when pump status first went to 0
          const pumpHistory = valuesInRange(telemetry, facility.pump.id, 'status', now_unix - 86400, now_unix);
          let onsetUnix = now_unix;
          for (let i = pumpHistory.length - 1; i >= 0; i--) {
            if (pumpHistory[i].value === 0) {
              onsetUnix = pumpHistory[i].ts;
            } else {
              break;
            }
          }

          // Revenue calculation
          const lostRevPerHr = facility.wells.reduce((sum, w) => {
            const oilRev = (w.oil_bpd / 24) * ops.prices.oil_per_bbl;
            const gasRev = (w.gas_mcfd / 24) * ops.prices.gas_per_mcf;
            return sum + oilRev + gasRev;
          }, 0);

          const severity = getSeverity(level, hoursToLimit);
          const repairHours = ops.expected_repair_hours.pump_failure;

          const recommended = computeRecommendedAction(
            facility,
            facilityOps,
            systemOps,
            ops,
            level,
            hoursToLimit,
            repairHours,
            now_unix,
            lostRevPerHr
          );

          events.push({
            id: newId(),
            system: system.id,
            facility: facility.id,
            asset: facility.pump.id,
            category: 'pump_failure',
            onset_unix: onsetUnix,
            severity,
            status: 'ongoing',
            level_pct: level,
            fill_rate_bpd: fillRate || netInflowBpd,
            hours_to_limit: hoursToLimit ?? undefined,
            lost_revenue_per_hour: lostRevPerHr,
            recommended_action: recommended,
            confidence: pumpExplicitOff ? 0.97 : 0.82,
          });
          continue; // skip degradation check for this facility
        }
      }

      // ── 2. Pump Degradation Detection ─────────────────────────────────────
      if (pumpStatus !== 0 && pumpFlow > 0) {
        const windowStart = now_unix - DEGRADATION_WINDOW_S;
        const flowHistory = valuesInRange(telemetry, facility.pump.id, 'flow_bpd', windowStart, now_unix);

        if (flowHistory.length >= 4) {
          const earliest = flowHistory.slice(0, 3).reduce((s, p) => s + p.value, 0) / 3;
          const latest = flowHistory.slice(-3).reduce((s, p) => s + p.value, 0) / 3;
          const maxFlow = facility.pump.max_flow_bpd;
          const efficiencyDrop = (earliest - latest) / maxFlow;

          if (efficiencyDrop > DEGRADATION_THRESHOLD && earliest > latest * 1.05) {
            const confidence = Math.min(0.95, 0.5 + efficiencyDrop * 3);
            events.push({
              id: newId(),
              system: system.id,
              facility: facility.id,
              asset: facility.pump.id,
              category: 'pump_degradation',
              onset_unix: windowStart,
              severity: efficiencyDrop > 0.15 ? 'yellow' : 'yellow',
              status: 'ongoing',
              confidence,
            });
          }
        }
      }

      // ── 3. Pipeline Leak Detection ─────────────────────────────────────────
      if (pumpFlow > 200 && pipelineReceive > 0) {
        // Flow mismatch
        const flowMismatch = (pumpFlow - pipelineReceive) / pumpFlow;
        // Pressure anomaly: compare pipeline pressure vs discharge — big drop suggests leak
        const pressureDrop = dischargePsi > 0
          ? (dischargePsi - pipelinePressure) / facility.pipeline.max_pressure_psi
          : 0;

        if (flowMismatch > LEAK_FLOW_RATIO_THRESHOLD || pressureDrop > LEAK_PRESSURE_DROP_THRESHOLD) {
          const confidence = Math.min(0.93, Math.max(flowMismatch, pressureDrop) * 4);
          const severity: AlertSeverity =
            flowMismatch > 0.15 || pressureDrop > 0.2 ? 'red' : 'yellow';

          events.push({
            id: newId(),
            system: system.id,
            facility: facility.id,
            asset: facility.pipeline.id,
            category: 'pipeline_leak',
            onset_unix: now_unix - 1800, // estimated 30min ago
            severity,
            status: 'ongoing',
            confidence,
          });
        }
      }
    }
  }

  // ── Rank pump failures within each system by hours_to_limit ──────────────
  const pumpFailuresBySystem: Record<string, DetectedEvent[]> = {};
  for (const evt of events) {
    if (evt.category === 'pump_failure') {
      if (!pumpFailuresBySystem[evt.system]) pumpFailuresBySystem[evt.system] = [];
      pumpFailuresBySystem[evt.system].push(evt);
    }
  }
  for (const sysEvents of Object.values(pumpFailuresBySystem)) {
    sysEvents.sort((a, b) => {
      const aH = a.hours_to_limit ?? Infinity;
      const bH = b.hours_to_limit ?? Infinity;
      if (aH !== bH) return aH - bH;
      return (b.lost_revenue_per_hour ?? 0) - (a.lost_revenue_per_hour ?? 0);
    });
    sysEvents.forEach((e, i) => { e.order = i + 1; });
  }

  return events;
}
