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
import { detectEvents } from '../engine/detector';
import { generateNotifications, predictUpcomingRisks } from '../engine/riskEngine';
import { buildNetworkGraph } from '../engine/dijkstra';
import { generateSimEvents, expireSimEvents, simEventsToDetected } from '../engine/simulator';
import type { SimEvent } from '../engine/simulator';

export const DATASET_FOLDERS: DatasetFolder[] = [
  { name: 'Full Week', path: 'full_week', description: 'Mon Oct 5 – Sun Oct 11 · All 23 events resolved' },
  { name: 'Snapshot Oct-08 12:00', path: 'snapshot_2026-10-08T1200', description: '3 simultaneous S2 pump failures' },
  { name: 'Snapshot Oct-09 03:30', path: 'snapshot_2026-10-09T0330', description: 'S4 pump failure + leak' },
  { name: 'Snapshot Oct-10 09:00', path: 'snapshot_2026-10-10T0900', description: '3 simultaneous S4 pump failures' },
  { name: 'Mock Test Oct-10 15:30', path: 'mock_test_2026-10-10T1530', description: 'No answer key — dress rehearsal' },
];

interface AppState {
  // Dataset
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
  simEvents: SimEvent[];
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
  simEvents: [],
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

      const events = detectEvents(network, ops, telemetryIndex, nowUnix);
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
        loading: false,
        trucks: [],
        simEvents: [],
      });
    } catch (err) {
      set({ loadError: String(err), loading: false });
    }
  },

  refreshDetection: () => {
    const { network, ops, telemetryIndex, nowUnix, notifications, simEvents } = get();
    if (!network || !ops || !telemetryIndex) return;
    const baseEvents = detectEvents(network, ops, telemetryIndex, nowUnix);
    const simDetected = simEventsToDetected(simEvents);
    const allEvents = [...baseEvents, ...simDetected];
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
    const { simMode } = get();
    // The interval itself is owned by the React useEffect in App.tsx,
    // which watches simMode. Just flip the flag here.
    set({ simMode: !simMode });
  },

  setSimSpeed: (speed: SimSpeed) => set({ simSpeed: speed }),

  tickSimulation: () => {
    const { simEvents, network, nowUnix, simSpeed } = get();
    if (!network) return;

    const newNow = nowUnix + simSpeed * 300; // advance by simSpeed * 5 minutes
    const expired = expireSimEvents(simEvents, newNow);
    const newSim = generateSimEvents(network, expired, newNow);
    const allSim = [...expired, ...newSim];

    set({ nowUnix: newNow, simEvents: allSim });
    get().refreshDetection();

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
