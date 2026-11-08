import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
import { useAppStore } from './store/appStore';
import ControlsMenu from './components/Controls/ControlsMenu';
import CityCanvas from './components/CityMap/CityCanvas';
import AlertPanel from './components/AlertPanel/AlertPanel';
import Dashboard from './components/Dashboard/Dashboard';
import TruckTracker from './components/TruckTracker/TruckTracker';
import CostPanel from './components/CostPanel/CostPanel';
import AssetDetail from './components/Dashboard/AssetDetail';
import NotificationCenter from './components/Notifications/NotificationCenter';
import NetworkEditor from './components/NetworkEditor/NetworkEditor';
import type { CityTemperatures } from './components/CityMap/CityCanvas';
import type { Notification, AlertSeverity } from './types';
import ReplayBar from './components/Replay/ReplayBar';

export default function App() {
  const {
    loadDataset,
    loadDatasets,
    datasets,
    backendOnline,
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
  // Legend starts collapsed so it doesn't cover facilities in the bottom-left (one click opens it)
  const [isLegendMinimized, setIsLegendMinimized] = useState(true);
  const [weatherNow, setWeatherNow] = useState<CityTemperatures>({});
  const [tempAlerts, setTempAlerts] = useState<Set<string>>(new Set());
  const [weatherSimMode, setWeatherSimMode] = useState(false);
  const [showRain, setShowRain] = useState(false);
  const [showTornado, setShowTornado] = useState(false);

  // Real weather at the replay time -> alerts. They stay below equipment alerts in the panel.
  const weatherAlertIds = useRef<Set<string>>(new Set());
  const handleTemperaturesChange = (temps: CityTemperatures) => {
    setWeatherNow(temps);
    const { addNotification, removeNotification, nowUnix: tNow } = useAppStore.getState();
    const active = new Set<string>();
    for (const [city, wx] of Object.entries(temps)) {
      const checks: [string, boolean, AlertSeverity, string, string][] = [
        ['storm', (wx.code ?? 0) >= 95, 'major', `Thunderstorm near ${city}`,
          `Lightning and heavy rain near ${city}. Keep crews off exposed equipment; truck trips to nearby facilities may run late.`],
        ['rain', (wx.code ?? 0) < 95 && (wx.precip_mm ?? 0) >= 2.5, 'minor', `Heavy rain near ${city}`,
          `${(wx.precip_mm ?? 0).toFixed(1)} mm of rain in the last hour near ${city}. Lease roads may slow emergency trucks.`],
        ['wind', (wx.wind_mph ?? 0) >= 30, 'minor', `High winds near ${city}`,
          `Winds around ${Math.round(wx.wind_mph ?? 0)} mph near ${city}.`],
        ['heat', (wx.temp ?? 0) >= 100, 'minor', `Extreme heat in ${city}`,
          `${Math.round(wx.temp ?? 0)}°F in ${city}. Rotate field crews and watch pump temperatures.`],
        ['cold', wx.temp !== undefined && wx.temp <= 25, 'minor', `Hard freeze in ${city}`,
          `${Math.round(wx.temp ?? 0)}°F in ${city}. Watch for frozen lines.`],
      ];
      for (const [kind, on, severity, title, message] of checks) {
        if (!on) continue;
        const id = `wx_${kind}_${city}`;
        active.add(id);
        if (!weatherAlertIds.current.has(id)) {
          addNotification({
            id, ts: tNow, severity, title, message, read: false, requires_user_action: true,
            current_status: 'Recorded weather at this time (Open-Meteo)',
          });
        }
      }
    }
    for (const id of weatherAlertIds.current) if (!active.has(id)) removeNotification(id);
    weatherAlertIds.current = active;
  };

  // Tornado watch alert
  useEffect(() => {
    const tornadoAlertId = 'weather_tornado_watch';
    const { addNotification, removeNotification } = useAppStore.getState();
    
    if (weatherSimMode && showTornado && !tempAlerts.has('tornado_watch')) {
      const notification: Notification = {
        id: tornadoAlertId,
        ts: Date.now(),
        severity: 'major',
        title: 'DRILL: Tornado watch',
        message: 'Training drill (not real weather). All personnel should review shelter procedures.',
        read: false,
        requires_user_action: true,
      };
      console.log('Tornado Watch Alert:', notification);
      addNotification(notification);
      setTempAlerts(prev => new Set([...prev, 'tornado_watch']));
    } else if (!showTornado && tempAlerts.has('tornado_watch')) {
      removeNotification(tornadoAlertId);
      setTempAlerts(prev => {
        const newSet = new Set(prev);
        newSet.delete('tornado_watch');
        return newSet;
      });
    }
  }, [weatherSimMode, showTornado, tempAlerts]);

  // Thunderstorm alert
  useEffect(() => {
    const thunderstormAlertId = 'weather_thunderstorm_warning';
    const { addNotification, removeNotification } = useAppStore.getState();
    
    if (weatherSimMode && showRain && !tempAlerts.has('thunderstorm_warning')) {
      const notification: Notification = {
        id: thunderstormAlertId,
        ts: Date.now(),
        severity: 'minor',
        title: 'DRILL: Thunderstorm',
        message: 'Training drill (not real weather). Practice reducing outdoor operations and protecting equipment.',
        read: false,
        requires_user_action: true,
      };
      console.log('Thunderstorm Warning Alert:', notification);
      addNotification(notification);
      setTempAlerts(prev => new Set([...prev, 'thunderstorm_warning']));
    } else if (!showRain && tempAlerts.has('thunderstorm_warning')) {
      removeNotification(thunderstormAlertId);
      setTempAlerts(prev => {
        const newSet = new Set(prev);
        newSet.delete('thunderstorm_warning');
        return newSet;
      });
    }
  }, [weatherSimMode, showRain, tempAlerts]);

  // Load the dataset list from the backend, then the default dataset
  useEffect(() => {
    loadDatasets();
    loadDataset(activeFolder);
  }, []);

  // Simulation tick loop — recreate whenever simMode or simSpeed changes
  useEffect(() => {
    // Always clear any existing interval first
    if (simIntervalRef.current !== null) {
      clearInterval(simIntervalRef.current);
      simIntervalRef.current = null;
    }
    if (simMode) {
      simIntervalRef.current = setInterval(() => {
        tickSimulation();
      }, 1000);
    }
    return () => {
      if (simIntervalRef.current !== null) {
        clearInterval(simIntervalRef.current);
        simIntervalRef.current = null;
      }
    };
  }, [simMode, simSpeed]);

  // Overall threat level for header
  const criticalCount = events.filter((e) => e.severity === 'critical' && e.status === 'ongoing').length;
  const severeCount = events.filter((e) => e.severity === 'severe' && e.status === 'ongoing').length;
  const threatColor =
    criticalCount > 0 ? 'text-red-400 animate-pulse' :
    severeCount > 0 ? 'text-orange-400' :
    events.some((e) => e.severity === 'major' && e.status === 'ongoing') ? 'text-yellow-400' :
    events.some((e) => e.severity === 'minor' && e.status === 'ongoing') ? 'text-slate-400' :
    'text-green-400';
  const threatLabel =
    criticalCount > 0 ? 'CRITICAL' :
    severeCount > 0 ? 'SEVERE' :
    events.some((e) => e.severity === 'major' && e.status === 'ongoing') ? 'MAJOR' :
    events.some((e) => e.severity === 'minor' && e.status === 'ongoing') ? 'MINOR' :
    'NOMINAL';

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#0a0e1a]">
      {/* Top Navigation */}
      <header className="flex items-center gap-3 px-4 py-2 bg-slate-950 border-b border-slate-800 shrink-0 z-40">
        {/* Logo */}
        <div className="flex items-center gap-3 mr-4">
          <img src="/eog-logo.svg" alt="EOG Resources" className="h-16 w-auto" />
          <div>
            <div className="text-lg font-bold text-white tracking-wide">EOG OPS CONSOLE</div>
            <div className="text-sm text-white">ZeroDay Field Monitor</div>
          </div>
        </div>

        {/* Threat badge */}
        <div className={`text-xs font-bold px-3 py-1.5 bg-slate-800 border border-slate-700 rounded ${threatColor}`}>
          {threatLabel}
        </div>

        {/* Backend status (the dataset picker lives in the Controls menu) */}
        {!loading && (
          <span
            className={`text-xs ${backendOnline ? 'text-green-400' : 'text-yellow-400'}`}
            title={backendOnline ? 'Analysis from the backend' : 'Backend offline: using in-browser analysis'}
          >
            {backendOnline ? '● Backend' : '● Offline mode'}
          </span>
        )}

        {loading && (
          <div className="text-xs text-blue-400 animate-pulse">Loading dataset...</div>
        )}
        {loadError && (
          <div className="text-xs text-red-400">Error: {loadError}</div>
        )}

        <div className="flex-1" />

        {/* Replay / data / weather controls (popover) */}
        <ControlsMenu
          activeFolder={activeFolder}
          loading={loading}
          datasets={datasets}
          onRefreshDatasets={loadDatasets}
          onDatasetChange={loadDataset}
          simMode={simMode}
          simSpeed={simSpeed}
          onToggleSim={toggleSimMode}
          onSetSimSpeed={setSimSpeed}
          weatherSimMode={weatherSimMode}
          onToggleWeatherSim={() => setWeatherSimMode(!weatherSimMode)}
          showRain={showRain}
          onShowRainChange={setShowRain}
          showTornado={showTornado}
          onShowTornadoChange={setShowTornado}
        />

        {/* Network editor */}
        <button
          onClick={toggleNetworkEditor}
          className="text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-300 px-3 py-1.5 rounded transition-colors"
        >
          Editor
        </button>

        {/* Notifications */}
        <NotificationCenter />
      </header>

      {/* Dashboard KPIs */}
      <Dashboard />

      {/* Main layout */}
      <div className="flex flex-1 overflow-hidden">
        {/* Map (center): replay timeline strip on top, map below */}
        <div className="flex-1 flex flex-col overflow-hidden">
        {network && <ReplayBar weather={weatherNow} />}
        <div className="flex-1 relative overflow-hidden">
          {!network && !loading && (
            <div className="absolute inset-0 flex items-center justify-center text-slate-600">
              <div className="text-center">
                <div className="text-lg">Select a dataset to begin</div>
              </div>
            </div>
          )}
          {network && <CityCanvas onTemperaturesChange={handleTemperaturesChange} weatherSimActive={weatherSimMode} showRain={showRain} showTornado={showTornado} />}

          {/* Map legend */}
          <div className="absolute bottom-4 left-4 bg-white/90 border border-gray-300 shadow-md rounded-lg p-3 text-xs space-y-1.5">
            <div className="flex items-center justify-between mb-2">
              <div className="text-gray-600 font-bold tracking-wide">LEGEND</div>
              <button
                onClick={() => setIsLegendMinimized(!isLegendMinimized)}
                className="ml-2 p-0.5 hover:bg-gray-200 rounded transition-colors"
                title={isLegendMinimized ? 'Expand' : 'Collapse'}
              >
                {isLegendMinimized ? (
                  <ChevronUp size={16} className="text-gray-600" />
                ) : (
                  <ChevronDown size={16} className="text-gray-600" />
                )}
              </button>
            </div>
            {!isLegendMinimized && (
              <>
                <LegendItem color="bg-blue-300"   label="Recorded rain / storms" />
                <div className="border-t border-gray-300 my-1"></div>
                <LegendItem color="bg-green-500"  label="Tank normal" />
                <LegendItem color="bg-yellow-400" label="Tank &gt;70%" />
                <LegendItem color="bg-orange-500" label="Tank &gt;85% warning" />
                <LegendItem color="bg-red-500"    label="Tank &gt;92% / pump fault" />
                <LegendItem color="bg-blue-400"   label="Pipeline (underground)" />
                <LegendItem color="bg-yellow-400" label="Emergency truck" />
                <LegendItem color="bg-blue-500"   label="Disposal site" />
                <LegendItem color="bg-amber-800"  label="Truck yard" />
                <LegendItem color="bg-gray-300"   label="City boundary" />
              </>
            )}
          </div>
        </div>
        </div>

        {/* Right sidebar */}
        <div className="w-80 flex flex-col border-l border-slate-800 bg-slate-950/80 shrink-0">
          {/* Sidebar tabs */}
          <div className="flex border-b border-slate-800 shrink-0">
            {(['alerts', 'trucks', 'costs'] as const).map((tab) => (
              <button
                key={tab}
                onClick={() => setSidebarTab(tab)}
                className={`flex-1 text-xs py-2 font-medium transition-colors capitalize ${
                  sidebarTab === tab
                    ? 'bg-slate-800 text-white border-b-2 border-blue-500'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {tab}
              </button>
            ))}
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-hidden">
            {sidebarTab === 'alerts' && <AlertPanel />}
            {sidebarTab === 'trucks' && <TruckTracker />}
            {sidebarTab === 'costs' && <CostPanel />}
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

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-sm shrink-0 ${color}`} />
      <span className="text-gray-600">{label}</span>
    </div>
  );
}
