// ─── Network Types ────────────────────────────────────────────────────────────

export interface Well {
  id: string;
  baseline_water_bpd: number;
  oil_bpd: number;
  gas_mcfd: number;
  lat?: number;
  lon?: number;
}

export interface Tank {
  id: string;
  capacity_bbl: number;
}

export interface Pump {
  id: string;
  max_flow_bpd: number;
  start_level_pct: number;
  stop_level_pct: number;
}

export interface Pipeline {
  id: string;
  max_bpd: number;
  max_pressure_psi: number;
}

export interface Facility {
  id: string;
  lat: number;
  lon: number;
  wells: Well[];
  tank: Tank;
  pump: Pump;
  pipeline: Pipeline;
}

export interface DisposalSite {
  id: string;
  lat: number;
  lon: number;
  pressure_psi: number;
}

export interface System {
  id: string;
  center: [number, number];
  truck_yard: [number, number];
  disposal_site: DisposalSite;
  facilities: Facility[];
}

export interface NetworkData {
  meta: { units: Record<string, string>; timezone: string };
  defaults: { tank_limits_pct: { warning: number; shutdown: number } };
  systems: System[];
}

// ─── Ops Types ────────────────────────────────────────────────────────────────

export interface FacilityOps {
  response_min: number;
  cycle_min: number;
}

export interface SystemOps {
  emergency_fleet_size: number;
  facilities: Record<string, FacilityOps>;
}

export interface OpsData {
  dataset_id: string;
  prices: { oil_per_bbl: number; gas_per_mcf: number };
  expected_repair_hours: { pump_failure: number };
  emergency_trucking: { truck_capacity_bbl: number; cost_per_trip: number };
  systems: Record<string, SystemOps>;
}

// ─── Telemetry Types ──────────────────────────────────────────────────────────

export interface TelemetryRow {
  timestamp: string;
  ts_unix: number;
  asset_id: string;
  metric: string;
  value: number;
}

// Indexed: asset_id -> metric -> sorted array of {ts, value}
export type TelemetryIndex = Record<string, Record<string, { ts: number; value: number }[]>>;

// ─── Event / Alert Types ──────────────────────────────────────────────────────

export type EventCategory = 'pump_failure' | 'pump_degradation' | 'pipeline_leak';
export type AlertSeverity = 'minor' | 'major' | 'severe' | 'critical';
export type AlertStatus = 'ongoing' | 'resolved' | 'predicted';

export interface DetectedEvent {
  id: string;
  system: string;
  facility: string;
  asset: string;
  category: EventCategory;
  onset_unix: number;
  severity: AlertSeverity;
  status: AlertStatus;
  // Pump failure specific
  level_pct?: number;
  fill_rate_bpd?: number;     // current net inflow
  hours_to_limit?: number;
  trips_at?: number;          // unix ts
  lost_revenue_per_hour?: number;
  recommended_action?: RecommendedAction;
  // Meta
  confidence: number;         // 0-1
  order?: number;             // priority rank among ongoing pump failures in same system
}

// ─── Cost / Plan Types ────────────────────────────────────────────────────────

export interface TruckPlan {
  type: 'truck';
  truck_count: number;
  trip_count: number;
  total_cost: number;
  dispatch_time_min: number;
  trucks_available: number;
}

export interface ShutInPlan {
  type: 'shut_in';
  well_id: string;
  shut_in_at_min: number;
  shut_in_hours: number;
  total_cost: number;
  description: string;
}

export interface DoNothingPlan {
  type: 'do_nothing';
  trips_at_unix: number | null;
  downtime_hours: number;
  total_cost: number;
  description: string;
}

export type Plan = TruckPlan | ShutInPlan | DoNothingPlan;

export interface RecommendedAction {
  cheapest: Plan;
  all_plans: Plan[];
  cost_of_doing_nothing: number;
  savings: number;
}

// ─── Truck Tracker Types ──────────────────────────────────────────────────────

export type TruckStatus = 'idle' | 'dispatched' | 'en_route' | 'on_site' | 'returning' | 'delayed';

export interface TruckDispatch {
  id: string;
  system_id: string;
  facility_id: string;
  event_id: string;
  dispatched_at: number;   // unix
  eta_arrival: number;     // unix
  eta_return: number;      // unix
  status: TruckStatus;
  trip_number: number;
  capacity_bbl: number;
  route_path: [number, number][];  // lat/lon waypoints
  on_time: boolean;
  delay_min: number;
}

// ─── Notification Types ───────────────────────────────────────────────────────

export interface Notification {
  id: string;
  ts: number;
  severity: AlertSeverity;
  title: string;
  message: string;
  system_action?: string;    // what the system did automatically
  current_status?: string;
  event_id?: string;
  read: boolean;
  requires_user_action: boolean;
  user_options?: string[];   // choices for med/low threats
}

// ─── Sensor / Node Types (for network editor) ─────────────────────────────────

export interface CustomSensor {
  id: string;
  asset_id: string;
  metric: string;
  lat: number;
  lon: number;
  range_min: number;
  range_max: number;
  unit: string;
  upstream?: string[];
  downstream?: string[];
  /** Optional user-uploaded icon, stored as a data URL */
  icon?: string;
}

// ─── Dijkstra Graph Types ─────────────────────────────────────────────────────

export interface GraphNode {
  id: string;
  lat: number;
  lon: number;
  type: 'facility' | 'disposal' | 'truck_yard' | 'pump' | 'tank';
  system_id: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  weight: number;   // haversine distance km
  pipeline_id?: string;
  flow_bpd?: number;
  pressure_psi?: number;
}

// ─── Oil Reserve Types ────────────────────────────────────────────────────────

export interface OilReserve {
  total_bbl: number;
  available_bbl: number;
  depleted_bbl: number;
  last_used?: number;  // unix
  status: 'full' | 'partial' | 'low' | 'critical' | 'depleted';
}

// ─── App State Types ──────────────────────────────────────────────────────────

export interface DatasetFolder {
  name: string;
  path: string;
  description: string;
}

export type SimSpeed = 1 | 5 | 10 | 30;
