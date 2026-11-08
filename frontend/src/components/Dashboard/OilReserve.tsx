import { useAppStore } from '../../store/appStore';

export default function OilReserve() {
  const { oilReserve, useOilReserve, events } = useAppStore();

  const ratio = oilReserve.available_bbl / oilReserve.total_bbl;
  const barColor =
    ratio > 0.6 ? 'bg-green-500' :
    ratio > 0.3 ? 'bg-yellow-400' :
    ratio > 0.1 ? 'bg-orange-500' : 'bg-red-600';

  const statusColor =
    oilReserve.status === 'full' ? 'text-green-400' :
    oilReserve.status === 'partial' ? 'text-yellow-400' :
    oilReserve.status === 'low' ? 'text-orange-400' :
    oilReserve.status === 'critical' ? 'text-red-400' : 'text-red-600';

  const criticalEvents = events.filter(
    (e) => e.category === 'pump_failure' && (e.hours_to_limit ?? 99) < 1
  );

  return (
    <div className="flex flex-col h-full p-3">
      <div className="text-sm font-bold text-slate-200 mb-3">Emergency Oil Reserve</div>

      <div className="bg-slate-800/60 border border-slate-700 rounded-lg p-4 mb-3">
        <div className="flex justify-between items-end mb-2">
          <div>
            <div className="text-xs text-slate-500">Available</div>
            <div className={`text-2xl font-bold ${statusColor}`}>
              {oilReserve.available_bbl.toLocaleString()}
              <span className="text-sm font-normal text-slate-400 ml-1">bbl</span>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs text-slate-500">Total capacity</div>
            <div className="text-sm text-slate-300">{oilReserve.total_bbl.toLocaleString()} bbl</div>
          </div>
        </div>

        <div className="bg-slate-700 rounded-full h-4 overflow-hidden">
          <div
            className={`h-4 rounded-full transition-all duration-500 ${barColor}`}
            style={{ width: `${ratio * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-500 mt-1">
          <span>0</span>
          <span className={`font-bold uppercase ${statusColor}`}>{oilReserve.status}</span>
          <span>{(ratio * 100).toFixed(0)}%</span>
        </div>
      </div>

      <div className="bg-slate-800/40 rounded-lg p-3 mb-3">
        <div className="text-xs text-slate-500 mb-1">Depleted</div>
        <div className="text-slate-300 font-bold">{oilReserve.depleted_bbl.toLocaleString()} bbl</div>
        {oilReserve.last_used && (
          <div className="text-xs text-slate-600 mt-0.5">
            Last used: {new Date(oilReserve.last_used * 1000).toUTCString().slice(0, 25)}
          </div>
        )}
      </div>

      {criticalEvents.length > 0 && (
        <div className="bg-red-900/30 border border-red-700 rounded-lg p-3 mb-3">
          <div className="text-xs font-bold text-red-400 mb-1">Emergency Deployment Recommended</div>
          <p className="text-xs text-slate-400">
            {criticalEvents.length} facility/facilities facing imminent shutdown.
            Reserve deployment can bridge the gap.
          </p>
          <button
            onClick={() => useOilReserve(500)}
            disabled={oilReserve.available_bbl < 500}
            className="mt-2 w-full bg-red-700 hover:bg-red-600 disabled:bg-slate-700 disabled:text-slate-500 text-white text-xs font-bold py-2 rounded transition-colors"
          >
            Deploy 500 bbl Emergency Reserve
          </button>
        </div>
      )}

      <div className="bg-slate-800/40 rounded-lg p-3">
        <div className="text-xs font-bold text-slate-400 mb-2">Manual Deployment</div>
        <p className="text-xs text-slate-500 mb-3">
          Use when: all trucks are busy, shutdown is imminent, or disposal infrastructure is offline.
        </p>
        {[150, 500, 1000].map((amount) => (
          <button
            key={amount}
            onClick={() => useOilReserve(amount)}
            disabled={oilReserve.available_bbl < amount}
            className="w-full mb-1.5 text-xs bg-slate-700 hover:bg-slate-600 disabled:bg-slate-800 disabled:text-slate-600 text-slate-200 py-1.5 rounded transition-colors"
          >
            Deploy {amount.toLocaleString()} bbl
          </button>
        ))}
      </div>
    </div>
  );
}
