/**
 * Simulator: generates random events for "simulation mode".
 * Events are appended as synthetic telemetry overrides on top of real data.
 */
import type { NetworkData, DetectedEvent, AlertSeverity } from '../types';

export interface SimEvent {
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: 'pump_failure' | 'pump_degradation' | 'pipeline_leak';
  triggered_at: number;   // unix
  duration_s: number;     // how long it lasts
  active: boolean;
}

let simCounter = 0;

const PROBABILITIES = {
  pump_failure: 0.0002,      // per tick per facility (~1/day at 1 tick/5min)
  pump_degradation: 0.0001,
  pipeline_leak: 0.00015,
};

const DURATIONS = {
  pump_failure: 6 * 3600,
  pump_degradation: 24 * 3600,
  pipeline_leak: 26 * 3600,
};

export function generateSimEvents(
  network: NetworkData,
  currentEvents: SimEvent[],
  now_unix: number
): SimEvent[] {
  const newEvents: SimEvent[] = [];

  for (const system of network.systems) {
    for (const facility of system.facilities) {
      // Don't pile events on same facility
      const hasActive = currentEvents.some(
        (e) => e.facility === facility.id && e.active
      );
      if (hasActive) continue;

      for (const [category, prob] of Object.entries(PROBABILITIES) as [keyof typeof PROBABILITIES, number][]) {
        if (Math.random() < prob) {
          const asset =
            category === 'pipeline_leak'
              ? facility.pipeline.id
              : facility.pump.id;

          newEvents.push({
            id: `SIM_${++simCounter}`,
            system: system.id,
            facility: facility.id,
            asset,
            category,
            triggered_at: now_unix,
            duration_s: DURATIONS[category],
            active: true,
          });
          break; // one event per facility per tick
        }
      }
    }
  }

  return newEvents;
}

export function expireSimEvents(events: SimEvent[], now_unix: number): SimEvent[] {
  return events.map((e) =>
    e.active && now_unix > e.triggered_at + e.duration_s
      ? { ...e, active: false }
      : e
  );
}

/**
 * Convert sim events into DetectedEvent format for display
 */
export function simEventsToDetected(simEvents: SimEvent[]): DetectedEvent[] {
  return simEvents
    .filter((e) => e.active)
    .map((e) => ({
      id: e.id,
      system: e.system,
      facility: e.facility,
      asset: e.asset,
      category: e.category,
      onset_unix: e.triggered_at,
      severity: e.category === 'pump_failure' ? 'red' : 'yellow' as AlertSeverity,
      status: 'ongoing' as const,
      confidence: 0.95,
      hours_to_limit: e.category === 'pump_failure' ? 3 + Math.random() * 4 : undefined,
      level_pct: e.category === 'pump_failure' ? 50 + Math.random() * 30 : undefined,
    }));
}
