import { useAppStore } from '../../store/appStore';
import type { Plan } from '../../types';

const PLAN_ICON: Record<string, string> = {
  truck: '🚚',
  shut_in: '🛑',
  do_nothing: '⏳',
};

const PLAN_LABEL: Record<string, string> = {
  truck: 'Send Trucks',
  shut_in: 'Shut In Well',
  do_nothing: 'Do Nothing',
};

function PlanBadge({ plan, isBest }: { plan: Plan; isBest: boolean }) {
  return (
    <div className={`rounded-lg p-3 border ${isBest ? 'border-green-500 bg-green-900/15' : 'border-slate-700 bg-slate-800/40'}`}>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span>{PLAN_ICON[plan.type]}</span>
          <span className="text-xs font-bold text-slate-200">{PLAN_LABEL[plan.type]}</span>
          {isBest && (
            <span className="bg-green-600 text-white text-xs px-1.5 py-0.5 rounded font-bold">BEST</span>
          )}
        </div>
        <span className={`text-sm font-bold ${isBest ? 'text-green-400' : 'text-slate-300'}`}>
          ${plan.total_cost.toLocaleString()}
        </span>
      </div>
      {plan.type === 'truck' && (
        <div className="text-xs text-slate-400">
          {plan.truck_count} truck(s) · {plan.trip_count} trip(s) · arrives in ~{plan.dispatch_time_min}min
          <div className="text-slate-500">{plan.trucks_available} trucks in fleet</div>
        </div>
      )}
      {plan.type === 'shut_in' && (
        <div className="text-xs text-slate-400">
          <div>{plan.description}</div>
        </div>
      )}
      {plan.type === 'do_nothing' && (
        <div className="text-xs text-slate-400">
          <div>{plan.description}</div>
          {plan.downtime_hours > 0 && (
            <div className="text-red-400 mt-0.5">~{plan.downtime_hours.toFixed(1)}h downtime</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function CostPanel() {
  const { events, dispatchTruck } = useAppStore();
  const pumpFailures = events.filter(
    (e) => e.category === 'pump_failure' && e.status === 'ongoing' && e.recommended_action
  );

  const totalCostNothing = pumpFailures.reduce(
    (s, e) => s + (e.recommended_action?.cost_of_doing_nothing ?? 0), 0
  );
  const totalCostBest = pumpFailures.reduce(
    (s, e) => s + (e.recommended_action?.cheapest.total_cost ?? 0), 0
  );
  const totalSavings = Math.max(0, totalCostNothing - totalCostBest);

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-slate-700">
        <div className="text-sm font-bold text-slate-200 mb-2">💰 Cost Optimizer</div>
        {pumpFailures.length > 0 && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-slate-800/50 rounded p-2 text-center">
              <div className="text-xs text-slate-500">Do Nothing</div>
              <div className="text-sm font-bold text-red-400">${totalCostNothing.toLocaleString()}</div>
            </div>
            <div className="bg-slate-800/50 rounded p-2 text-center">
              <div className="text-xs text-slate-500">Best Plans</div>
              <div className="text-sm font-bold text-green-400">${totalCostBest.toLocaleString()}</div>
            </div>
            <div className="bg-green-900/20 border border-green-700/40 rounded p-2 text-center">
              <div className="text-xs text-slate-500">You Save</div>
              <div className="text-sm font-bold text-green-300">${totalSavings.toLocaleString()}</div>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {pumpFailures.length === 0 && (
          <div className="text-center py-8 text-slate-500 text-sm">
            <div className="text-2xl mb-2">✅</div>
            <div>No active pump failures</div>
          </div>
        )}

        {pumpFailures.map((evt) => (
          <div key={evt.id} className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <div>
                <div className="text-xs font-bold text-orange-300">{evt.facility.replace(/_/g, ' ')}</div>
                <div className="text-xs text-slate-500">
                  {evt.hours_to_limit ? `${evt.hours_to_limit.toFixed(1)}h to shutdown` : 'Stable'}
                  {' · '}${evt.lost_revenue_per_hour?.toFixed(0) ?? 0}/hr at risk
                </div>
              </div>
              <button
                onClick={() => dispatchTruck(evt.id)}
                className="text-xs bg-blue-700 hover:bg-blue-600 text-white px-2 py-1 rounded transition-colors"
              >
                Act Now
              </button>
            </div>

            <div className="space-y-2">
              {evt.recommended_action?.all_plans.map((plan) => (
                <PlanBadge
                  key={plan.type}
                  plan={plan}
                  isBest={plan.type === evt.recommended_action?.cheapest.type}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
