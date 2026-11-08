import { useAppStore } from '../../store/appStore';
import type { DetectedEvent, AlertSeverity, Notification } from '../../types';

const SEV_COLOR: Record<AlertSeverity, string> = {
  minor:    'border-slate-400 bg-slate-800/30',
  major:    'border-yellow-400 bg-yellow-900/20',
  severe:   'border-orange-500 bg-orange-900/20',
  critical: 'border-red-500 bg-red-900/30 animate-pulse',
};

const SEV_BADGE: Record<AlertSeverity, string> = {
  minor:    'bg-slate-500 text-white',
  major:    'bg-yellow-400 text-black',
  severe:   'bg-orange-500 text-white',
  critical: 'bg-red-600 text-white',
};

const CAT_LABEL: Record<string, string> = {
  pump_failure: 'PUMP FAILURE',
  pump_degradation: 'PUMP DEGRADATION',
  pipeline_leak: 'PIPELINE LEAK',
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
          <span className="text-xs font-bold text-slate-300">
            {CAT_LABEL[event.category] ?? event.category}
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
        {event.asset.replace(/_/g, ' ')}
      </div>

      <div className="text-xs text-slate-500 mb-1">
        {event.system} · {event.facility.replace(/^S\d+_/, '').replace(/_/g, ' ')}
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
              `No Action · $${event.recommended_action.cheapest.total_cost.toLocaleString()}`}
          </span>
          <div className="text-slate-500 mt-0.5">
            Cost of No Action: <span className="text-red-400">${event.recommended_action.cost_of_doing_nothing.toLocaleString()}</span>
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

function NotificationCard({ notification }: { notification: Notification }) {
  return (
    <div
      className={`border-l-4 rounded-r p-3 mb-2 ${SEV_COLOR[notification.severity]}`}
    >
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-bold text-slate-300">
          {notification.title}
        </span>
        <span className={`text-xs px-2 py-0.5 rounded font-bold ${SEV_BADGE[notification.severity]}`}>
          {notification.severity.toUpperCase()}
        </span>
      </div>

      <div className="text-xs text-slate-400 mb-1">
        {notification.message}
      </div>

      {notification.current_status && (
        <div className="text-xs text-slate-500 mb-1">
          Status: {notification.current_status}
        </div>
      )}

      {notification.system_action && (
        <div className="text-xs bg-slate-800/60 rounded p-2 mt-2">
          <span className="text-blue-400">System: </span>
          <span className="text-slate-300">{notification.system_action}</span>
        </div>
      )}
    </div>
  );
}

export default function AlertPanel() {
  const { events, predictions, notifications, selectAsset } = useAppStore();

  const activeEvents = events.filter((e) => e.status === 'ongoing');
  const activeNotifications = notifications.filter((n) => !n.read && n.requires_user_action);
  
  const allAlerts = [
    ...activeNotifications.map((n) => ({ type: 'notification' as const, data: n })),
    ...activeEvents.map((e) => ({ type: 'event' as const, data: e })),
  ];

  const criticalCount = allAlerts.filter((a) => a.data.severity === 'critical').length;
  const severeCount = allAlerts.filter((a) => a.data.severity === 'severe').length;
  const majorCount = allAlerts.filter((a) => a.data.severity === 'major').length;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-slate-700">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-sm font-bold text-slate-200">Active Alerts</span>
          <span className="bg-red-600 text-white text-xs px-2 py-0.5 rounded-full font-bold">
            {allAlerts.length}
          </span>
        </div>
        <div className="flex gap-2">
          {criticalCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400">{criticalCount} critical</span>
            </div>
          )}
          {severeCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-orange-500" />
              <span className="text-orange-400">{severeCount} severe</span>
            </div>
          )}
          {majorCount > 0 && (
            <div className="flex items-center gap-1 text-xs">
              <div className="w-2 h-2 rounded-full bg-yellow-400" />
              <span className="text-yellow-300">{majorCount} major</span>
            </div>
          )}
        </div>
      </div>

      {/* Events list */}
      <div className="flex-1 overflow-y-auto p-3">
        {allAlerts.length === 0 && (
          <div className="text-center py-8 text-slate-500">
            <div className="text-sm">All systems nominal</div>
          </div>
        )}

        {/* Display all alerts sorted by severity */}
        {[...allAlerts]
          .sort((a, b) => {
            const sevOrder = { critical: 0, severe: 1, major: 2, minor: 3 };
            const aLevel = sevOrder[a.data.severity] ?? 3;
            const bLevel = sevOrder[b.data.severity] ?? 3;
            return aLevel - bLevel;
          })
          .map((alert, idx) => (
            <div key={`${alert.type}-${idx}`}>
              {alert.type === 'notification' ? (
                <NotificationCard notification={alert.data as Notification} />
              ) : (
                <EventCard
                  event={alert.data as DetectedEvent}
                  onClick={() => selectAsset((alert.data as DetectedEvent).facility)}
                />
              )}
            </div>
          ))}

        {/* Predictions */}
        {predictions.length > 0 && (
          <>
            <div className="text-xs text-slate-500 font-bold mt-4 mb-2 uppercase tracking-wider">
              Predicted Risks
            </div>
            {predictions
              .filter((p) => p.severity !== 'minor')
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
