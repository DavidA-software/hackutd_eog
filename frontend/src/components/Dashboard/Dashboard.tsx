import { useAppStore } from '../../store/appStore';

export default function Dashboard() {
  const { events, trucks, nowUnix, network, ops } = useAppStore();

  const activeEvents = events.filter((e) => e.status === 'ongoing');
  const criticalCount = activeEvents.filter((e) => e.severity === 'critical').length;
  const severeCount = activeEvents.filter((e) => e.severity === 'severe').length;
  const activeTrucks = trucks.filter((t) => t.status === 'en_route' || t.status === 'on_site');

  const totalSavingsAvailable = activeEvents.reduce((sum, e) => {
    return sum + (e.recommended_action?.savings ?? 0);
  }, 0);

  const nowDate = nowUnix > 0 ? new Date(nowUnix * 1000).toUTCString().slice(0, 25) : '—';

  return (
    <div className="flex gap-3 p-3 border-b border-slate-800 bg-slate-900/50">
      <KPICard
        label="System Time"
        value={nowDate}
        sub={network ? `${network.systems.length} systems online` : 'No data loaded'}
        color="text-blue-300"
      />

      <KPICard
        label="Active Threats"
        value={String(activeEvents.length)}
        sub={`${criticalCount} critical · ${severeCount} severe`}
        color={activeEvents.length === 0 ? 'text-green-400' : criticalCount > 0 ? 'text-red-400' : 'text-orange-400'}
        pulse={criticalCount > 0}
      />

      <KPICard
        label="Active Trucks"
        value={String(activeTrucks.length)}
        sub={`of ${network ? Object.values(ops?.systems ?? {}).reduce((s, sys) => s + sys.emergency_fleet_size, 0) : 0} total fleet`}
        color="text-yellow-300"
      />

      <KPICard
        label="Savings Available"
        value={`$${totalSavingsAvailable.toLocaleString()}`}
        sub="vs. No Action"
        color="text-green-400"
      />
    </div>
  );
}

function KPICard({
  label,
  value,
  sub,
  color,
  pulse,
}: {
  label: string;
  value: string;
  sub: string;
  color: string;
  pulse?: boolean;
}) {
  return (
    <div
      className={`flex-1 bg-slate-800/60 border border-slate-700 rounded-lg p-3 min-w-0 ${
        pulse ? 'pulse-red' : ''
      }`}
    >
      <div className="text-xs text-slate-400 font-medium truncate mb-1">{label}</div>
      <div className={`text-lg font-bold truncate ${color}`}>{value}</div>
      <div className="text-xs text-slate-500 truncate">{sub}</div>
    </div>
  );
}
