import { useEffect, useRef, useState } from 'react';
import { ChevronUp, ChevronDown } from 'lucide-react';
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
import type { CityTemperatures } from './components/CityMap/CityCanvas';
import type { Notification } from './types';

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
  const [isLegendMinimized, setIsLegendMinimized] = useState(false);
  const [tempAlerts, setTempAlerts] = useState<Set<string>>(new Set());
  const [weatherSimMode, setWeatherSimMode] = useState(false);
  const [showRain, setShowRain] = useState(false);
  const [showTornado, setShowTornado] = useState(false);

  // Handle temperature data and create alerts
  const handleTemperaturesChange = (temps: CityTemperatures) => {
    const newAlerts = new Set<string>();
    
    for (const [cityName, temp] of Object.entries(temps)) {
      const alertKey = cityName;
      
      if (temp.high > 100) {
        // Hot weather warning
        if (!tempAlerts.has(`${alertKey}_hot`)) {
          const notification: any = {
            id: `weather_hot_${alertKey}_${Date.now()}`,
            ts: Date.now(),
            severity: 'major',
            title: '🔥 Hot Weather Warning',
            message: `Extreme heat detected in ${cityName}: High ${temp.high}°F. Monitor operations and ensure proper cooling.`,
            read: false,
            requires_user_action: false,
          };
          // Add to notifications - would need to add this to store
          console.log('Temperature Alert:', notification);
        }
        newAlerts.add(`${alertKey}_hot`);
      } else if (temp.low < 20) {
        // Cold weather warning
        if (!tempAlerts.has(`${alertKey}_cold`)) {
          const notification: any = {
            id: `weather_cold_${alertKey}_${Date.now()}`,
            ts: Date.now(),
            severity: 'major',
            title: '❄️ Cold Weather Warning',
            message: `Extreme cold detected in ${cityName}: Low ${temp.low}°F. Monitor for freeze-related issues.`,
            read: false,
            requires_user_action: false,
          };
          console.log('Temperature Alert:', notification);
        }
        newAlerts.add(`${alertKey}_cold`);
      }
    }
    
    setTempAlerts(newAlerts);
  };

  // Tornado watch alert
  useEffect(() => {
    const tornadoAlertId = 'weather_tornado_watch';
    const { addNotification, removeNotification } = useAppStore.getState();
    
    if (weatherSimMode && showTornado && !tempAlerts.has('tornado_watch')) {
      const notification: Notification = {
        id: tornadoAlertId,
        ts: Date.now(),
        severity: 'critical',
        title: 'TORNADO WATCH ALERT',
        message: 'Tornado simulation active. All personnel should monitor conditions and seek shelter if necessary. Equipment status critical.',
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
        severity: 'severe',
        title: 'THUNDERSTORM WARNING',
        message: 'Severe thunderstorm conditions detected. Heavy precipitation and electrical activity present. Reduce outdoor operations and ensure equipment protection.',
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

  // Load default dataset on mount
  useEffect(() => {
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
          <div className="text-xs text-blue-400 animate-pulse">Loading dataset...</div>
        )}
        {loadError && (
          <div className="text-xs text-red-400">Error: {loadError}</div>
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
            {simMode ? 'Stop Data Sim' : 'Start Data Sim'}
          </button>
        </div>

        {/* Weather Sim controls */}
        <div className="flex items-center gap-2 ml-4 pl-4 border-l border-slate-700">
          <span className="text-xs text-slate-500">WEATHER</span>
          <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showRain}
              onChange={(e) => setShowRain(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Thunderstorm</span>
          </label>
          <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
            <input
              type="checkbox"
              checked={showTornado}
              onChange={(e) => setShowTornado(e.target.checked)}
              className="w-3 h-3"
            />
            <span>Tornado</span>
          </label>
          <button
            onClick={() => setWeatherSimMode(!weatherSimMode)}
            className={`text-xs px-3 py-1.5 rounded font-bold transition-colors ${
              weatherSimMode
                ? 'bg-red-700 hover:bg-red-600 text-white'
                : 'bg-purple-700 hover:bg-purple-600 text-white'
            }`}
          >
            {weatherSimMode ? 'Stop Weather Sim' : 'Start Weather Sim'}
          </button>
        </div>

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
        {/* Map (center) */}
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
                <LegendItem color="bg-blue-300"   label="Weather radar overlay" />
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

          {/* Sim mode overlay */}
          {simMode && (
            <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-blue-900/80 border border-blue-500 rounded-full px-4 py-1 text-xs text-blue-300 font-bold">
              SIMULATION ACTIVE · {simSpeed}x speed
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
                {tab}
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

function LegendItem({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`inline-block w-3 h-3 rounded-sm shrink-0 ${color}`} />
      <span className="text-gray-600">{label}</span>
    </div>
  );
}
