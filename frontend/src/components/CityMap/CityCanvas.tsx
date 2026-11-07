import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { latestValue } from '../../data/loader';
import type { AlertSeverity } from '../../types';

// Map coordinate range from the dataset
const LAT_MIN = 31.2, LAT_MAX = 32.6;
const LON_MIN = -103.1, LON_MAX = -101.2;

function geoToCanvas(lat: number, lon: number, w: number, h: number): [number, number] {
  const x = ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * w;
  const y = ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * h;
  return [x, y];
}

function severityToGlow(severity: AlertSeverity): string {
  if (severity === 'critical') return '#ff0000';
  if (severity === 'red') return '#f97316';
  if (severity === 'yellow') return '#eab308';
  return 'rgba(255,255,255,0.6)';
}

function levelToFillColor(level: number): string {
  if (level >= 92) return '#dc2626';
  if (level >= 85) return '#f97316';
  if (level >= 70) return '#eab308';
  if (level >= 50) return '#84cc16';
  return '#22c55e';
}

export default function CityCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);
  const { network, telemetryIndex, nowUnix, events, predictions, selectAsset, selectSystem, selectedAssetId } = useAppStore();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });

  useEffect(() => {
    const observer = new ResizeObserver((entries) => {
      for (const e of entries) {
        setCanvasSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    if (canvasRef.current?.parentElement) observer.observe(canvasRef.current.parentElement);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !network || !telemetryIndex) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameCount = 0;

    function draw() {
      frameCount++;
      const { w, h } = canvasSize;
      canvas!.width = w;
      canvas!.height = h;

      // ── Background: city ───────────────────────────────────────────────────
      const bgGrad = ctx!.createLinearGradient(0, 0, 0, h);
      bgGrad.addColorStop(0, '#0a0e1a');
      bgGrad.addColorStop(1, '#0d1520');
      ctx!.fillStyle = bgGrad;
      ctx!.fillRect(0, 0, w, h);

      // City grid lines (subtle)
      ctx!.strokeStyle = 'rgba(30,50,80,0.4)';
      ctx!.lineWidth = 0.5;
      for (let gx = 0; gx < w; gx += 60) {
        ctx!.beginPath(); ctx!.moveTo(gx, 0); ctx!.lineTo(gx, h); ctx!.stroke();
      }
      for (let gy = 0; gy < h; gy += 60) {
        ctx!.beginPath(); ctx!.moveTo(0, gy); ctx!.lineTo(w, gy); ctx!.stroke();
      }

      // Stylized city buildings (decorative top strip)
      drawCityscape(ctx!, w, h);

      // ── Underground infrastructure label ───────────────────────────────────
      ctx!.font = '11px monospace';
      ctx!.fillStyle = 'rgba(100,150,200,0.4)';
      ctx!.fillText('— UNDERGROUND INFRASTRUCTURE —', 10, h * 0.22 + 15);

      // Underground separator line
      ctx!.strokeStyle = 'rgba(100,150,200,0.15)';
      ctx!.lineWidth = 1;
      ctx!.setLineDash([8, 4]);
      ctx!.beginPath();
      ctx!.moveTo(0, h * 0.22);
      ctx!.lineTo(w, h * 0.22);
      ctx!.stroke();
      ctx!.setLineDash([]);

      if (!network) return;

      const allEvents = [...events, ...predictions];

      // ── Draw pipelines ─────────────────────────────────────────────────────
      for (const system of network.systems) {
        const [dispX, dispY] = geoToCanvas(system.disposal_site.lat, system.disposal_site.lon, w, h);

        for (const facility of system.facilities) {
          const [facX, facY] = geoToCanvas(facility.lat, facility.lon, w, h);
          const pipeEvt = allEvents.find((e) => e.asset === facility.pipeline.id && e.status !== 'predicted');
          const pressure = latestValue(telemetryIndex!, facility.pipeline.id, 'pressure_psi', nowUnix) ?? 0;
          const maxPsi = facility.pipeline.max_pressure_psi;
          const pressureRatio = maxPsi > 0 ? pressure / maxPsi : 0.5;

          if (pipeEvt) {
            // Pulsing red/orange for leak
            const pulse = Math.sin(frameCount * 0.08) * 0.5 + 0.5;
            ctx!.strokeStyle = pipeEvt.severity === 'red'
              ? `rgba(239,68,68,${0.6 + pulse * 0.4})`
              : `rgba(249,115,22,${0.6 + pulse * 0.4})`;
            ctx!.lineWidth = 3;
            ctx!.shadowColor = pipeEvt.severity === 'red' ? '#ef4444' : '#f97316';
            ctx!.shadowBlur = 12 + pulse * 8;
          } else {
            // Color by pressure ratio
            const r = Math.round(pressureRatio * 180);
            const g = Math.round((1 - pressureRatio) * 220 + 50);
            ctx!.strokeStyle = `rgba(${r},${g},255,0.6)`;
            ctx!.lineWidth = 2;
            ctx!.shadowColor = 'transparent';
            ctx!.shadowBlur = 0;
          }

          ctx!.beginPath();
          ctx!.moveTo(facX, facY);
          ctx!.lineTo(dispX, dispY);
          ctx!.stroke();
          ctx!.shadowBlur = 0;

          // Flow direction arrows
          if (!pipeEvt) {
            drawArrow(ctx!, facX, facY, dispX, dispY, 'rgba(100,180,255,0.4)');
          }
        }
      }

      // ── Draw systems: disposal, truck yard, facilities ─────────────────────
      for (const system of network.systems) {
        // Disposal site
        const [dispX, dispY] = geoToCanvas(system.disposal_site.lat, system.disposal_site.lon, w, h);
        ctx!.fillStyle = 'rgba(100,200,255,0.8)';
        ctx!.strokeStyle = 'rgba(100,200,255,0.3)';
        ctx!.lineWidth = 1;
        ctx!.beginPath();
        ctx!.arc(dispX, dispY, 8, 0, Math.PI * 2);
        ctx!.fill();
        ctx!.beginPath();
        ctx!.arc(dispX, dispY, 14, 0, Math.PI * 2);
        ctx!.stroke();
        ctx!.font = 'bold 9px monospace';
        ctx!.fillStyle = 'rgba(150,220,255,0.9)';
        ctx!.fillText('DISP', dispX - 14, dispY + 20);

        // Truck yard
        const [yardX, yardY] = geoToCanvas(system.truck_yard[0], system.truck_yard[1], w, h);
        ctx!.fillStyle = 'rgba(250,204,21,0.7)';
        ctx!.fillRect(yardX - 8, yardY - 6, 16, 12);
        ctx!.strokeStyle = 'rgba(250,204,21,0.4)';
        ctx!.strokeRect(yardX - 8, yardY - 6, 16, 12);
        ctx!.font = '8px monospace';
        ctx!.fillStyle = 'rgba(250,204,21,0.9)';
        ctx!.fillText('YARD', yardX - 14, yardY + 20);

        // Facilities
        for (const facility of system.facilities) {
          const [facX, facY] = geoToCanvas(facility.lat, facility.lon, w, h);
          const tankLevel = latestValue(telemetryIndex!, facility.tank.id, 'level_pct', nowUnix) ?? 50;
          const pumpStatus = latestValue(telemetryIndex!, facility.pump.id, 'status', nowUnix) ?? 1;
          const pumpFlow = latestValue(telemetryIndex!, facility.pump.id, 'flow_bpd', nowUnix) ?? 0;

          const facilityEvt = allEvents.find(
            (e) => e.facility === facility.id && e.status !== 'predicted'
          );
          const predEvt = predictions.find((e) => e.facility === facility.id);

          const isSelected = selectedAssetId === facility.id || selectedAssetId === facility.pump.id || selectedAssetId === facility.tank.id;

          // Glow / pulse
          const pulse = Math.sin(frameCount * 0.06) * 0.5 + 0.5;
          if (facilityEvt) {
            ctx!.shadowColor = severityToGlow(facilityEvt.severity);
            ctx!.shadowBlur = facilityEvt.severity === 'critical' ? 30 + pulse * 20 : 15 + pulse * 10;
          } else if (predEvt) {
            ctx!.shadowColor = 'rgba(250,204,21,0.6)';
            ctx!.shadowBlur = 8;
          } else {
            ctx!.shadowBlur = 0;
          }

          // Facility circle (outer ring)
          ctx!.strokeStyle = isSelected
            ? 'rgba(99,179,237,0.9)'
            : facilityEvt
            ? severityToGlow(facilityEvt.severity)
            : 'rgba(200,220,255,0.5)';
          ctx!.lineWidth = isSelected ? 3 : 2;
          ctx!.beginPath();
          ctx!.arc(facX, facY, 18, 0, Math.PI * 2);
          ctx!.stroke();

          // Tank fill indicator (filled arc)
          const fillAngle = (tankLevel / 100) * Math.PI * 2;
          const fillColor = levelToFillColor(tankLevel);
          ctx!.fillStyle = fillColor + '33';
          ctx!.beginPath();
          ctx!.moveTo(facX, facY);
          ctx!.arc(facX, facY, 16, -Math.PI / 2, -Math.PI / 2 + fillAngle);
          ctx!.closePath();
          ctx!.fill();

          // Tank level ring (arc)
          ctx!.strokeStyle = fillColor;
          ctx!.lineWidth = 3;
          ctx!.beginPath();
          ctx!.arc(facX, facY, 16, -Math.PI / 2, -Math.PI / 2 + fillAngle);
          ctx!.stroke();

          // Pump status dot
          const pumpColor = pumpStatus === 0 ? '#ef4444' : pumpFlow > 100 ? '#22c55e' : '#eab308';
          ctx!.fillStyle = pumpColor;
          ctx!.beginPath();
          ctx!.arc(facX + 12, facY - 12, 4, 0, Math.PI * 2);
          ctx!.fill();
          ctx!.shadowBlur = 0;

          // Facility label
          const shortId = facility.id.replace(/^[A-Z]\d_FACILITY_/, '');
          const sysId = facility.id.substring(0, 2);
          ctx!.font = 'bold 9px monospace';
          ctx!.fillStyle = 'rgba(200,220,255,0.9)';
          ctx!.fillText(`${sysId}-${shortId}`, facX - 14, facY + 30);

          // Tank level text
          ctx!.font = 'bold 8px monospace';
          ctx!.fillStyle = fillColor;
          ctx!.fillText(`${tankLevel.toFixed(0)}%`, facX - 9, facY + 4);
        }

        // System label
        const [cX, cY] = geoToCanvas(system.center[0], system.center[1], w, h);
        ctx!.font = 'bold 14px monospace';
        ctx!.fillStyle = 'rgba(150,200,255,0.5)';
        ctx!.fillText(system.id, cX - 10, cY - 30);
      }

      // ── Truck markers ──────────────────────────────────────────────────────
      const { trucks } = useAppStore.getState();
      for (const truck of trucks) {
        if (truck.status !== 'en_route' && truck.status !== 'on_site') continue;
        const system = network.systems.find((s) => s.id === truck.system_id);
        const facility = system?.facilities.find((f) => f.id === truck.facility_id);
        if (!system || !facility) continue;

        const progress = truck.status === 'on_site' ? 1 :
          Math.min(1, (nowUnix - truck.dispatched_at) / (truck.eta_arrival - truck.dispatched_at));
        const [yX, yY] = geoToCanvas(system.truck_yard[0], system.truck_yard[1], w, h);
        const [fX, fY] = geoToCanvas(facility.lat, facility.lon, w, h);
        const tX = yX + (fX - yX) * progress;
        const tY = yY + (fY - yY) * progress;

        // Truck icon
        ctx!.fillStyle = truck.on_time ? '#fbbf24' : '#f87171';
        ctx!.shadowColor = truck.on_time ? '#fbbf24' : '#f87171';
        ctx!.shadowBlur = 8;
        ctx!.fillRect(tX - 6, tY - 5, 12, 10);
        ctx!.shadowBlur = 0;
        ctx!.font = '8px monospace';
        ctx!.fillStyle = '#fff';
        ctx!.fillText('🚚', tX - 7, tY + 3);
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [network, telemetryIndex, nowUnix, events, predictions, canvasSize, selectedAssetId]);

  function drawCityscape(ctx: CanvasRenderingContext2D, w: number, h: number) {
    const skyH = h * 0.18;
    // Sky gradient
    const sky = ctx.createLinearGradient(0, 0, 0, skyH);
    sky.addColorStop(0, '#0a1628');
    sky.addColorStop(1, '#0d1e35');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, skyH);

    // Stars
    ctx.fillStyle = 'rgba(255,255,255,0.6)';
    const stars = [[50,10],[120,5],[200,15],[350,8],[480,12],[600,4],[750,9],[870,14],[950,7]];
    for (const [sx, sy] of stars) {
      if (sx < w) {
        ctx.beginPath();
        ctx.arc(sx, sy, 1, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Buildings
    const buildings = [
      {x:20, w:40, h:70, windows:[[5,10],[5,25],[5,40],[20,10],[20,25],[20,40]]},
      {x:75, w:30, h:50, windows:[[5,10],[5,25],[15,10],[15,25]]},
      {x:120, w:55, h:90, windows:[[5,10],[5,30],[5,50],[5,70],[20,10],[20,30],[20,50],[20,70],[35,10],[35,30]]},
      {x:190, w:25, h:55, windows:[[5,10],[5,30],[15,10],[15,30]]},
      {x:230, w:70, h:80, windows:[[5,10],[5,30],[5,50],[20,10],[20,30],[20,50],[35,10],[35,30],[50,10],[50,30]]},
      {x:315, w:35, h:65, windows:[[5,10],[5,30],[5,50],[20,10],[20,30]]},
      {x:365, w:45, h:100, windows:[[5,10],[5,30],[5,50],[5,70],[5,85],[20,10],[20,30],[20,50],[20,70]]},
      {x:425, w:30, h:55, windows:[[5,10],[5,30],[15,10],[15,30]]},
      {x:470, w:60, h:75, windows:[[5,10],[5,30],[5,50],[20,10],[20,30],[20,50],[40,10],[40,30]]},
    ];

    for (const b of buildings) {
      if (b.x > w) continue;
      // Building body
      const bGrad = ctx.createLinearGradient(b.x, skyH - b.h, b.x + b.w, skyH);
      bGrad.addColorStop(0, 'rgba(15,30,60,0.95)');
      bGrad.addColorStop(1, 'rgba(10,20,45,0.95)');
      ctx.fillStyle = bGrad;
      ctx.fillRect(b.x, skyH - b.h, b.w, b.h);
      ctx.strokeStyle = 'rgba(50,80,130,0.4)';
      ctx.lineWidth = 0.5;
      ctx.strokeRect(b.x, skyH - b.h, b.w, b.h);

      // Windows (some lit, some dark)
      for (const [wx, wy] of b.windows) {
        const lit = Math.random() > 0.3;
        ctx.fillStyle = lit ? 'rgba(255,220,100,0.7)' : 'rgba(20,40,70,0.8)';
        ctx.fillRect(b.x + wx, skyH - b.h + wy, 7, 5);
      }
    }

    // Ground line
    ctx.strokeStyle = 'rgba(50,80,130,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, skyH);
    ctx.lineTo(w, skyH);
    ctx.stroke();
  }

  function drawArrow(
    ctx: CanvasRenderingContext2D,
    x1: number, y1: number,
    x2: number, y2: number,
    color: string
  ) {
    const midX = (x1 + x2) / 2;
    const midY = (y1 + y2) / 2;
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const arrowLen = 6;

    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(midX - Math.cos(angle) * arrowLen, midY - Math.sin(angle) * arrowLen);
    ctx.lineTo(midX + Math.cos(angle) * arrowLen, midY + Math.sin(angle) * arrowLen);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(midX + Math.cos(angle) * arrowLen, midY + Math.sin(angle) * arrowLen);
    ctx.lineTo(midX + Math.cos(angle - 2.5) * (arrowLen * 0.7), midY + Math.sin(angle - 2.5) * (arrowLen * 0.7));
    ctx.lineTo(midX + Math.cos(angle + 2.5) * (arrowLen * 0.7), midY + Math.sin(angle + 2.5) * (arrowLen * 0.7));
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  function handleCanvasClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!network) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = canvasSize;

    for (const system of network.systems) {
      for (const facility of system.facilities) {
        const [fx, fy] = geoToCanvas(facility.lat, facility.lon, w, h);
        const dist = Math.hypot(mx - fx, my - fy);
        if (dist < 22) {
          selectAsset(facility.id);
          selectSystem(system.id);
          return;
        }
      }
    }
    selectAsset(null);
    selectSystem(null);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!network) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const { w, h } = canvasSize;

    for (const system of network.systems) {
      for (const facility of system.facilities) {
        const [fx, fy] = geoToCanvas(facility.lat, facility.lon, w, h);
        if (Math.hypot(mx - fx, my - fy) < 22) {
          const tankLevel = latestValue(telemetryIndex!, facility.tank.id, 'level_pct', nowUnix) ?? 0;
          const pumpStatus = latestValue(telemetryIndex!, facility.pump.id, 'status', nowUnix) ?? 1;
          setTooltip({
            x: e.clientX - rect.left + 12,
            y: e.clientY - rect.top - 10,
            text: `${facility.id}\nTank: ${tankLevel.toFixed(1)}%\nPump: ${pumpStatus === 1 ? '✅ Running' : '❌ Failed'}`,
          });
          return;
        }
      }
    }
    setTooltip(null);
  }

  return (
    <div className="relative w-full h-full">
      <canvas
        ref={canvasRef}
        className="w-full h-full cursor-crosshair"
        onClick={handleCanvasClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-slate-900/95 border border-slate-600 rounded px-2 py-1 text-xs text-slate-200 whitespace-pre z-10"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
