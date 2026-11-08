import { useEffect, useRef, useState } from 'react';
import { useAppStore } from '../../store/appStore';
import { latestValue } from '../../data/loader';
import type { AlertSeverity } from '../../types';

// Weather radar types
interface RadarTile {
  url: string;
  z: number;
  x: number;
  y: number;
}

interface WeatherRadarState {
  tiles: RadarTile[];
  timestamp: number;
  opacity: number;
}

interface CityTemperature {
  high: number;
  low: number;
  timestamp: number;
}

type CityTemperatures = Record<string, CityTemperature>;

export type { CityTemperatures };
const LAT_MIN = 31.15;
const LAT_MAX = 32.45;
const LON_MIN = -103.05;
const LON_MAX = -101.25;
const PAD_X = 52;
const PAD_Y = 40;

// ── Google Maps terrain color palette (West Texas / Permian Basin) ─────────────
const C = {
  landBase:      '#f2ece0',
  scrubLight:    '#d4dcb0',
  scrubMid:      '#c8d09c',
  scrubDark:     '#b8c488',
  waterStroke:   '#8ec4e8',
  dirtRoad:      '#d8c898',
  dirtCasing:    '#b8a878',
  builtUp:       '#e8e0d0',
  padStroke:     '#a09080',
  concreteLight: '#dcd8d0',
  labelDark:     '#3a3020',
};

// City polygon data — loaded once from /data/city_boundaries.json
// null coords = polygon break (multiple polygons per city)
type CityBoundaries = Record<string, ([number, number] | null)[]>;

let cachedBoundaries: CityBoundaries | null = null;

async function loadCityBoundaries(): Promise<CityBoundaries> {
  if (cachedBoundaries) return cachedBoundaries;
  const r = await fetch('/data/city_boundaries.json');
  cachedBoundaries = await r.json();
  return cachedBoundaries!;
}

// City metadata for labels and styling
const CITY_META: Record<string, { pop: 'large' | 'medium' | 'small'; lat: number; lon: number }> = {
  'Odessa':      { pop: 'large',  lat: 31.846, lon: -102.368 },
  'Midland':     { pop: 'large',  lat: 31.997, lon: -102.077 },
  'Big Spring':  { pop: 'medium', lat: 32.243, lon: -101.478 },
  'Monahans':    { pop: 'medium', lat: 31.594, lon: -102.893 },
  'Andrews':     { pop: 'medium', lat: 32.319, lon: -102.545 },
  'McCamey':     { pop: 'small',  lat: 31.136, lon: -102.222 },
  'Rankin':      { pop: 'small',  lat: 31.224, lon: -101.941 },
  'Stanton':     { pop: 'small',  lat: 32.128, lon: -101.789 },
  'Kermit':      { pop: 'small',  lat: 31.858, lon: -103.094 },
};


function geoToCanvas(lat: number, lon: number, w: number, h: number): [number, number] {
  const x = PAD_X + ((lon - LON_MIN) / (LON_MAX - LON_MIN)) * (w - PAD_X * 2);
  const y = PAD_Y + ((LAT_MAX - lat) / (LAT_MAX - LAT_MIN)) * (h - PAD_Y * 2);
  return [x, y];
}

function severityStroke(severity: AlertSeverity): string {
  if (severity === 'critical') return '#cc1111';
  if (severity === 'severe')   return '#d95500';
  if (severity === 'major')    return '#c08800';
  return '#6b7280';
}

function levelColor(level: number): { fill: string; stroke: string } {
  if (level >= 92) return { fill: '#fee2e2', stroke: '#dc2626' };
  if (level >= 85) return { fill: '#ffedd5', stroke: '#ea580c' };
  if (level >= 70) return { fill: '#fef9c3', stroke: '#ca8a04' };
  if (level >= 50) return { fill: '#dcfce7', stroke: '#16a34a' };
  return             { fill: '#d1fae5', stroke: '#059669' };
}

