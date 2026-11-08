import { useEffect, useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { DATASET_FOLDERS } from '../../store/appStore';
import type { SimSpeed } from '../../types';

interface ControlsMenuProps {
  activeFolder: string;
  loading: boolean;
  onDatasetChange: (path: string) => void;
  simMode: boolean;
  simSpeed: number;
  onToggleSim: () => void;
  onSetSimSpeed: (s: SimSpeed) => void;
  weatherSimMode: boolean;
  onToggleWeatherSim: () => void;
  showRain: boolean;
  onShowRainChange: (v: boolean) => void;
  showTornado: boolean;
  onShowTornadoChange: (v: boolean) => void;
}

export default function ControlsMenu(p: ControlsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close on outside click or Esc
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const datasetName = DATASET_FOLDERS.find((f) => f.path === p.activeFolder)?.name ?? 'Dataset';

  return (
    <div ref={rootRef} className="relative flex items-center gap-2">
      {/* Status chips: only shown while a mode is active */}
      {p.simMode && (
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 rounded-full bg-blue-900/70 border border-blue-500 text-blue-300 font-bold"
        >
          SIM · {p.simSpeed}x
        </button>
      )}
      {p.weatherSimMode && (
        <button
          onClick={() => setOpen(true)}
          className="text-xs px-2 py-1 rounded-full bg-purple-900/70 border border-purple-500 text-purple-300 font-bold"
        >
          WEATHER{p.showRain ? ' · Storm' : ''}{p.showTornado ? ' · Tornado' : ''}
        </button>
      )}

      <button
        ref={buttonRef}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className="flex items-center gap-1.5 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 px-3 py-1.5 rounded transition-colors"
      >
        <SlidersHorizontal size={14} />
        Controls
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Simulation controls"
          className="absolute right-0 top-full mt-2 w-72 z-50 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-3 space-y-3"
        >
          {/* Data */}
          <section className="space-y-1.5">
            <div className="text-[10px] font-bold tracking-wider text-slate-500">DATA</div>
            <select
              aria-label="Dataset"
              className="w-full bg-slate-800 border border-slate-600 text-slate-200 text-xs rounded px-2 py-1.5 cursor-pointer focus:outline-none focus:border-blue-500"
              value={p.activeFolder}
              onChange={(e) => p.onDatasetChange(e.target.value)}
              disabled={p.loading}
            >
              {DATASET_FOLDERS.map((f) => (
                <option key={f.path} value={f.path}>{f.name}</option>
              ))}
            </select>
            <div className="text-[11px] text-slate-500">Current: {datasetName}</div>
          </section>

          {/* Simulation */}
          <section className="space-y-1.5 border-t border-slate-800 pt-3">
            <div className="text-[10px] font-bold tracking-wider text-slate-500">SIMULATION</div>
            <button
              onClick={p.onToggleSim}
              className={`w-full text-xs px-3 py-1.5 rounded font-bold transition-colors text-white ${
                p.simMode ? 'bg-red-700 hover:bg-red-600' : 'bg-green-700 hover:bg-green-600'
              }`}
            >
              {p.simMode ? 'Stop Data Sim' : 'Start Data Sim'}
            </button>
            {p.simMode && (
              <div className="flex items-center gap-1">
                <span className="text-xs text-slate-500 mr-1">Speed</span>
                {(['1', '5', '10', '30'] as const).map((spd) => (
                  <button
                    key={spd}
                    onClick={() => p.onSetSimSpeed(Number(spd) as SimSpeed)}
                    className={`flex-1 text-xs px-2 py-1 rounded transition-colors ${
                      p.simSpeed === Number(spd)
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-800 text-slate-400 hover:bg-slate-700'
                    }`}
                  >
                    {spd}x
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Weather */}
          <section className="space-y-1.5 border-t border-slate-800 pt-3">
            <div className="text-[10px] font-bold tracking-wider text-slate-500">WEATHER</div>
            <button
              onClick={p.onToggleWeatherSim}
              className={`w-full text-xs px-3 py-1.5 rounded font-bold transition-colors text-white ${
                p.weatherSimMode ? 'bg-red-700 hover:bg-red-600' : 'bg-purple-700 hover:bg-purple-600'
              }`}
            >
              {p.weatherSimMode ? 'Stop Weather Sim' : 'Start Weather Sim'}
            </button>
            {(
              <div className="flex items-center gap-4">
                <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.showRain}
                    onChange={(e) => p.onShowRainChange(e.target.checked)}
                    className="w-3 h-3"
                  />
                  Thunderstorm
                </label>
                <label className="flex items-center gap-1 text-xs text-slate-300 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={p.showTornado}
                    onChange={(e) => p.onShowTornadoChange(e.target.checked)}
                    className="w-3 h-3"
                  />
                  Tornado
                </label>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
