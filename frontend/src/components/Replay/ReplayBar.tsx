import { useAppStore } from '../../store/appStore';
import type { CityTemperatures } from '../CityMap/CityCanvas';

const CAT_COLOR: Record<string, string> = {
  pump_failure: 'bg-red-500',
  pipeline_leak: 'bg-orange-400',
  pump_degradation: 'bg-yellow-300',
};

const CAT_NAME: Record<string, string> = {
  pump_failure: 'Pump failure',
  pipeline_leak: 'Pipeline leak',
  pump_degradation: 'Worn pump',
};

function fmt(unix: number) {
  return new Date(unix * 1000).toUTCString().slice(0, 22) + ' UTC';
}

/** Timeline over the recorded week: shows where each problem was detected and lets you scrub. */
export default function ReplayBar({ weather = {} }: { weather?: CityTemperatures }) {
  const {
    nowUnix,
    datasetStart,
    datasetEnd,
    timeline,
    simMode,
    simSpeed,
    exactAt,
    backendOnline,
    toggleSimMode,
    setReplayTime,
    requestExactAnalysis,
  } = useAppStore();

  if (!(datasetEnd > datasetStart)) return null;
  const span = datasetEnd - datasetStart;
  const pct = (t: number) => `${Math.min(100, Math.max(0, ((t - datasetStart) / span) * 100))}%`;
  const atEnd = nowUnix >= datasetEnd;

  // Day boundaries for labels under the track
  const days: number[] = [];
  for (let d = Math.ceil(datasetStart / 86400) * 86400; d < datasetEnd; d += 86400) days.push(d);

  const status = atEnd
    ? { text: 'LIVE · latest reading', cls: 'text-green-400' }
    : simMode
    ? { text: `REPLAY · ${simSpeed}x`, cls: 'text-blue-300' }
    : { text: 'PAUSED', cls: 'text-amber-300' };

  // One-line summary of the recorded weather at the replay time
  const mid = weather['Midland'] ?? Object.values(weather)[0];
  const wet = Object.entries(weather)
    .filter(([, c]) => (c.precip_mm ?? 0) >= 0.1 || (c.code ?? 0) >= 95)
    .map(([city]) => city);
  const weatherText = mid
    ? `Midland ${Math.round(mid.temp ?? 0)}°F ${mid.condition ?? ''} · wind ${Math.round(mid.wind_mph ?? 0)} mph` +
      (wet.length ? ` · rain near ${wet.join(', ')}` : '')
    : '';
  const stormy = Object.values(weather).some((c) => (c.code ?? 0) >= 95);

  const scrub = (t: number) => {
    if (simMode) toggleSimMode();
    setReplayTime(t);
    requestExactAnalysis();
  };

  return (
    <div className="w-full shrink-0 bg-slate-950 border-b border-slate-800 px-4 pt-1.5 pb-1">
      <div className="flex items-center gap-3 text-xs mb-0.5 whitespace-nowrap overflow-hidden">
        <span className={`font-bold ${status.cls}`}>● {status.text}</span>
        <span className="text-slate-200 font-bold">{fmt(nowUnix)}</span>
        {!atEnd && !simMode && exactAt === nowUnix && (
          <span className="text-slate-400" title="Plans are recomputed as if this moment were now: tank levels, repair time left and the whole truck fleet">Plans as of this moment</span>
        )}
        {!backendOnline && <span className="text-yellow-400">Offline mode</span>}
        <div className="flex-1" />
        {weatherText && (
          <span
            className={`truncate ${stormy ? 'text-amber-300' : 'text-slate-400'}`}
            title="Recorded weather at the replay time (Open-Meteo historical data)"
          >
            {stormy ? '⛈ ' : ''}{weatherText}
          </span>
        )}
        <button
          onClick={toggleSimMode}
          className="text-xs px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-600 text-white font-bold"
        >
          {simMode ? '⏸ Pause' : atEnd ? '▶ Replay week' : '▶ Play'}
        </button>
        {!atEnd && (
          <button
            onClick={() => scrub(datasetEnd)}
            className="text-xs px-2 py-0.5 rounded bg-slate-700 hover:bg-slate-600 text-slate-200"
          >
            Jump to latest
          </button>
        )}
      </div>

      <div className="relative h-5">
        {/* Event markers at the moment each problem became detectable */}
        {timeline
          .filter((e) => e.status !== 'predicted')
          .map((e) => (
            <div
              key={e.id}
              title={`${CAT_NAME[e.category] ?? e.category} · ${e.asset} · detected ${fmt(e.detected_unix ?? e.onset_unix)}`}
              className={`absolute top-0 w-1 h-2 rounded-sm ${CAT_COLOR[e.category] ?? 'bg-slate-400'} cursor-pointer`}
              style={{ left: pct(e.detected_unix ?? e.onset_unix) }}
              onClick={() => scrub(e.detected_unix ?? e.onset_unix)}
            />
          ))}
        <input
          type="range"
          min={datasetStart}
          max={datasetEnd}
          step={300}
          value={nowUnix}
          onChange={(ev) => scrub(Number(ev.target.value))}
          className="absolute left-0 right-0 bottom-0 w-full accent-blue-500 cursor-pointer"
          aria-label="Replay time"
        />
      </div>

      <div className="relative h-3.5 text-[10px] text-slate-500">
        {days.map((d) => (
          <span key={d} className="absolute -translate-x-1/2" style={{ left: pct(d) }}>
            {new Date(d * 1000).toUTCString().slice(0, 3)}
          </span>
        ))}
        <span className="absolute right-0 flex gap-3 bg-slate-950 pl-2" title="Markers show when each problem became detectable. Click one to jump there.">
          <span><span className="inline-block w-2 h-2 bg-red-500 rounded-sm mr-1" />Pump failure</span>
          <span><span className="inline-block w-2 h-2 bg-orange-400 rounded-sm mr-1" />Leak</span>
          <span><span className="inline-block w-2 h-2 bg-yellow-300 rounded-sm mr-1" />Worn pump</span>
        </span>
      </div>
    </div>
  );
}
