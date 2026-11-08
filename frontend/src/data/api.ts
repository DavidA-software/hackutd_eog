import type { DatasetFolder, DetectedEvent } from '../types';

/**
 * Backend API (Spring Boot on :8081, reached through the Vite proxy in vite.config.ts).
 * Every call fails soft: callers fall back to the in-browser engine if the backend is down.
 */

export interface AnalysisResult {
  dataset: string;
  start_unix: number;
  now_unix: number;
  now_ts: string;
  events: DetectedEvent[];
  alerts: string[];
  trucks: {
    id: string;
    system_id: string;
    facility_id: string;
    event_id: string;
    dispatched_at: number;
    arrivals_unix: number[];
    free_at_unix: number;
    capacity_bbl: number;
  }[];
  summary: {
    ongoing_pump_failures: number;
    ongoing_leaks: number;
    ongoing_worn_pumps: number;
    early_warnings: number;
    resolved: number;
    cost_if_no_action: number;
    cost_with_plan: number;
  };
}

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    let msg = res.statusText;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* not JSON */
    }
    throw new Error(msg);
  }
  return res.json();
}

export function fetchDatasets(): Promise<DatasetFolder[]> {
  return getJson<DatasetFolder[]>('/api/datasets');
}

export function fetchAnalysis(dataset: string, nowIso?: string): Promise<AnalysisResult> {
  const params = new URLSearchParams({ dataset });
  if (nowIso) params.set('now', nowIso);
  return getJson<AnalysisResult>(`/api/analysis?${params}`);
}
