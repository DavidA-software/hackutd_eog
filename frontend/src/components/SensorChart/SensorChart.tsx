import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { useAppStore } from '../../store/appStore';
import { valuesInRange } from '../../data/loader';

const METRICS_FOR_ASSET: Record<string, { key: string; label: string; color: string; yDomain?: [number, number] }[]> = {
  TANK: [{ key: 'level_pct', label: 'Tank Level %', color: '#22d3ee', yDomain: [0, 100] }],
  PUMP: [
    { key: 'flow_bpd', label: 'Flow (bpd)', color: '#4ade80' },
    { key: 'discharge_psi', label: 'Discharge PSI', color: '#f472b6' },
    { key: 'status', label: 'Status', color: '#facc15', yDomain: [-0.1, 1.1] },
  ],
  PIPELINE: [
    { key: 'receive_flow_bpd', label: 'Receive Flow (bpd)', color: '#60a5fa' },
    { key: 'pressure_psi', label: 'Pressure (PSI)', color: '#a78bfa' },
  ],
  WELL: [{ key: 'water_bpd', label: 'Water (bpd)', color: '#38bdf8' }],
  FACILITY: [{ key: 'inflow_bpd', label: 'Total Inflow (bpd)', color: '#fb923c' }],
};

function getAssetType(assetId: string): string {
  if (assetId.includes('TANK')) return 'TANK';
  if (assetId.includes('PUMP')) return 'PUMP';
  if (assetId.includes('PIPELINE')) return 'PIPELINE';
  if (assetId.includes('WELL')) return 'WELL';
  if (assetId.includes('FACILITY')) return 'FACILITY';
  return 'FACILITY';
}

function formatTs(ts: number): string {
  const d = new Date(ts * 1000);
  return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')} ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}

interface Props {
  assetId: string;
  windowHours?: number;
}

export default function SensorChart({ assetId, windowHours = 12 }: Props) {
  const { telemetryIndex, nowUnix } = useAppStore();

  const assetType = getAssetType(assetId);
  const metrics = METRICS_FOR_ASSET[assetType] ?? [];

  const fromUnix = nowUnix - windowHours * 3600;

  const chartData = useMemo(() => {
    if (!telemetryIndex || metrics.length === 0) return [];
    // Get all timestamps from first metric
    const primary = valuesInRange(telemetryIndex, assetId, metrics[0].key, fromUnix, nowUnix);
    return primary.map((p, i) => {
      const point: Record<string, number | string> = {
        ts: p.ts,
        label: formatTs(p.ts),
        [metrics[0].key]: p.value,
      };
      // Add other metrics at same timestamps
      for (let m = 1; m < metrics.length; m++) {
        const series = valuesInRange(telemetryIndex, assetId, metrics[m].key, fromUnix, nowUnix);
        point[metrics[m].key] = series[i]?.value ?? 0;
      }
      return point;
    });
  }, [telemetryIndex, assetId, nowUnix, windowHours]);

  if (metrics.length === 0 || chartData.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-slate-500 text-sm">
        No sensor data for {assetId}
      </div>
    );
  }

  return (
    <div className="bg-slate-800/40 rounded-lg p-3">
      <div className="text-xs font-bold text-slate-300 mb-2">{assetId.replace(/_/g, ' ')}</div>
      {metrics.map((m) => (
        <div key={m.key} className="mb-3">
          <div className="text-xs text-slate-400 mb-1">{m.label}</div>
          <ResponsiveContainer width="100%" height={80}>
            <LineChart data={chartData} margin={{ top: 2, right: 8, bottom: 2, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(100,120,150,0.15)" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 8, fill: '#64748b' }}
                interval="preserveStartEnd"
              />
              <YAxis
                domain={m.yDomain ?? ['auto', 'auto']}
                tick={{ fontSize: 8, fill: '#64748b' }}
                width={35}
              />
              <Tooltip
                contentStyle={{ background: '#1e293b', border: '1px solid #334155', fontSize: 11 }}
                labelStyle={{ color: '#94a3b8' }}
                itemStyle={{ color: m.color }}
              />
              {/* Shutdown limit reference line for tank */}
              {m.key === 'level_pct' && (
                <>
                  <ReferenceLine y={92} stroke="#ef4444" strokeDasharray="4 2" label={{ value: 'SHUTDOWN', fontSize: 8, fill: '#ef4444', position: 'insideTopRight' }} />
                  <ReferenceLine y={85} stroke="#f97316" strokeDasharray="4 2" label={{ value: 'WARNING', fontSize: 8, fill: '#f97316', position: 'insideTopRight' }} />
                </>
              )}
              <Line
                type="monotone"
                dataKey={m.key}
                stroke={m.color}
                strokeWidth={1.5}
                dot={false}
                activeDot={{ r: 3 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ))}
    </div>
  );
}
