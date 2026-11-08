import { create } from 'zustand';
import type {
  NetworkData,
  OpsData,
  TelemetryIndex,
  DetectedEvent,
  Notification,
  TruckDispatch,
  OilReserve,
  GraphNode,
  GraphEdge,
  SimSpeed,
  DatasetFolder,
  CustomSensor,
} from '../types';
import { loadNetworkJson, loadOpsJson, loadTelemetryCsv, buildTelemetryIndex } from '../data/loader';
import { fetchAnalysis, fetchDatasets } from '../data/api';
import { detectEvents } from '../engine/detector';
import { generateNotifications, predictUpcomingRisks } from '../engine/riskEngine';
import { buildNetworkGraph } from '../engine/dijkstra';
import { eventsAt, isoUtc } from '../engine/replay';

// Debounce for the exact backend analysis when the replay is paused on a moment.
let exactTimer: ReturnType<typeof setTimeout> | null = null;

/** Fallback list, used only when the backend isn't running. */
export const DATASET_FOLDERS: DatasetFolder[] = [
  { name: 'Full Week', path: 'full_week', description: 'Mon Oct 5 – Sun Oct 11 · All 23 events resolved' },
  { name: 'Snapshot Oct-08 12:00', path: 'snapshot_2026-10-08T1200', description: '3 simultaneous S2 pump failures' },
  { name: 'Snapshot Oct-09 03:30', path: 'snapshot_2026-10-09T0330', description: 'S4 pump failure + leak' },
  { name: 'Snapshot Oct-10 09:00', path: 'snapshot_2026-10-10T0900', description: '3 simultaneous S4 pump failures' },
  { name: 'Mock Test Oct-10 15:30', path: 'mock_test_2026-10-10T1530', description: 'No answer key — dress rehearsal' },
];

interface AppState {
  // Dataset
  datasets: DatasetFolder[];
  backendOnline: boolean;      // analysis came from the backend (false = in-browser fallback)
  backendEvents: DetectedEvent[] | null;
  resolvedEvents: DetectedEvent[];
  loadDatasets: () => Promise<void>;
  activeFolder: string;
  network: NetworkData | null;
  ops: OpsData | null;
  telemetryIndex: TelemetryIndex | null;
  nowUnix: number;        // current "now" (either end of telemetry or simulated)
  loading: boolean;
  loadError: string | null;

  // Events & Alerts
  events: DetectedEvent[];
  predictions: DetectedEvent[];
  notifications: Notification[];
  unreadCount: number;

  // Truck tracking
  trucks: TruckDispatch[];

  // Oil reserve
  oilReserve: OilReserve;

  // Graph (Dijkstra)
  graphNodes: GraphNode[];
  graphEdges: GraphEdge[];

  // Simulation mode
  simMode: boolean;
  simSpeed: SimSpeed;
  // Replay of the recorded week
  timeline: DetectedEvent[];       // every event in the dataset (from the backend)
  datasetStart: number;
  datasetEnd: number;              // the dataset's "now"
  exactAt: number | null;          // replay time the exact analysis below was computed for
  exactEvents: DetectedEvent[] | null;
  setReplayTime: (t: number) => void;
  requestExactAnalysis: () => void;
  simInterval: ReturnType<typeof setInterval> | null;

  // UI state
  selectedAssetId: string | null;
  selectedSystemId: string | null;
  showNetworkEditor: boolean;
  customSensors: CustomSensor[];
  sidebarTab: 'alerts' | 'trucks' | 'costs' | 'reserve';