function rng(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

// ── Weather Radar (RainViewer API - Free, no key required) ──────────────────
async function getWeatherRadarTiles(lat: number, lon: number, z: number = 8): Promise<WeatherRadarState> {
  try {
    // RainViewer API endpoint - no key required
    const response = await fetch('https://api.rainviewer.com/public/weather-maps.json');
    const data = await response.json();
    
    if (!data.radar || !data.radar.nowcast || data.radar.nowcast.length === 0) {
      return { tiles: [], timestamp: 0, opacity: 0.6 };
    }

    // Get the latest radar frame
    const latestFrame = data.radar.nowcast[data.radar.nowcast.length - 1];
    const baseUrl = latestFrame.path;
    
    // Calculate tile coordinates for the given lat/lon at zoom level z
    const tiles: RadarTile[] = [];
    
    // RainViewer uses standard Web Mercator tiles (z/x/y format)
    // Generate a 3x3 grid of tiles around the center point
    const n = Math.pow(2, z);
    const lon_rad = (lon + 180) / 360 * n;
    const lat_rad = Math.sin(lat * Math.PI / 180);
    const lat_y = (1 - Math.log(lat_rad + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * n;
    
    const centerX = Math.floor(lon_rad);
    const centerY = Math.floor(lat_y);
    
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const x = centerX + dx;
        const y = centerY + dy;
        // Wrap x coordinate for tiles
        const wrappedX = ((x % n) + n) % n;
        tiles.push({
          url: `${baseUrl}/${z}/${wrappedX}/${y}/tile.png`,
          z,
          x: wrappedX,
          y,
        });
      }
    }

    return {
      tiles,
      timestamp: latestFrame.time * 1000,
      opacity: 0.5,
    };
  } catch (error) {
    console.warn('Failed to load weather radar:', error);
    return { tiles: [], timestamp: 0, opacity: 0 };
  }
}

// ── Fetch temperature data from Open-Meteo (Free, no key required) ──────────────
async function getCityTemperatures(): Promise<CityTemperatures> {
  try {
    const cityCoords: Record<string, { lat: number; lon: number }> = {
      'Odessa':      { lat: 31.846, lon: -102.368 },
      'Midland':     { lat: 31.997, lon: -102.077 },
      'Big Spring':  { lat: 32.243, lon: -101.478 },
      'Monahans':    { lat: 31.594, lon: -102.893 },
      'Andrews':     { lat: 32.319, lon: -102.545 },
      'McCamey':     { lat: 31.136, lon: -102.222 },
      'Rankin':      { lat: 31.224, lon: -101.941 },
      'Stanton':     { lat: 32.128, lon: -101.789 },
      'Kermit':      { lat: 31.858, lon: -103.094 },
    };

    const temps: CityTemperatures = {};
    
    // Fetch weather for each city
    for (const [cityName, { lat, lon }] of Object.entries(cityCoords)) {
      try {
        // Open-Meteo API - free, no key required
        const response = await fetch(
          `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&daily=temperature_2m_max,temperature_2m_min&temperature_unit=fahrenheit&timezone=auto`
        );
        const data = await response.json();
        
        if (data.daily && data.daily.temperature_2m_max && data.daily.temperature_2m_min) {
          temps[cityName] = {
            high: Math.round(data.daily.temperature_2m_max[0]),
            low: Math.round(data.daily.temperature_2m_min[0]),
            timestamp: Date.now(),
          };
        }
      } catch (error) {
        console.warn(`Failed to load temperature for ${cityName}:`, error);
      }
    }

    return temps;
  } catch (error) {
    console.warn('Failed to load city temperatures:', error);
    return {};
  }
}

// ── 1. Terrain ────────────────────────────────────────────────────────────────
function drawTerrain(ctx: CanvasRenderingContext2D, w: number, h: number) {
  // Base parchment
  ctx.fillStyle = C.landBase;
  ctx.fillRect(0, 0, w, h);

  const r = rng(7);

  // Elevation variation blobs
  for (let i = 0; i < 40; i++) {
    const cx = r() * w; const cy = r() * h;
    const rx = 60 + r() * 200; const ry = 40 + r() * 120;
    ctx.fillStyle = `rgba(180,155,110,${0.035 + r() * 0.045})`;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Caliche flats
  for (let i = 0; i < 18; i++) {
    const cx = r() * w; const cy = r() * h;
    ctx.fillStyle = 'rgba(240,228,200,0.18)';
    ctx.beginPath();
    ctx.ellipse(cx, cy, 30 + r() * 100, 20 + r() * 60, r() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }

  // Sparse scrub vegetation dots
  for (let i = 0; i < 220; i++) {
    const vx = r() * w; const vy = r() * h;
    const shade = r() > 0.6 ? C.scrubDark : r() > 0.3 ? C.scrubMid : C.scrubLight;
    ctx.globalAlpha = 0.28 + r() * 0.25;
    ctx.fillStyle = shade;
    ctx.beginPath();
    ctx.arc(vx, vy, 1.5 + r() * 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;

  // Dry creek beds / arroyos
  for (let i = 0; i < 6; i++) {
    let cx = r() * w; let cy = r() * h;
    ctx.strokeStyle = C.waterStroke;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    for (let j = 0; j < 8; j++) {
      cx += (r() - 0.45) * 80; cy += (r() - 0.3) * 50;
      ctx.lineTo(cx, cy);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  // Land survey section line grid (very faint)
  ctx.strokeStyle = 'rgba(160,140,100,0.12)';
  ctx.lineWidth = 0.5;
  ctx.setLineDash([4, 8]);
  for (let lat = 31.2; lat < 32.5; lat += 0.058) {
    const [, y] = geoToCanvas(lat, LON_MIN, w, h);
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(w, y); ctx.stroke();
  }
  for (let lon = -103.1; lon < -101.2; lon += 0.07) {
    const [x] = geoToCanvas(LAT_MIN, lon, w, h);
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
  }
  ctx.setLineDash([]);
}

// ── 2. City boundaries (real OSM polygons) ────────────────────────────────────
function drawCityBoundaries(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  boundaries: CityBoundaries,
  temperatures?: CityTemperatures
) {
  for (const [cityName, coords] of Object.entries(boundaries)) {
    const meta = CITY_META[cityName];
    const isLarge  = meta?.pop === 'large';
    const isMedium = meta?.pop === 'medium';

    // Split coords into separate polygons at null breaks
    const polygons: [number, number][][] = [];
    let current: [number, number][] = [];
    for (const c of coords) {
      if (c === null) {
        if (current.length > 2) polygons.push(current);
        current = [];
      } else {
        current.push(c);
      }
    }
    if (current.length > 2) polygons.push(current);
    if (polygons.length === 0) continue;

    // ── Fill each polygon ────────────────────────────────────────────────────
    for (const poly of polygons) {
      ctx.beginPath();
      let first = true;
      for (const [lon, lat] of poly) {
        const [px, py] = geoToCanvas(lat, lon, w, h);
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      }
      ctx.closePath();

      // Urban fill
      ctx.fillStyle = isLarge
        ? 'rgba(226,218,204,0.80)'
        : isMedium
        ? 'rgba(228,220,208,0.68)'
        : 'rgba(230,223,212,0.55)';
      ctx.fill();

      // Street grid texture (clipped inside polygon)
      if (isLarge || isMedium) {
        ctx.save();
        ctx.beginPath();
        first = true;
        for (const [lon, lat] of poly) {
          const [px, py] = geoToCanvas(lat, lon, w, h);
          if (first) { ctx.moveTo(px, py); first = false; }
          else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.clip();

        ctx.strokeStyle = 'rgba(255,255,255,0.55)';
        ctx.lineWidth = 1;
        // Compute bounding box for grid
        const pxs = poly.map(([lon, lat]) => geoToCanvas(lat, lon, w, h)[0]);
        const pys = poly.map(([lon, lat]) => geoToCanvas(lat, lon, w, h)[1]);
        const minX = Math.min(...pxs); const maxX = Math.max(...pxs);
        const minY = Math.min(...pys); const maxY = Math.max(...pys);
        const spacing = isLarge ? 11 : 15;
        for (let gy = minY; gy <= maxY; gy += spacing) {
          ctx.beginPath(); ctx.moveTo(minX, gy); ctx.lineTo(maxX, gy); ctx.stroke();
        }
        for (let gx = minX; gx <= maxX; gx += spacing) {
          ctx.beginPath(); ctx.moveTo(gx, minY); ctx.lineTo(gx, maxY); ctx.stroke();
        }
        ctx.restore();
      }

      // Boundary outline
      ctx.beginPath();
      first = true;
      for (const [lon, lat] of poly) {
        const [px, py] = geoToCanvas(lat, lon, w, h);
        if (first) { ctx.moveTo(px, py); first = false; }
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.strokeStyle = isLarge
        ? 'rgba(145,130,110,0.75)'
        : isMedium
        ? 'rgba(145,130,110,0.58)'
        : 'rgba(145,130,110,0.42)';
      ctx.lineWidth = isLarge ? 1.8 : isMedium ? 1.2 : 0.9;
      ctx.setLineDash(isLarge ? [] : isMedium ? [5, 4] : [3, 4]);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // ── City name label ───────────────────────────────────────────────────────
    // Place label at the city center coordinate
    if (meta) {
      const [lx, ly] = geoToCanvas(meta.lat, meta.lon, w, h);
      const fontSize = isLarge ? 10.5 : isMedium ? 9 : 7.5;
      ctx.font = `${isLarge ? 'bold ' : ''}${fontSize}px "Roboto Mono", monospace`;
      ctx.textAlign = 'center';
      // White halo
      ctx.lineWidth = 3.5;
      ctx.strokeStyle = 'rgba(255,255,255,0.92)';
      ctx.lineJoin = 'round';
      ctx.strokeText(cityName.toUpperCase(), lx, ly);
      ctx.fillStyle = isLarge ? '#3d3220' : '#5a4c38';
      ctx.fillText(cityName.toUpperCase(), lx, ly);
      
      // Add temperature if available
      if (temperatures && temperatures[cityName]) {
        const temp = temperatures[cityName];
        const tempText = `H: ${temp.high}° L: ${temp.low}°`;
        const tempFontSize = isLarge ? 10 : isMedium ? 8.5 : 7.5;
        ctx.font = `${tempFontSize}px "Roboto Mono", monospace`;
        ctx.lineWidth = 2.5;
        ctx.strokeStyle = 'rgba(255,255,255,0.85)';
        ctx.strokeText(tempText, lx, ly + (isLarge ? 14 : isMedium ? 12 : 10));
        ctx.fillStyle = '#d97706'; // Amber color for temperature
        ctx.fillText(tempText, lx, ly + (isLarge ? 14 : isMedium ? 12 : 10));
        
        // Draw warning icon if temperature is extreme
        if (temp.high > 100) {
          drawTemperatureWarning(ctx, lx + 28, ly - 8, 'hot');
        } else if (temp.low < 20) {
          drawTemperatureWarning(ctx, lx + 28, ly - 8, 'cold');
        }
      }
    }
  }
}

// ── 3. Roads ──────────────────────────────────────────────────────────────────
function drawRoads(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  network: NonNullable<ReturnType<typeof useAppStore.getState>['network']>
) {
  for (const system of network.systems) {
    const [yardX, yardY] = geoToCanvas(system.truck_yard[0], system.truck_yard[1], w, h);

    for (const facility of system.facilities) {
      const [facX, facY] = geoToCanvas(facility.lat, facility.lon, w, h);
      const mx = (yardX + facX) / 2 + (facY - yardY) * 0.07;
      const my = (yardY + facY) / 2 - (facX - yardX) * 0.07;

      ctx.strokeStyle = C.dirtCasing;
      ctx.lineWidth = 4;
      ctx.lineJoin = 'round';
      ctx.lineCap  = 'round';
      ctx.beginPath();
      ctx.moveTo(yardX, yardY);
      ctx.quadraticCurveTo(mx, my, facX, facY);
      ctx.stroke();

      ctx.strokeStyle = C.dirtRoad;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(yardX, yardY);
      ctx.quadraticCurveTo(mx, my, facX, facY);
      ctx.stroke();
    }

    // Disposal access road
    const [dispX, dispY] = geoToCanvas(system.disposal_site.lat, system.disposal_site.lon, w, h);
    const [yx, yy] = geoToCanvas(system.truck_yard[0], system.truck_yard[1], w, h);
    ctx.strokeStyle = C.dirtCasing; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(yx, yy); ctx.lineTo(dispX, dispY); ctx.stroke();
    ctx.strokeStyle = C.dirtRoad;   ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(yx, yy); ctx.lineTo(dispX, dispY); ctx.stroke();
  }
}

// ── 4. Pipelines ──────────────────────────────────────────────────────────────
function drawPipelines(
  ctx: CanvasRenderingContext2D, w: number, h: number,
  network: NonNullable<ReturnType<typeof useAppStore.getState>['network']>,
  telemetryIndex: NonNullable<ReturnType<typeof useAppStore.getState>['telemetryIndex']>,
  nowUnix: number,
  allEvents: ReturnType<typeof useAppStore.getState>['events'],
  frame: number
) {
  for (const system of network.systems) {
    const [dispX, dispY] = geoToCanvas(system.disposal_site.lat, system.disposal_site.lon, w, h);

    for (const facility of system.facilities) {
      const [facX, facY] = geoToCanvas(facility.lat, facility.lon, w, h);
      const pipeEvt = allEvents.find(
        (e) => e.asset === facility.pipeline.id && e.status !== 'predicted'
      );

      ctx.lineCap = 'round';

      if (pipeEvt) {
        const p = Math.sin(frame * 0.12) * 0.5 + 0.5;
        ctx.strokeStyle = `rgba(210,40,40,${0.55 + p * 0.45})`;
        ctx.lineWidth = 3;
        ctx.shadowColor = '#cc2020'; ctx.shadowBlur = 6 + p * 6;
        ctx.setLineDash([8, 4]);
      } else {
        const pressure = latestValue(telemetryIndex, facility.pipeline.id, 'pressure_psi', nowUnix) ?? 0;
        const maxPsi = facility.pipeline.max_pressure_psi;
        const ratio = maxPsi > 0 ? Math.min(1, pressure / maxPsi) : 0.5;
        ctx.strokeStyle = `rgba(60,120,200,${0.45 + ratio * 0.35})`;
        ctx.lineWidth = 2; ctx.shadowBlur = 0;
        ctx.setLineDash([6, 5]);
      }

      ctx.beginPath();
      ctx.moveTo(facX, facY);
      ctx.lineTo(dispX, dispY);
      ctx.stroke();
      ctx.setLineDash([]); ctx.shadowBlur = 0;

      // Flow arrow
      if (!pipeEvt) {
        const mx = facX + (dispX - facX) * 0.48;
        const my = facY + (dispY - facY) * 0.48;
        const ang = Math.atan2(dispY - facY, dispX - facX);
        ctx.save();
        ctx.translate(mx, my); ctx.rotate(ang);
        ctx.fillStyle = 'rgba(60,120,200,0.5)';
        ctx.beginPath();
        ctx.moveTo(6, 0); ctx.lineTo(-3, -3.5); ctx.lineTo(-3, 3.5);
        ctx.closePath(); ctx.fill();
        ctx.restore();
      }
    }
  }
}

// ── Tank widget ───────────────────────────────────────────────────────────────
function drawTank(
  ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number,
  levelPct: number, colors: { fill: string; stroke: string }
) {
  ctx.fillStyle = '#ffffff';
  ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 3;
  ctx.beginPath(); ctx.arc(cx, cy, r + 1.5, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.fillStyle = colors.fill;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.fill();

  const fillAngle = (levelPct / 100) * Math.PI * 2;
  ctx.strokeStyle = colors.stroke; ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(cx, cy, r - 2, -Math.PI / 2, -Math.PI / 2 + fillAngle);
  ctx.stroke();

  ctx.strokeStyle = colors.stroke; ctx.lineWidth = 1.5; ctx.globalAlpha = 0.4;
  ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;

  // 92% warning tick
  const warnA = -Math.PI / 2 + 0.92 * Math.PI * 2;
  ctx.strokeStyle = '#dc2626'; ctx.lineWidth = 1; ctx.globalAlpha = 0.55;
  ctx.beginPath();
  ctx.moveTo(cx + Math.cos(warnA) * (r - 4), cy + Math.sin(warnA) * (r - 4));
  ctx.lineTo(cx + Math.cos(warnA) * (r + 1), cy + Math.sin(warnA) * (r + 1));
  ctx.stroke();
  ctx.globalAlpha = 1;
}

// ── Animated pumpjack ─────────────────────────────────────────────────────────
function drawPumpjack(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  scale: number, frame: number, offset: number
) {
  const bob = Math.sin((frame + offset) * 0.06) * 0.28;
  ctx.save();
  ctx.translate(cx, cy); ctx.scale(scale, scale);

  const ink = 'rgba(80,75,65,0.85)';
  ctx.strokeStyle = ink; ctx.fillStyle = ink;
  ctx.lineWidth = 1.8 / scale; ctx.lineCap = 'round';

  ctx.fillRect(-9, 2, 18, 3);                         // skid
  ctx.beginPath(); ctx.moveTo(0, 2); ctx.lineTo(0, -15); ctx.stroke(); // mast
  ctx.beginPath(); ctx.arc(0, -15, 1.8, 0, Math.PI * 2); ctx.fill();  // pivot

  ctx.save();
  ctx.translate(0, -15); ctx.rotate(bob);
  ctx.lineWidth = 2.5 / scale;
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(10, 0); ctx.stroke();
  ctx.beginPath(); ctx.arc(10, 0, 2.8, 0, Math.PI * 2); ctx.fill();    // horsehead

  ctx.strokeStyle = 'rgba(100,95,85,0.7)'; ctx.lineWidth = 1.2 / scale;
  ctx.beginPath(); ctx.moveTo(10, 2.8); ctx.lineTo(10, 22); ctx.stroke(); // sucker rod

  ctx.strokeStyle = ink; ctx.lineWidth = 2 / scale;
  ctx.beginPath(); ctx.moveTo(-11, 0); ctx.lineTo(-11, 7); ctx.stroke();
  ctx.beginPath(); ctx.arc(-11, 8.5, 4.5, 0, Math.PI * 2); ctx.fill(); // counterweight

  ctx.restore();
  ctx.restore();
}

// ── Facility pad ──────────────────────────────────────────────────────────────
function drawFacilityPad(
  ctx: CanvasRenderingContext2D, cx: number, cy: number,
  tankLevel: number, pumpStatus: number, pumpFlow: number,
  label: string, isSelected: boolean,
  hasAlarm: boolean, alarmSeverity: AlertSeverity | null,
  frame: number
) {
  const tankColors = levelColor(tankLevel);
  const pulse = Math.sin(frame * 0.07) * 0.5 + 0.5;
  const padW = 52; const padH = 44;
  const padX = cx - padW / 2; const padY = cy - padH / 2;

  ctx.shadowColor = hasAlarm
    ? (alarmSeverity === 'critical' ? `rgba(200,0,0,${0.3 + pulse * 0.3})`
     : alarmSeverity === 'severe'   ? `rgba(220,80,0,${0.25 + pulse * 0.2})`
     : `rgba(180,130,0,${0.2 + pulse * 0.15})`)
    : 'rgba(0,0,0,0.18)';
  ctx.shadowBlur = hasAlarm ? 12 + pulse * 10 : 4;

  ctx.fillStyle   = C.concreteLight;
  ctx.strokeStyle = isSelected ? '#2563eb'
    : hasAlarm ? severityStroke(alarmSeverity!) : C.padStroke;
  ctx.lineWidth = isSelected ? 2.5 : hasAlarm ? 2 : 1;
  ctx.beginPath();
  (ctx as CanvasRenderingContext2D).roundRect(padX, padY, padW, padH, 3);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;

  // Pumpjack (left side)
  const offset = (cx + cy) * 3;
  drawPumpjack(ctx, cx - 13, cy + 6, 0.68, frame, offset);

  // Storage tank (right side)
  drawTank(ctx, cx + 15, cy, 9, tankLevel, tankColors);
  ctx.font = 'bold 6.5px "Roboto Mono", monospace';
  ctx.fillStyle = tankColors.stroke; ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(tankLevel)}%`, cx + 15, cy + 2.5);

  // Pump status dot
  const dotColor =
    pumpStatus === 2 ? '#dc2626' :
    pumpStatus === 0 ? '#d97706' :
    pumpFlow > 100   ? '#16a34a' : '#ca8a04';
  ctx.shadowColor = dotColor; ctx.shadowBlur = pumpStatus === 2 ? 7 : 3;
  ctx.fillStyle = dotColor; ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(cx + 22, cy - 16, 4.5, 0, Math.PI * 2);
  ctx.fill(); ctx.stroke();
  ctx.shadowBlur = 0;

  // Name label pill (white background)
  const lw = 52;
  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 3;
  ctx.beginPath();
  (ctx as CanvasRenderingContext2D).roundRect(cx - lw / 2, cy + padH / 2 + 3, lw, 13, 3);
  ctx.fill(); ctx.shadowBlur = 0;
  ctx.font = 'bold 7.5px "Roboto Mono", monospace';
  ctx.fillStyle = C.labelDark; ctx.textAlign = 'center';
  ctx.fillText(label, cx, cy + padH / 2 + 12);
}

// ── Disposal site ─────────────────────────────────────────────────────────────
function drawDisposal(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 4;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath(); ctx.arc(cx, cy, 13, 0, Math.PI * 2); ctx.fill();
  ctx.shadowBlur = 0;

  ctx.strokeStyle = '#3b82f6'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 0.5;
  ctx.beginPath(); ctx.arc(cx, cy, 5, 0, Math.PI * 2); ctx.stroke();
  ctx.globalAlpha = 1;
  ctx.fillStyle = '#3b82f6';
  ctx.beginPath(); ctx.arc(cx, cy, 2.5, 0, Math.PI * 2); ctx.fill();

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 2;
  ctx.beginPath(); (ctx as CanvasRenderingContext2D).roundRect(cx - 24, cy + 15, 48, 12, 3); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = '7px "Roboto Mono", monospace'; ctx.fillStyle = '#1d4ed8'; ctx.textAlign = 'center';
  ctx.fillText('DISPOSAL', cx, cy + 24);
}

// ── Truck yard ────────────────────────────────────────────────────────────────
function drawTruckYard(ctx: CanvasRenderingContext2D, cx: number, cy: number) {
  ctx.shadowColor = 'rgba(0,0,0,0.14)'; ctx.shadowBlur = 3;
  ctx.fillStyle = '#e8e0d0'; ctx.strokeStyle = C.padStroke; ctx.lineWidth = 1;
  ctx.beginPath(); (ctx as CanvasRenderingContext2D).roundRect(cx - 16, cy - 11, 32, 22, 2);
  ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;

  ctx.fillStyle = '#92400e';
  ctx.fillRect(cx - 12, cy - 6, 9, 5);
  ctx.fillRect(cx + 2,  cy - 6, 9, 5);
  ctx.fillRect(cx - 12, cy + 1, 9, 5);

  ctx.fillStyle = 'rgba(255,255,255,0.92)';
  ctx.shadowColor = 'rgba(0,0,0,0.12)'; ctx.shadowBlur = 2;
  ctx.beginPath(); (ctx as CanvasRenderingContext2D).roundRect(cx - 20, cy + 13, 40, 12, 3); ctx.fill();
  ctx.shadowBlur = 0;
  ctx.font = '7px "Roboto Mono", monospace'; ctx.fillStyle = '#78350f'; ctx.textAlign = 'center';
  ctx.fillText('TRUCK YARD', cx, cy + 22);
}

// ── System label ──────────────────────────────────────────────────────────────
function drawSystemLabel(ctx: CanvasRenderingContext2D, cx: number, cy: number, id: string) {
  ctx.font = 'bold 11px "Roboto Mono", monospace'; ctx.textAlign = 'center';
  const tw = ctx.measureText(id).width + 18;
  ctx.fillStyle = 'rgba(255,255,255,0.80)';
  ctx.strokeStyle = 'rgba(100,140,200,0.40)'; ctx.lineWidth = 1;
  ctx.shadowColor = 'rgba(0,0,0,0.10)'; ctx.shadowBlur = 3;
  ctx.beginPath(); (ctx as CanvasRenderingContext2D).roundRect(cx - tw / 2, cy - 11, tw, 18, 4);
  ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
  ctx.fillStyle = '#1e40af';
  ctx.fillText(id, cx, cy + 3);
}

// ── Weather Radar Heatmap effect ──────────────────────────────────────────────
function drawRadarHeatmap(ctx: CanvasRenderingContext2D, w: number, h: number, frame: number) {
  // Create a temporary off-screen canvas for the heatmap
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d')!;

  // Create animated radar sweep pattern with heatmap colors on temp canvas
  const pixelData = tempCtx.createImageData(w, h);
  const data = pixelData.data;

  // Radar sweep line (rotates slowly)
  const sweepAngle = (frame * 0.005) % (Math.PI * 2);
  const centerX = w / 2;
  const centerY = h / 2;

  for (let pixelIndex = 0; pixelIndex < data.length; pixelIndex += 4) {
    const pixelNum = pixelIndex / 4;
    const pixelX = pixelNum % w;
    const pixelY = Math.floor(pixelNum / w);

    // Calculate distance and angle from center
    const dx = pixelX - centerX;
    const dy = pixelY - centerY;
    const distance = Math.sqrt(dx * dx + dy * dy);
    const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);
    const distanceRatio = Math.min(distance / maxDistance, 1);

    // Calculate angle from center
    let pixelAngle = Math.atan2(dy, dx);
    if (pixelAngle < 0) pixelAngle += Math.PI * 2;

    // Sweep beam width (narrow cone rotating around)
    const angleFromSweep = Math.abs(pixelAngle - sweepAngle);
    const normalizedAngle = Math.min(angleFromSweep, Math.PI * 2 - angleFromSweep);
    const sweepWidth = 0.15; // Narrow beam width
    const inSweep = normalizedAngle < sweepWidth;

    // Create rain intensity pattern based on Perlin-like noise
    // Use frame and position to create animated storm cells
    const noiseX = Math.sin(pixelX * 0.003 + frame * 0.002) * 50;
    const noiseY = Math.cos(pixelY * 0.003 + frame * 0.002) * 50;
    const cellNoise = Math.sin((pixelX + noiseX) * 0.02) * Math.cos((pixelY + noiseY) * 0.02);
    
    // Add movement to the storm pattern
    const stormPattern = Math.sin(frame * 0.02 + pixelX * 0.005 - pixelY * 0.005);
    let rainIntensity = (cellNoise * 0.5 + stormPattern * 0.5 + 0.5) * 0.8;

    // More intense rain in center, fading toward edges
    rainIntensity *= (1 - distanceRatio * 0.3);

    // Apply sweep beam effect (brightens in the sweep direction)
    if (inSweep) {
      rainIntensity = Math.min(rainIntensity + 0.4, 1);
    }

    // Determine color based on rain intensity (green -> yellow -> red)
    let r, g, b, alpha;

    if (rainIntensity < 0.2) {
      // Very light - skip (transparent)
      r = 0; g = 0; b = 0;
      alpha = 0;
    } else if (rainIntensity < 0.5) {
      // Light rain - green
      r = 100; g = 200; b = 100;
      alpha = Math.round(rainIntensity * 100); // Much lower alpha
    } else if (rainIntensity < 0.75) {
      // Moderate rain - yellow/orange
      const t = (rainIntensity - 0.5) / 0.25;
      r = Math.round(100 + t * 120); // 100 -> 220
      g = Math.round(200 - t * 100); // 200 -> 100
      b = Math.round(100 - t * 80); // 100 -> 20
      alpha = Math.round(rainIntensity * 120); // Much lower alpha
    } else {
      // Heavy/severe rain - red
      r = 220; g = 50; b = 50;
      alpha = Math.round(rainIntensity * 140); // Much lower alpha
    }

    data[pixelIndex] = r;
    data[pixelIndex + 1] = g;
    data[pixelIndex + 2] = b;
    data[pixelIndex + 3] = alpha;
  }

  tempCtx.putImageData(pixelData, 0, 0);

  // Draw radar grid overlay on temp canvas
  tempCtx.globalAlpha = 0.2;
  tempCtx.strokeStyle = '#00ff00';
  tempCtx.lineWidth = 0.5;

  const maxDistance = Math.sqrt(centerX * centerX + centerY * centerY);

  // Concentric circles (range rings)
  for (let r = 50; r < maxDistance; r += 50) {
    tempCtx.beginPath();
    tempCtx.arc(centerX, centerY, r, 0, Math.PI * 2);
    tempCtx.stroke();
  }

  // Radial lines (compass lines)
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    const maxR = maxDistance;
    const endX = centerX + Math.cos(angle) * maxR;
    const endY = centerY + Math.sin(angle) * maxR;
    tempCtx.beginPath();
    tempCtx.moveTo(centerX, centerY);
    tempCtx.lineTo(endX, endY);
    tempCtx.stroke();
  }

  // Now draw the temp canvas onto the main canvas with low opacity
  ctx.globalAlpha = 0.25; // Only 25% opacity of the entire heatmap layer
  ctx.drawImage(tempCanvas, 0, 0);
  ctx.globalAlpha = 1;
}

// ── Tornado effect ────────────────────────────────────────────────────────────
function drawTornado(ctx: CanvasRenderingContext2D, cx: number, cy: number, frame: number) {
  const rotationAngle = (frame * 0.05) % (Math.PI * 2);
  
  // Tornado funnel
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(rotationAngle);
  
  // Draw spiral
  ctx.strokeStyle = 'rgba(80, 80, 100, 0.5)';
  ctx.lineWidth = 2.5;
  
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    for (let angle = 0; angle < Math.PI * 2; angle += 0.1) {
      const radius = (angle / (Math.PI * 2)) * 50 + i * 18;
      const x = Math.cos(angle) * radius;
      const y = Math.sin(angle) * radius;
      if (angle === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  
  // Warning glow - red for tornado danger
  ctx.globalAlpha = 0.25;
  ctx.fillStyle = '#ff4444';
  ctx.beginPath();
  ctx.arc(0, 0, 70, 0, Math.PI * 2);
  ctx.fill();
  
  ctx.restore();
  ctx.globalAlpha = 1;
}
function drawTemperatureWarning(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  type: 'hot' | 'cold'
) {
  const bgColor = type === 'hot' ? '#ef4444' : '#3b82f6';
  const size = 18;

  // Background circle
  ctx.shadowColor = 'rgba(0,0,0,0.3)';
  ctx.shadowBlur = 5;
  ctx.fillStyle = bgColor;
  ctx.beginPath();
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fill();
  ctx.shadowBlur = 0;

  // Triangle outline
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, cy - 8);
  ctx.lineTo(cx + 7, cy + 6);
  ctx.lineTo(cx - 7, cy + 6);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();

  // Exclamation mark
  ctx.fillStyle = bgColor === '#ef4444' ? '#ffffff' : '#ffffff';
  ctx.beginPath();
  ctx.arc(cx, cy + 3, 1.5, 0, Math.PI * 2);
  ctx.fill();

  // Dot under exclamation
  ctx.beginPath();
  ctx.arc(cx, cy + 7, 1, 0, Math.PI * 2);
  ctx.fill();
}
export default function CityCanvas({ 
  onTemperaturesChange, 
  weatherSimActive = false,
  showRain = false,
  showTornado = false
}: { 
  onTemperaturesChange?: (temps: CityTemperatures) => void;
  weatherSimActive?: boolean;
  showRain?: boolean;
  showTornado?: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef   = useRef<number>(0);
  const frameRef  = useRef<number>(0);
  const {
    network, telemetryIndex, nowUnix, events, predictions,
    selectAsset, selectSystem, selectedAssetId,
  } = useAppStore();
  const [tooltip, setTooltip] = useState<{ x: number; y: number; text: string } | null>(null);
  const [canvasSize, setCanvasSize] = useState({ w: 900, h: 600 });
  const [boundaries, setBoundaries] = useState<CityBoundaries>({});
  const [radarData, setRadarData] = useState<WeatherRadarState>({ tiles: [], timestamp: 0, opacity: 0.5 });
  const radarRefreshRef = useRef<NodeJS.Timeout | null>(null);
  const [temperatures, setTemperatures] = useState<CityTemperatures>({});
  const tempRefreshRef = useRef<NodeJS.Timeout | null>(null);

  // Load boundary polygons once
  useEffect(() => {
    loadCityBoundaries().then(setBoundaries).catch(() => {});
  }, []);

  // Load weather radar data periodically (every 5 minutes)
  useEffect(() => {
    const centerLat = (LAT_MIN + LAT_MAX) / 2;
    const centerLon = (LON_MIN + LON_MAX) / 2;
    
    const loadRadar = async () => {
      const newRadarData = await getWeatherRadarTiles(centerLat, centerLon, 8);
      setRadarData(newRadarData);
    };

    loadRadar();
    radarRefreshRef.current = setInterval(loadRadar, 5 * 60 * 1000);

    return () => {
      if (radarRefreshRef.current) clearInterval(radarRefreshRef.current);
    };
  }, []);

  // Load city temperatures periodically (every 10 minutes)
  useEffect(() => {
    const loadTemps = async () => {
      const newTemps = await getCityTemperatures();
      setTemperatures(newTemps);
      onTemperaturesChange?.(newTemps);
    };

    loadTemps();
    tempRefreshRef.current = setInterval(loadTemps, 10 * 60 * 1000);

    return () => {
      if (tempRefreshRef.current) clearInterval(tempRefreshRef.current);
    };
  }, [onTemperaturesChange]);

  useEffect(() => {
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setCanvasSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    if (canvasRef.current?.parentElement) obs.observe(canvasRef.current.parentElement);
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !network || !telemetryIndex) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function draw() {
      frameRef.current++;
      const frame = frameRef.current;
      const { w, h } = canvasSize;
      canvas!.width = w; canvas!.height = h;
      if (!network || !telemetryIndex) return;

      // Layer order: terrain → weather radar → cities → roads → pipelines → facilities → trucks
      drawTerrain(ctx!, w, h);
      
      // Add subtle weather radar visual indicator
      if (radarData.tiles.length > 0) {
        ctx!.globalAlpha = 0.08;
        ctx!.fillStyle = '#6495ed';
        ctx!.fillRect(0, 0, w, h);
        ctx!.globalAlpha = 1;
        
        // Animated radar sweep line
        const sweepAngle = (frame * 0.005) % (Math.PI * 2);
        const centerX = w / 2;
        const centerY = h / 2;
        const radius = Math.max(w, h) / 1.5;
        
        ctx!.strokeStyle = 'rgba(100, 150, 255, 0.2)';
        ctx!.lineWidth = 2;
        ctx!.globalAlpha = 0.3 + Math.sin(frame * 0.008) * 0.2;
        ctx!.beginPath();
        ctx!.moveTo(centerX, centerY);
        ctx!.lineTo(
          centerX + Math.cos(sweepAngle) * radius,
          centerY + Math.sin(sweepAngle) * radius
        );
        ctx!.stroke();
        ctx!.globalAlpha = 1;
      }
      
      drawCityBoundaries(ctx!, w, h, boundaries, temperatures);
      drawRoads(ctx!, w, h, network);

      const allEvents = [...events, ...predictions];
      drawPipelines(ctx!, w, h, network, telemetryIndex!, nowUnix, allEvents, frame);

      for (const system of network.systems) {
        const [dX, dY] = geoToCanvas(system.disposal_site.lat, system.disposal_site.lon, w, h);
        drawDisposal(ctx!, dX, dY);

        const [yX, yY] = geoToCanvas(system.truck_yard[0], system.truck_yard[1], w, h);
        drawTruckYard(ctx!, yX, yY);

        for (const facility of system.facilities) {
          const [fX, fY] = geoToCanvas(facility.lat, facility.lon, w, h);
          const tankLevel  = latestValue(telemetryIndex!, facility.tank.id,  'level_pct', nowUnix) ?? 50;
          const pumpStatus = latestValue(telemetryIndex!, facility.pump.id,  'status',    nowUnix) ?? 1;
          const pumpFlow   = latestValue(telemetryIndex!, facility.pump.id,  'flow_bpd',  nowUnix) ?? 0;
          const facEvt     = allEvents.find((e) => e.facility === facility.id && e.status !== 'predicted');
          const isSelected =
            selectedAssetId === facility.id ||
            selectedAssetId === facility.pump.id ||
            selectedAssetId === facility.tank.id;

          drawFacilityPad(
            ctx!, fX, fY, tankLevel, pumpStatus, pumpFlow,
            `${system.id}-${facility.id.replace(/^S\d+_FACILITY_/, '')}`,
            isSelected, !!facEvt, facEvt?.severity ?? null, frame
          );
        }

        const [cX, cY] = geoToCanvas(system.center[0], system.center[1], w, h);
        drawSystemLabel(ctx!, cX, cY - 52, system.id);
      }

      // Trucks
      const { trucks } = useAppStore.getState();
      for (const truck of trucks) {
        if (truck.status !== 'en_route' && truck.status !== 'on_site') continue;
        const sys = network.systems.find((s) => s.id === truck.system_id);
        const fac = sys?.facilities.find((f) => f.id === truck.facility_id);
        if (!sys || !fac) continue;
        const progress = truck.status === 'on_site' ? 1
          : Math.min(1, (nowUnix - truck.dispatched_at) / Math.max(1, truck.eta_arrival - truck.dispatched_at));
        const [yX2, yY2] = geoToCanvas(sys.truck_yard[0], sys.truck_yard[1], w, h);
        const [fX2, fY2] = geoToCanvas(fac.lat, fac.lon, w, h);
        const tX = yX2 + (fX2 - yX2) * progress;
        const tY = yY2 + (fY2 - yY2) * progress;

        ctx!.shadowColor = 'rgba(0,0,0,0.25)'; ctx!.shadowBlur = 4;
        ctx!.fillStyle   = truck.on_time ? '#f59e0b' : '#ef4444';
        ctx!.strokeStyle = '#ffffff'; ctx!.lineWidth = 1.5;
        ctx!.beginPath();
        (ctx as CanvasRenderingContext2D).roundRect(tX - 8, tY - 6, 16, 11, 2);
        ctx!.fill(); ctx!.stroke(); ctx!.shadowBlur = 0;
        ctx!.font = 'bold 7px "Roboto Mono", monospace';
        ctx!.fillStyle = '#ffffff'; ctx!.textAlign = 'center';
        ctx!.fillText('TRK', tX, tY + 2);
      }

      // Weather simulation effects
      if (weatherSimActive) {
        if (showRain) {
          drawRadarHeatmap(ctx!, w, h, frame);
        }
        if (showTornado) {
          // Draw tornado at a random location that moves
          const tornadoX = (Math.sin(frame * 0.02) * 150 + w / 2) % w;
          const tornadoY = (Math.cos(frame * 0.015) * 100 + h / 2) % h;
          drawTornado(ctx!, tornadoX, tornadoY, frame);
        }
      }

      animRef.current = requestAnimationFrame(draw);
    }

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [network, telemetryIndex, nowUnix, events, predictions, canvasSize, selectedAssetId, boundaries, temperatures, weatherSimActive, showRain, showTornado]);

  function handleClick(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!network) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const { w, h } = canvasSize;
    for (const sys of network.systems) {
      for (const fac of sys.facilities) {
        const [fx, fy] = geoToCanvas(fac.lat, fac.lon, w, h);
        if (Math.hypot(mx - fx, my - fy) < 30) {
          selectAsset(fac.id); selectSystem(sys.id); return;
        }
      }
    }
    selectAsset(null); selectSystem(null);
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    if (!network || !telemetryIndex) return;
    const rect = canvasRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left; const my = e.clientY - rect.top;
    const { w, h } = canvasSize;
    for (const sys of network.systems) {
      for (const fac of sys.facilities) {
        const [fx, fy] = geoToCanvas(fac.lat, fac.lon, w, h);
        if (Math.hypot(mx - fx, my - fy) < 30) {
          const lv = latestValue(telemetryIndex, fac.tank.id, 'level_pct', nowUnix) ?? 0;
          const ps = latestValue(telemetryIndex, fac.pump.id, 'status', nowUnix) ?? 1;
          setTooltip({
            x: mx + 14, y: my - 8,
            text: `${fac.id}\nTank: ${lv.toFixed(1)}%\nPump: ${ps === 1 ? 'Running' : ps === 2 ? 'FAULT' : 'Stopped'}`,
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
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setTooltip(null)}
      />
      
      {/* Weather radar status indicator */}
      {radarData.tiles.length > 0 && (
        <div className="absolute top-4 right-4 bg-blue-900/70 border border-blue-500 rounded-lg px-3 py-2 text-xs text-blue-200 z-20 pointer-events-none">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 bg-blue-400 rounded-full animate-pulse"></div>
            <span className="font-bold">WEATHER RADAR ACTIVE</span>
          </div>
          <div className="text-xs text-blue-300">Live precipitation data from RainViewer</div>
          <div className="text-xs text-blue-300 mt-1">
            Updated: {new Date(radarData.timestamp).toLocaleTimeString()}
          </div>
        </div>
      )}
      
      {tooltip && (
        <div
          className="absolute pointer-events-none bg-white/95 border border-gray-300 shadow-md rounded px-2 py-1.5 text-xs text-gray-800 whitespace-pre z-10"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          {tooltip.text}
        </div>
      )}
    </div>
  );
}
