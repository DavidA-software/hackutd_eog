import { useAppStore } from '../../store/appStore';
import type { TruckDispatch, TruckStatus } from '../../types';

const STATUS_STEPS: TruckStatus[] = ['dispatched', 'en_route', 'on_site', 'returning'];

const STATUS_COLOR: Record<TruckStatus, string> = {
  idle: 'text-slate-400',
  dispatched: 'text-blue-400',
  en_route: 'text-yellow-400',
  on_site: 'text-green-400',
  returning: 'text-cyan-400',
  delayed: 'text-red-400',
};

const STATUS_LABEL: Record<TruckStatus, string> = {
  idle: 'Idle',
  dispatched: 'Dispatched',
  en_route: 'En Route',
  on_site: 'On Site',
  returning: 'Returning',
  delayed: 'DELAYED',
};

function TruckProgressBar({ truck }: { truck: TruckDispatch }) {
  const stepIdx = STATUS_STEPS.indexOf(truck.status);
  const progress = stepIdx < 0 ? 0 : ((stepIdx + 1) / STATUS_STEPS.length) * 100;

  return (
    <div className="mt-2">
      <div className="flex justify-between mb-1">
        {STATUS_STEPS.map((s, i) => (
          <div key={s} className={`text-xs ${i <= stepIdx ? STATUS_COLOR[s] : 'text-slate-600'}`}>
            {STATUS_LABEL[s]}
          </div>
        ))}
      </div>
      <div className="bg-slate-700 rounded-full h-2 relative overflow-hidden">
        <div
          className={`h-2 rounded-full transition-all duration-1000 ${truck.on_time ? 'bg-yellow-400' : 'bg-red-500'}`}
          style={{ width: `${progress}%` }}
        />
        <div
          className="absolute top-0 -translate-x-1/2 w-2 h-2 rounded-full bg-white truck-moving"
          style={{ left: `${progress}%` }}
        />
      </div>
    </div>
  );
}

function TruckCard({ truck }: { truck: TruckDispatch }) {
  const { nowUnix } = useAppStore();
  const etaMinutes = Math.max(0, Math.round((truck.eta_arrival - nowUnix) / 60));
  const isLate = !truck.on_time || truck.delay_min > 0;

  return (
    <div
      className={`bg-slate-800/60 border rounded-lg p-3 mb-2 ${
        isLate ? 'border-red-700' : 'border-slate-700'
      }`}
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-bold text-slate-200">{truck.id}</div>
          <div className="text-xs text-slate-400">{truck.facility_id.replace(/_/g, ' ')}</div>
        </div>
        <div
          className={`text-xs font-bold px-2 py-1 rounded ${
            isLate ? 'bg-red-900/40 text-red-400' : 'bg-green-900/30 text-green-400'
          }`}
        >
          {isLate ? `${truck.delay_min}min delay` : 'On Time'}
        </div>
      </div>

      <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-slate-500">Status</div>
          <div className={`font-bold ${STATUS_COLOR[truck.status]}`}>{STATUS_LABEL[truck.status]}</div>
        </div>
        <div>
          <div className="text-slate-500">ETA Arrival</div>
          <div className="text-slate-200">
            {truck.status === 'on_site' ? 'On site' :
             truck.status === 'returning' ? 'Done' :
             `~${etaMinutes}min`}
          </div>
        </div>
        <div>
          <div className="text-slate-500">Capacity</div>
          <div className="text-slate-200">{truck.capacity_bbl} bbl</div>
        </div>
      </div>

      <TruckProgressBar truck={truck} />

      {isLate && (
        <div className="mt-2 bg-red-900/20 border border-red-700/40 rounded p-2 text-xs">
          <div className="text-red-400 font-bold mb-1">Risk Factors</div>
          <ul className="text-slate-400 space-y-0.5">
            {truck.delay_min > 0 && <li>- Truck delayed {truck.delay_min} minutes</li>}
            <li>- Mitigation: Dispatch backup truck from nearest yard</li>
            <li>- Fallback: Shut in lowest-revenue well</li>
          </ul>
        </div>
      )}
    </div>
  );
}

export default function TruckTracker() {
  const { trucks, events, dispatchTruck, ops } = useAppStore();
  const activeTrucks = trucks.filter((t) => t.status !== 'idle');
  const pumpFailures = events.filter((e) => e.category === 'pump_failure' && e.status === 'ongoing');

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-sm font-bold text-slate-200">Truck Tracker</span>
          <span className="bg-yellow-600 text-white text-xs px-2 py-0.5 rounded-full">
            {activeTrucks.length} active
          </span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {activeTrucks.length === 0 && (
          <div className="text-center py-6 text-slate-500 text-sm">
            <div>No trucks dispatched</div>
          </div>
        )}

        {activeTrucks.map((t) => (
          <TruckCard key={t.id} truck={t} />
        ))}

        {pumpFailures.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">
              Dispatch Available
            </div>
            {pumpFailures.map((evt) => {
              const alreadyDispatched = trucks.some(
                (t) => t.event_id === evt.id && t.status !== 'idle'
              );
              const sysOps = ops?.systems[evt.system];
              const fleet = sysOps?.emergency_fleet_size ?? 0;
              const activeSysTrucks = trucks.filter(
                (t) =>
                  t.system_id === evt.system &&
                  (t.status === 'en_route' || t.status === 'on_site')
              ).length;
              const available = fleet - activeSysTrucks;

              return (
                <div
                  key={evt.id}
                  className="bg-slate-800/50 border border-slate-700 rounded p-2 mb-2"
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <div className="text-xs font-bold text-orange-300">
                        {evt.facility.replace(/_/g, ' ')}
                      </div>
                      <div className="text-xs text-slate-500">
                        Tank: {evt.level_pct?.toFixed(1)}% · Shutdown in:{' '}
                        {evt.hours_to_limit?.toFixed(1)}h
                      </div>
                      <div className="text-xs text-slate-600">
                        {available}/{fleet} trucks available
                      </div>
                    </div>
                    <button
                      disabled={alreadyDispatched || available <= 0}
                      onClick={() => dispatchTruck(evt.id)}
                      className={`text-xs px-3 py-1.5 rounded font-bold transition-colors ${
                        alreadyDispatched
                          ? 'bg-slate-700 text-slate-500 cursor-not-allowed'
                          : available <= 0
                          ? 'bg-red-900/40 text-red-400 cursor-not-allowed'
                          : 'bg-yellow-600 hover:bg-yellow-500 text-black cursor-pointer'
                      }`}
                    >
                      {alreadyDispatched ? 'Dispatched' : available <= 0 ? 'No trucks' : 'Dispatch'}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
