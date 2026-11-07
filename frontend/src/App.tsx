import { useEffect, useRef } from 'react';
import { useAppStore, DATASET_FOLDERS } from './store/appStore';
import CityCanvas from './components/CityMap/CityCanvas';
import AlertPanel from './components/AlertPanel/AlertPanel';
import Dashboard from './components/Dashboard/Dashboard';
import TruckTracker from './components/TruckTracker/TruckTracker';
import CostPanel from './components/CostPanel/CostPanel';
import OilReserve from './components/Dashboard/OilReserve';
import AssetDetail from './components/Dashboard/AssetDetail';
import NotificationCenter from './components/Notifications/NotificationCenter';
import NetworkEditor from './components/NetworkEditor/NetworkEditor';
import type { SimSpeed } from './types';

export default function App() {
  const {
    loadDataset,
    activeFolder,
    loading,
    loadError,
    network,
    simMode,
    simSpeed,
    toggleSimMode,
    setSimSpeed,
    tickSimulation,
    showNetworkEditor,
    toggleNetworkEditor,
    sidebarTab,
    setSidebarTab,
    selectedAssetId,
    events,
  } = useAppStore();

  const simIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load default dataset on mount
  useEffect(() => {
    loadDataset(activeFolder);
  }, []);

  // Simulation tick loop
  useEffect(() => {
    if (simIntervalRef.current) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (simMode) {
      simIntervalRef.current = setInterval(() => {
        tickSimulation();
      }, 1000);
    }
    return () => {
      if (simIntervalRef.current) clearInterval(simIntervalRef.current);
    };
  }, [simMode, simSpeed]);

  // Overall threat level for header
  const criticalCount = events.filter((e) => e.severity === 'critical' && e.status === 'ongoing').length;
  const redCount = events.filter((e) => e.severity === 'red' && e.status === 'ongoing').length;
  const threatColor =
    criticalCount > 0 ? 'text-red-400 animate-pulse' :
    redCount > 0 ? 'text-orange-400' :
    events.some((e) => e.severity === 'yellow' && e.status === 'ongoing') ? 'text-yellow-400' :
    'text-green-400';
  const threatLabel =
    criticalCount > 0 ? '🚨 CRITICAL' :
    redCount > 0 ? '🔴 HIGH' :
    events.some((e) => e.severity === 'yellow' && e.status === 'ongoing') ? '🟡 MODERATE' :
    '🟢 NOMINAL';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0e1a]">
      {/* ── Top Navigation ─────────────────────────────────────────────────── */}
      <header className="flex items-center gap-3 px-4 py-2 bg-slate-950 border-b border-slate-800 shrink-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-2 mr-2">
          <div className="text-xl">⚡</div>
          <div>
            <div className="text-sm font-bold text-white tracking-wide">AVON OPS CONSOLE</div>
            <div className="text-xs text-slate-500">ZeroDay Field Monitor</div>
          </div>
        </div>

        {/* Threat badge */}
        <div className={`text-xs font-bold px-3 py-1.5 bg-slate-800 border border-slate-700 rounded ${threatColor}`}>
          {threatLabel}
        </div>

        {/* Dataset selector */}
        <select
          className="bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500"
          value={activeFolder}
          onChange={(e) => loadDataset(e.target.value)}
          disabled={loading}
        >
          {DATASET_FOLDERS.map((f) => (
            <option key={f.path} value={f.path}>{f.name}</option>
          ))}
        </select>

        {loading && (
          <div className="text-xs text-blue-400 animate-pulse">⏳ Loading dataset...</div>
        )}
        {loadError && (
          <div className="text-xs text-red-400">⚠️ {loadError}</div>
        )}

        <div className="flex-1" />

        {/* Sim controls */}
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">SIM</span>
          {(['1', '5', '10', '30'] as const).map((spd) => (
            <button
              key={spd}
              onClick={() => setSimSpeed(Number(spd) as SimSpeed)}
              className={`text-xs px-2 py-1 rounded transition-colors ${
                simSpeed === Number(spd) && simMode
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
              }`}
            >
              {spd}x
            </button>
          ))}
          <button
            onClick={toggleSimMode}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors ${
              simMode
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : 'bg-green-700 hover:bg-green-600 text-white'
            }`}
          >
            {simMode ? '⏹ Stop Sim' : '▶ Start Sim'}
          </button>
        </div>

        {/* Network editor */}
        <button
          onClick={toggleNetworkEditor}
          className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors"
        >
          ⚙️ Editor
        </button>

        {/* Notifications */}
        <NotificationCenter />
      </header>

      {/* ── Dashboard KPIs ─────────────────────────────────────────────────── */}
      <Dashboard />

      {/* ── Main layout ────────────────────────────────────────────────────── */}
      <div className="flex flex-1 overflow-hidden">
        {/* City Map (center) */}
        <div className="flex-1 relative overflow-hidden">
          {!network && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-600">
              <div className="text-center">
                <div className="text-4xl mb-3">🏙️</div>
                <div className="text-lg">Select a dataset to begin</div>
              </div>
            </div>
          )}
          {network && <CityCanvas />}

          {/* Map legend */}
          <div className="absolute bottom-4 left-4 bg-slate-950/90 border border-slate-800 rounded-lg p-3 text-xs space-y-1.5">
            <div className="text-slate-400 font-bold mb-1">LEGEND</div>
            <LegendItem color="text-green-400 bg-green-900/30" dot="●" label="Tank normal" />
            <LegendItem color="text-yellow-400 bg-yellow-900/20" dot="●" label="Tank >70%" />
            <LegendItem color="text-orange-400 bg-orange-900/20" dot="●" label="Tank >85% warning" />
            <LegendItem color="text-red-400 bg-red-900/20" dot="●" label="Tank >92% / pump fail" />
            <LegendItem color="text-blue-300" dot="—" label="Pipeline (color = pressure)" />
            <LegendItem color="text-yellow-300" dot="🚚" label="Emergency truck" />
            <LegendItem color="text-cyan-300" dot="●" label="Disposal site" />
            <LegendItem color="text-yellow-200" dot="■" label="Truck yard" />
          </div>

          {/* Sim mode overlay */}
          {simMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-900/80 border border-blue-500 rounded-full px-4 py-1 text-xs text-blue-300 font-bold">
              🎮 SIMULATION ACTIVE · {simSpeed}x speed
            </div>
          )}
        </div>

        {/* Right sidebar */}
        <div className="w-80 flex flex-col border-l border-slate-800 bg-slate-950/80 shrink-0">
          {/* Sidebar tabs */}
          <div className="flex border-b border-slate-800 shrink-0">
            {(['alerts', 'trucks', 'costs', 'reserve'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 text-xs py-2 font-medium transition-colors capitalize ${
                  sidebarTab === tab
                    ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab === 'alerts' ? '🚨' : tab === 'trucks' ? '🚚' : tab === 'costs' ? '💰' : '🛢️'}
                <span className="ml-1">{tab}</span>
              </button>
            ))}
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'alerts' && <AlertPanel />}
            {sidebarTab === 'trucks' && <TruckTracker />}
            {sidebarTab === 'costs' && <CostPanel />}
            {sidebarTab === 'reserve' && <OilReserve />}
          </div>
        </div>
      </div>

      {/* Asset detail flyout */}
      {selectedAssetId && <AssetDetail />}

      {/* Network editor modal */}
      {showNetworkEditor && <NetworkEditor />}
    </div>
  );
}

function LegendItem({ color, dot, label }: { color: string; dot: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`${color} font-mono text-sm w-3`}>{dot}</span>
      <span className="text-slate-400">{label}</span>
    </div>
  );
}
