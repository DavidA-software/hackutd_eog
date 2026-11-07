import { useAppStore } from '../../store/appStore';
import type { DetectedEvent, AlertSeverity } from '../../types';

const SEV_COLOR: Record<AlertSeverity, string> = {
  green: 'border-green-500 bg-green-900/20',
  yellow: 'border-yellow-400 bg-yellow-900/20',
  red: 'border-orange-500 bg-orange-900/20',
  critical: 'border-red-500 bg-red-900/30 animate-pulse',
};

const SEV_BADGE: Record<AlertSeverity, string> = {
  green: 'bg-green-500 text-white',
  yellow: 'bg-yellow-400 text-black',
  red: 'bg-orange-500 text-white',
  critical: 'bg-red-600 text-white',
};


const CAT_ICON: Record<string, string> = {
  pump_failure: '🔴',
  pump_degradation: '🔧',
  pipeline_leak: '💧',
};

function hoursLabel(h: number | undefined): string {
  if (h == null) return '—';
  if (h < 1) return `${Math.round(h * 60)}min`;
  return `${h.toFixed(1)}h`;
}

function EventCard({ event, onClick }: { event: DetectedEvent; onClick: () => void }) {
  return (
    <div
      className={`border-l-4 rounded-r p-3 mb-2 cursor-pointer hover:brightness-110 transition-all ${SEV_COLOR[event.severity]}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-sm">{CAT_ICON[event.category]}</span>
          <span className="text-xs font-bold text-slate-200">
            {event.asset.replace(/_/g, ' ')}
          </span>
          {event.status === 'predicted' && (
            <span className="text-xs bg-slate-700 text-slate-300 px-1 rounded">PREDICTED</span>
          )}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded font-bold ${SEV_BADGE[event.severity]}`}>
          {event.severity.toUpperCase()}
        </span>
      </div>

      <div className="text-xs text-slate-400 mb-1">
        {event.system} · {event.facility.replace(/^[A-Z]\d_/, '')}
      </div>

      {event.category === 'pump_failure' && (
        <div className="flex gap-3 mt-1">
          <div className="text-xs">
            <span className="text-slate-500">Tank: </span>
            <span className={`font-bold ${event.level_pct && event.level_pct >= 85 ? 'text-red-400' : 'text-yellow-300'}`}>
              {event.level_pct?.toFixed(1) ?? '—'}%
            </span>
          </div>
          <div className="text-xs">
            <span className="text-slate-500">Shutdown in: </span>
            <span className={`font-bold ${(event.hours_to_limit ?? 99) < 2 ? 'text-red-400' : 'text-orange-300'}`}>
              {hoursLabel(event.hours_to_limit)}
            </span>
          </div>
          {event.order !== undefined && (
            <div className="text-xs text-slate-500">Priority #{event.order}</div>
          )}
        </div>
      )}

      {event.recommended_action && (
        <div className="mt-2 text-xs bg-slate-800/60 rounded p-2">
          <span className="text-green-400 font-bold">Best plan: </span>
          <span className="text-slate-300">
            {event.recommended_action.cheapest.type === 'truck' &&
              `${event.recommended_action.cheapest.truck_count} truck(s), ${event.recommended_action.cheapest.trip_count} trip(s) · $${event.recommended_action.cheapest.total_cost.toLocaleString()}`}
            {event.recommended_action.cheapest.type === 'shut_in' &&
              `Shut in ${event.recommended_action.cheapest.well_id} · $${event.recommended_action.cheapest.total_cost.toLocaleString()}`}
            {event.recommended_action.cheapest.type === 'do_nothing' &&
              `Do nothing · $${event.recommended_action.cheapest.total_cost.toLocaleString()}`}
          </span>
          <div className="text-slate-500 mt-0.5">
            Cost of doing nothing: <span className="text-red-400">${event.recommended_action.cost_of_doing_nothing.toLocaleString()}</span>
            {event.recommended_action.savings > 0 && (
              <span className="text-green-400 ml-2">Save ${event.recommended_action.savings.toLocaleString()}</span>
            )}
          </div>
        </div>
      )}

      <div className="mt-1 flex items-center gap-2">
        <div className="text-xs text-slate-600">
          Confidence: {Math.round(event.confidence * 100)}%
        </div>
        <div className="flex-1 bg-slate-800 rounded-full h-1">
          <div
            className="h-1 rounded-full bg-blue-400"
            style={{ width: `${event.confidence * 100}%` }}
          />
        </div>
      </div>
    </div>
  );
}

export default function AlertPanel() {
  const { events, predictions, selectAsset } = useAppStore();

  const activeEvents = events.filter((e) => e.status === 'ongoing');
  const criticalCount = activeEvents.filter((e) => e.severity === 'critical').length;
  const redCount = activeEvents.filter((e) => e.severity === 'red').length;
  const yellowCount = activeEvents.filter((e) => e.severity === 'yellow').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-slate-200">🚨 Active Alerts</span>
          <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
            {activeEvents.length}
          </span>
        </div>
        <div className="flex gap-2">
          {criticalCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400">{criticalCount} critical</span>
            </div>
          )}
          {redCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-orange-400">{redCount} high</span>
            </div>
          )}
          {yellowCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-yellow-300">{yellowCount} medium</span>
            </div>
          )}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-3">
        {activeEvents.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <div className="text-2xl mb-2">✅</div>
            <div className="text-sm">All systems nominal</div>
          </div>
        )}

        {/* Sort: critical → red → yellow */}
        {[...activeEvents]
          .sort((a, b) => {
            const order = { critical: 0, red: 1, yellow: 2, green: 3 };
            return order[a.severity] - order[b.severity];
          })
          .map((event) => (
            <EventCard
              key={event.id}
              event={event}
              onClick={() => selectAsset(event.facility)}
            />
          ))}

        {/* Predictions */}
        {predictions.length > 0 && (
          <>
            <div className="text-xs text-slate-500 font-bold mt-4 mb-2 uppercase tracking-wider">
              ⚡ Predicted Risks
            </div>
            {predictions
              .filter((p) => p.severity !== 'green')
              .map((event) => (
                <EventCard
                  key={event.id}
                  event={event}
                  onClick={() => selectAsset(event.facility)}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
