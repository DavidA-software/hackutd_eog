import { useAppStore } from '../../store/appStore';
import { latestValue } from '../../data/loader';
import SensorChart from '../SensorChart/SensorChart';

export default function AssetDetail() {
  const { selectedAssetId, network, telemetryIndex, nowUnix, events, selectAsset } = useAppStore();

  if (!selectedAssetId || !network || !telemetryIndex) return null;

  // Find what system/facility this belongs to
  let systemId = '';
  let facilityId = '';
  for (const sys of network.systems) {
    for (const fac of sys.facilities) {
      if (
        fac.id === selectedAssetId ||
        fac.pump.id === selectedAssetId ||
        fac.tank.id === selectedAssetId ||
        fac.pipeline.id === selectedAssetId ||
        fac.wells.some((w) => w.id === selectedAssetId)
      ) {
        systemId = sys.id;
        facilityId = fac.id;
        break;
      }
    }
  }

  const system = network.systems.find((s) => s.id === systemId);
  const facility = system?.facilities.find((f) => f.id === facilityId);
  if (!system || !facility) return null;

  const facilityEvents = events.filter((e) => e.facility === facilityId);
  const tankLevel = latestValue(telemetryIndex, facility.tank.id, 'level_pct', nowUnix) ?? 0;
  const pumpStatus = latestValue(telemetryIndex, facility.pump.id, 'status', nowUnix) ?? 1;
  const pumpFlow = latestValue(telemetryIndex, facility.pump.id, 'flow_bpd', nowUnix) ?? 0;
  const pipeFlow = latestValue(telemetryIndex, facility.pipeline.id, 'receive_flow_bpd', nowUnix) ?? 0;
  const pipePsi = latestValue(telemetryIndex, facility.pipeline.id, 'pressure_psi', nowUnix) ?? 0;

  const fillColor =
    tankLevel >= 92 ? 'text-red-400' :
    tankLevel >= 85 ? 'text-orange-400' :
    tankLevel >= 70 ? 'text-yellow-400' : 'text-green-400';

  return (
    <div className="fixed right-80 top-16 bottom-0 w-72 bg-slate-950/95 border-l border-slate-800 overflow-y-auto z-30 shadow-2xl">
      <div className="flex items-center justify-between p-3 border-b border-slate-800 sticky top-0 bg-slate-950/95">
        <div>
          <div className="text-xs font-bold text-slate-200">{facility.id.replace(/_/g, ' ')}</div>
          <div className="text-xs text-slate-500">{systemId}</div>
        </div>
        <button onClick={() => selectAsset(null)} className="text-slate-500 hover:text-white">✕</button>
      </div>

      <div className="p-3 space-y-3">
        {/* Live readings */}
        <div className="bg-slate-800/50 rounded-lg p-3 grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500">Tank Level</div>
            <div className={`text-lg font-bold ${fillColor}`}>{tankLevel.toFixed(1)}%</div>
            <div className="bg-slate-700 rounded-full h-1.5 mt-1">
              <div
                className={`h-1.5 rounded-full ${tankLevel >= 85 ? 'bg-red-500' : 'bg-cyan-400'}`}
                style={{ width: `${tankLevel}%` }}
              />
            </div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Pump</div>
            <div className={`font-bold ${pumpStatus === 1 ? 'text-green-400' : 'text-red-400'}`}>
              {pumpStatus === 1 ? '✅ Running' : '❌ Failed'}
            </div>
            <div className="text-xs text-slate-400">{pumpFlow.toFixed(0)} bpd</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Pipeline Flow</div>
            <div className="text-slate-200 font-bold">{pipeFlow.toFixed(0)} bpd</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Pressure</div>
            <div className={`font-bold ${pipePsi > facility.pipeline.max_pressure_psi * 0.9 ? 'text-red-400' : 'text-slate-200'}`}>
              {pipePsi.toFixed(0)} psi
            </div>
          </div>
        </div>

        {/* Active events for this facility */}
        {facilityEvents.length > 0 && (
          <div>
            <div className="text-xs font-bold text-slate-400 mb-2">Active Events</div>
            {facilityEvents.map((evt) => (
              <div key={evt.id} className="bg-red-900/20 border border-red-800/40 rounded p-2 mb-1 text-xs">
                <div className="text-red-300 font-bold capitalize">{evt.category.replace(/_/g, ' ')}</div>
                {evt.hours_to_limit != null && (
                  <div className="text-slate-400">{evt.hours_to_limit.toFixed(1)}h to shutdown</div>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Wells */}
        <div>
          <div className="text-xs font-bold text-slate-400 mb-2">Wells ({facility.wells.length})</div>
          {facility.wells.map((w) => {
            const wStatus = latestValue(telemetryIndex, w.id, 'status', nowUnix) ?? 1;
            const wFlow = latestValue(telemetryIndex, w.id, 'water_bpd', nowUnix) ?? 0;
            return (
              <div key={w.id} className="flex justify-between py-1 border-b border-slate-800 text-xs">
                <span className={wStatus === 1 ? 'text-green-400' : 'text-red-400'}>
                  {wStatus === 1 ? '●' : '○'} {w.id.split('_').pop()}
                </span>
                <span className="text-slate-400">{wFlow.toFixed(0)} bpd</span>
                <span className="text-slate-500">{w.oil_bpd} bbl oil/d</span>
              </div>
            );
          })}
        </div>

        {/* Sensor charts */}
        <div className="text-xs font-bold text-slate-400 mb-1">Sensor History</div>
        <SensorChart assetId={facility.tank.id} windowHours={8} />
        <SensorChart assetId={facility.pump.id} windowHours={8} />
        <SensorChart assetId={facility.pipeline.id} windowHours={8} />
      </div>
    </div>
  );
}
