import Papa from 'papaparse';
import type { NetworkData, OpsData, TelemetryRow, TelemetryIndex } from '../types';

export async function loadNetworkJson(folder: string): Promise<NetworkData> {
  const res = await fetch(`/data/${folder}/network.json`);
  if (!res.ok) throw new Error(`Failed to load network.json from ${folder}`);
  return res.json();
}

export async function loadOpsJson(folder: string): Promise<OpsData> {
  const res = await fetch(`/data/${folder}/ops.json`);
  if (!res.ok) throw new Error(`Failed to load ops.json from ${folder}`);
  return res.json();
}

export async function loadTelemetryCsv(folder: string): Promise<TelemetryRow[]> {
  const res = await fetch(`/data/${folder}/telemetry.csv`);
  if (!res.ok) throw new Error(`Failed to load telemetry.csv from ${folder}`);
  const text = await res.text();
  return new Promise((resolve, reject) => {
    Papa.parse<TelemetryRow>(text, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (results) => resolve(results.data),
      error: (err: Error) => reject(err),
    });
  });
}

/**
 * Build a fast lookup index: asset_id -> metric -> sorted [{ts, value}]
 */
export function buildTelemetryIndex(rows: TelemetryRow[]): TelemetryIndex {
  const index: TelemetryIndex = {};
  for (const row of rows) {
    if (!index[row.asset_id]) index[row.asset_id] = {};
    if (!index[row.asset_id][row.metric]) index[row.asset_id][row.metric] = [];
    index[row.asset_id][row.metric].push({ ts: row.ts_unix, value: row.value });
  }
  // Sort each series by ts ascending
  for (const asset of Object.values(index)) {
    for (const series of Object.values(asset)) {
      series.sort((a, b) => a.ts - b.ts);
    }
  }
  return index;
}

/**
 * Get the latest value for an asset+metric at or before a given unix timestamp.
 * Returns null if no data.
 */
export function latestValue(
  index: TelemetryIndex,
  asset_id: string,
  metric: string,
  at_unix: number
): number | null {
  const series = index[asset_id]?.[metric];
  if (!series || series.length === 0) return null;
  // Binary search for latest <= at_unix
  let lo = 0, hi = series.length - 1, result: number | null = null;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (series[mid].ts <= at_unix) {
      result = series[mid].value;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return result;
}

/**
 * Get all values for an asset+metric in a time window [from_unix, to_unix]
 */
export function valuesInRange(
  index: TelemetryIndex,
  asset_id: string,
  metric: string,
  from_unix: number,
  to_unix: number
): { ts: number; value: number }[] {
  const series = index[asset_id]?.[metric];
  if (!series) return [];
  return series.filter((p) => p.ts >= from_unix && p.ts <= to_unix);
}
