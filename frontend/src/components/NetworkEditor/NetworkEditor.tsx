import { useState } from 'react';
import { useAppStore } from '../../store/appStore';
import type { CustomSensor } from '../../types';

export default function NetworkEditor() {
  const { addCustomSensor, customSensors, toggleNetworkEditor } = useAppStore();
  const [form, setForm] = useState<Partial<CustomSensor>>({
    unit: 'pct',
    range_min: 0,
    range_max: 100,
  });
  const [saved, setSaved] = useState(false);

  function handleChange(key: keyof CustomSensor, value: string | number) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function handleSave() {
    if (!form.id || !form.asset_id || !form.metric) return;
    addCustomSensor({
      id: form.id!,
      asset_id: form.asset_id!,
      metric: form.metric!,
      lat: form.lat ?? 31.5,
      lon: form.lon ?? -102.0,
      range_min: form.range_min ?? 0,
      range_max: form.range_max ?? 100,
      unit: form.unit ?? '',
      upstream: form.upstream,
      downstream: form.downstream,
    });
    setSaved(true);
    setForm({ unit: 'pct', range_min: 0, range_max: 100 });
    setTimeout(() => setSaved(false), 2000);
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4">
      <div className="bg-slate-900 border border-slate-700 rounded-xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between p-4 border-b border-slate-700">
          <h2 className="font-bold text-slate-200">🔧 Network Editor — Add Sensor</h2>
          <button onClick={toggleNetworkEditor} className="text-slate-400 hover:text-white text-xl">✕</button>
        </div>

        <div className="p-4 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Sensor ID" value={form.id ?? ''} onChange={(v) => handleChange('id', v)} placeholder="SENSOR_001" />
            <Field label="Asset ID" value={form.asset_id ?? ''} onChange={(v) => handleChange('asset_id', v)} placeholder="S1_PUMP_A" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Metric" value={form.metric ?? ''} onChange={(v) => handleChange('metric', v)} placeholder="pressure_psi" />
            <Field label="Unit" value={form.unit ?? ''} onChange={(v) => handleChange('unit', v)} placeholder="psi" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Range Min" value={String(form.range_min ?? 0)} onChange={(v) => handleChange('range_min', Number(v))} type="number" />
            <Field label="Range Max" value={String(form.range_max ?? 100)} onChange={(v) => handleChange('range_max', Number(v))} type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field label="GPS Lat" value={String(form.lat ?? '')} onChange={(v) => handleChange('lat', Number(v))} placeholder="31.85" type="number" />
            <Field label="GPS Lon" value={String(form.lon ?? '')} onChange={(v) => handleChange('lon', Number(v))} placeholder="-102.3" type="number" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Field
              label="Upstream (comma-sep IDs)"
              value={(form.upstream ?? []).join(',')}
              onChange={(v) => handleChange('upstream', v.split(',').filter(Boolean) as any)}
              placeholder="S1_TANK_A"
            />
            <Field
              label="Downstream (comma-sep IDs)"
              value={(form.downstream ?? []).join(',')}
              onChange={(v) => handleChange('downstream', v.split(',').filter(Boolean) as any)}
              placeholder="S1_PIPELINE_A"
            />
          </div>

          <button
            onClick={handleSave}
            disabled={!form.id || !form.asset_id || !form.metric}
            className="w-full bg-blue-700 hover:bg-blue-600 disabled:bg-slate-700 disabled:text-slate-500 text-white font-bold py-2 rounded transition-colors"
          >
            {saved ? '✅ Saved!' : 'Add Sensor to Network'}
          </button>
        </div>

        {customSensors.length > 0 && (
          <div className="px-4 pb-4">
            <div className="text-xs font-bold text-slate-400 mb-2 uppercase tracking-wider">Custom Sensors ({customSensors.length})</div>
            <div className="space-y-1 max-h-40 overflow-y-auto">
              {customSensors.map((s) => (
                <div key={s.id} className="bg-slate-800 rounded px-3 py-1.5 text-xs flex justify-between">
                  <span className="text-slate-200 font-mono">{s.id}</span>
                  <span className="text-slate-400">{s.asset_id} · {s.metric} ({s.range_min}–{s.range_max} {s.unit})</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder = '',
  type = 'text',
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-slate-400 mb-1">{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full bg-slate-800 border border-slate-600 rounded px-2 py-1.5 text-sm text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-blue-500"
      />
    </div>
  );
}