  // Actions
  loadDataset: (folder: string) => Promise<void>;
  refreshDetection: () => void;
  markNotificationRead: (id: string) => void;
  respondToNotification: (id: string, option: string) => void;
  dispatchTruck: (eventId: string) => void;
  selectAsset: (assetId: string | null) => void;
  selectSystem: (systemId: string | null) => void;
  toggleSimMode: () => void;
  setSimSpeed: (speed: SimSpeed) => void;
  toggleNetworkEditor: () => void;
  addCustomSensor: (sensor: CustomSensor) => void;
  setSidebarTab: (tab: 'alerts' | 'trucks' | 'costs' | 'reserve') => void;
  useOilReserve: (amount_bbl: number) => void;
  tickSimulation: () => void;
  addNotification: (notification: Notification) => void;
  removeNotification: (id: string) => void;
}

export const useAppStore = create<AppState>((set, get) => ({
  datasets: DATASET_FOLDERS,
  backendOnline: false,
  backendEvents: null,
  resolvedEvents: [],
  loadDatasets: async () => {
    try {
      const datasets = await fetchDatasets();
      if (datasets.length > 0) set({ datasets });
    } catch {
      // Backend not running: keep the built-in list.
    }
  },
  activeFolder: 'snapshot_2026-10-08T1200',
  network: null,
  ops: null,
  telemetryIndex: null,
  nowUnix: 0,
  loading: false,
  loadError: null,
  events: [],
  predictions: [],
  notifications: [],
  unreadCount: 0,
  trucks: [],
  oilReserve: {
    total_bbl: 50000,
    available_bbl: 50000,
    depleted_bbl: 0,
    status: 'full',
  },
  graphNodes: [],
  graphEdges: [],
  simMode: false,
  simSpeed: 1,
  timeline: [],
  datasetStart: 0,
  datasetEnd: 0,
  exactAt: null,
  exactEvents: null,
  simInterval: null,
  selectedAssetId: null,
  selectedSystemId: null,
  showNetworkEditor: false,
  customSensors: [],
  sidebarTab: 'alerts',

  loadDataset: async (folder: string) => {
    set({ loading: true, loadError: null, activeFolder: folder });
    try {
      const [network, ops, rows] = await Promise.all([
        loadNetworkJson(folder),
        loadOpsJson(folder),
        loadTelemetryCsv(folder),
      ]);
      const telemetryIndex = buildTelemetryIndex(rows);
      // "Now" = last timestamp in telemetry
      let nowUnix = 0;
      for (const row of rows) {
        if (row.ts_unix > nowUnix) nowUnix = row.ts_unix;
      }

      // Detection and cost plans come from the backend; fall back to the in-browser engine.
      let events: DetectedEvent[];
      let backendEvents: DetectedEvent[] | null = null;
      let resolvedEvents: DetectedEvent[] = [];
      let timeline: DetectedEvent[] = [];
      let datasetStart = rows.length ? rows[0].ts_unix : 0;
      for (const row of rows) if (row.ts_unix < datasetStart) datasetStart = row.ts_unix;
      try {
        const analysis = await fetchAnalysis(folder);
        backendEvents = analysis.events.filter((e) => e.status !== 'resolved');
        resolvedEvents = analysis.events.filter((e) => e.status === 'resolved');
        timeline = analysis.events;
        events = backendEvents;
        nowUnix = analysis.now_unix;
        datasetStart = analysis.start_unix;
      } catch (err) {
        console.warn('Backend analysis unavailable, using in-browser engine:', err);
        events = detectEvents(network, ops, telemetryIndex, nowUnix);
      }
      const predictions = predictUpcomingRisks(network, telemetryIndex, nowUnix);
      const notifications = generateNotifications(events, [], nowUnix);
      const { nodes, edges } = buildNetworkGraph(network, telemetryIndex, nowUnix);

      set({
        network,
        ops,
        telemetryIndex,
        nowUnix,
        events,
        predictions,
        notifications,
        unreadCount: notifications.length,
        graphNodes: nodes,
        graphEdges: edges,
        backendEvents,
        backendOnline: backendEvents !== null,
        resolvedEvents,
        timeline,
        datasetStart,
        datasetEnd: nowUnix,
        exactAt: null,
        exactEvents: null,
        simMode: false,
        loading: false,
        trucks: [],
      });
    } catch (err) {
      set({ loadError: String(err), loading: false });
    }
  },

  refreshDetection: () => {
    const { network, ops, telemetryIndex, nowUnix, notifications, backendEvents, timeline, datasetEnd, exactAt, exactEvents } =
      get();
    if (!network || !ops || !telemetryIndex) return;
    // At the dataset's "now": the backend's analysis. Earlier (replay): the exact analysis for this
    // moment if we have it, otherwise events from the timeline with live countdowns.
    // Without a backend: the in-browser engine at this time.
    let allEvents: DetectedEvent[];
    if (backendEvents === null) {
      allEvents = detectEvents(network, ops, telemetryIndex, nowUnix);
    } else if (nowUnix >= datasetEnd) {
      allEvents = backendEvents;
    } else if (exactAt === nowUnix && exactEvents) {
      allEvents = exactEvents;
    } else {
      allEvents = eventsAt(timeline, network, ops, telemetryIndex, nowUnix);
    }
    const predictions = predictUpcomingRisks(network, telemetryIndex, nowUnix);
    const newNotifs = generateNotifications(allEvents, notifications, nowUnix);
    const allNotifs = [...notifications, ...newNotifs];

    set({
      events: allEvents,
      predictions,
      notifications: allNotifs,
      unreadCount: allNotifs.filter((n) => !n.read).length,
    });
  },

  markNotificationRead: (id: string) => {
    const { notifications } = get();
    const updated = notifications.map((n) => (n.id === id ? { ...n, read: true } : n));
    set({ notifications: updated, unreadCount: updated.filter((n) => !n.read).length });
  },

  respondToNotification: (id: string, option: string) => {
    const { notifications, events } = get();
    const notif = notifications.find((n) => n.id === id);
    if (!notif) return;

    const updated = notifications.map((n) =>
      n.id === id ? { ...n, read: true, requires_user_action: false } : n
    );
    set({ notifications: updated, unreadCount: updated.filter((n) => !n.read).length });

    if (option === 'Send truck') {
      const event = events.find((e) => e.id === notif.event_id);
      if (event) get().dispatchTruck(event.id);
    }
  },

  dispatchTruck: (eventId: string) => {
    const { events, ops, network, nowUnix, trucks } = get();
    const event = events.find((e) => e.id === eventId);
    if (!event || !ops || !network) return;

    const system = network.systems.find((s) => s.id === event.system);
    const facility = system?.facilities.find((f) => f.id === event.facility);
    if (!system || !facility) return;

    const facilityOps = ops.systems[event.system]?.facilities[event.facility];
    if (!facilityOps) return;

    const truck: TruckDispatch = {
      id: `TRUCK_${Date.now()}`,
      system_id: event.system,
      facility_id: event.facility,
      event_id: eventId,
      dispatched_at: nowUnix,
      eta_arrival: nowUnix + facilityOps.response_min * 60,
      eta_return: nowUnix + facilityOps.cycle_min * 60,
      status: 'en_route',
      trip_number: 1,
      capacity_bbl: ops.emergency_trucking.truck_capacity_bbl,
      route_path: [system.truck_yard, [facility.lat, facility.lon]],
      on_time: true,
      delay_min: 0,
    };
    set({ trucks: [...trucks, truck] });
  },

  selectAsset: (assetId) => set({ selectedAssetId: assetId }),
  selectSystem: (systemId) => set({ selectedSystemId: systemId }),

  toggleNetworkEditor: () => set((s) => ({ showNetworkEditor: !s.showNetworkEditor })),

  addCustomSensor: (sensor: CustomSensor) =>
    set((s) => ({ customSensors: [...s.customSensors, sensor] })),

  setSidebarTab: (tab) => set({ sidebarTab: tab }),

  useOilReserve: (amount_bbl: number) => {
    const { oilReserve } = get();
    const newAvail = Math.max(0, oilReserve.available_bbl - amount_bbl);
    const newDepleted = oilReserve.total_bbl - newAvail;
    const ratio = newAvail / oilReserve.total_bbl;
    const status =
      ratio > 0.6 ? 'full' :
      ratio > 0.3 ? 'partial' :
      ratio > 0.1 ? 'low' :
      newAvail > 0 ? 'critical' : 'depleted';
    set({
      oilReserve: {
        ...oilReserve,
        available_bbl: newAvail,
        depleted_bbl: newDepleted,
        last_used: get().nowUnix,
        status,
      },
    });
  },

  toggleSimMode: () => {
    const { simMode, nowUnix, datasetStart, datasetEnd } = get();
    // The interval itself is owned by the React useEffect in App.tsx, which watches simMode.
    if (!simMode) {
      // Starting a replay from the end goes back to the start of the week.
      if (nowUnix >= datasetEnd) {
        set({ nowUnix: datasetStart, exactAt: null, exactEvents: null });
        get().refreshDetection();
      }
      set({ simMode: true });
    } else {
      set({ simMode: false });
      get().requestExactAnalysis();
    }
  },

  setReplayTime: (t: number) => {
    const { datasetStart, datasetEnd } = get();
    const clamped = Math.max(datasetStart, Math.min(datasetEnd, Math.round(t / 300) * 300));
    set({ nowUnix: clamped, exactAt: null, exactEvents: null });
    get().refreshDetection();
  },

  requestExactAnalysis: () => {
    if (exactTimer) clearTimeout(exactTimer);
    exactTimer = setTimeout(async () => {
      const { activeFolder, nowUnix, datasetEnd, backendOnline, simMode } = get();
      if (!backendOnline || simMode || nowUnix >= datasetEnd) return;
      const at = nowUnix;
      try {
        // Plans for "as if it were this moment": tank level, repair time left and the whole fleet.
        const analysis = await fetchAnalysis(activeFolder, isoUtc(at));
        if (get().nowUnix !== at || get().simMode) return;
        set({ exactAt: at, exactEvents: analysis.events.filter((e) => e.status !== 'resolved') });
        get().refreshDetection();
      } catch (err) {
        console.warn('Exact analysis unavailable for this moment:', err);
      }
    }, 400);
  },

  setSimSpeed: (speed: SimSpeed) => set({ simSpeed: speed }),

  tickSimulation: () => {
    const { network, nowUnix, simSpeed, datasetEnd } = get();
    if (!network) return;

    // Replay: advance through the recorded data by simSpeed x 5 minutes, stopping at its end.
    const newNow = Math.min(datasetEnd, nowUnix + simSpeed * 300);
    set({ nowUnix: newNow, exactAt: null, exactEvents: null });
    get().refreshDetection();
    if (newNow >= datasetEnd) set({ simMode: false });

    // Update truck ETAs
    const { trucks } = get();
    const updatedTrucks = trucks.map((t) => {
      if (t.status === 'en_route' && newNow >= t.eta_arrival) {
        return { ...t, status: 'on_site' as const };
      }
      if (t.status === 'on_site' && newNow >= t.eta_return) {
        return { ...t, status: 'returning' as const };
      }
      return t;
    });
    set({ trucks: updatedTrucks });
  },

  addNotification: (notification: Notification) => {
    const { notifications } = get();
    const exists = notifications.some((n) => n.id === notification.id);
    if (!exists) {
      const updated = [...notifications, notification];
      set({ 
        notifications: updated,
        unreadCount: updated.filter((n) => !n.read).length 
      });
    }
  },

  removeNotification: (id: string) => {
    const { notifications } = get();
    const updated = notifications.filter((n) => n.id !== id);
    set({ 
      notifications: updated,
      unreadCount: updated.filter((n) => !n.read).length 
    });
  },
}));
