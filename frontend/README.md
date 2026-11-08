# Frontend: EOG Ops Console

React + TypeScript + Vite. Map of every system (Konva canvas), replay timeline, alerts, costs,
truck tracker and notifications.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check and production build
```

The backend (Spring Boot on :8081) must be running for live analysis. Vite forwards `/api/*` and
the dataset files (`/data/<dataset>/{network.json,ops.json,telemetry.csv}`) to it; see
`vite.config.ts`. Without it the console uses its in-browser engine (`src/engine/detector.ts`).

## Where things live

| Path | What |
|---|---|
| `src/store/appStore.ts` | App state: dataset loading, analysis, replay clock, notifications |
| `src/data/api.ts` | Backend calls (`/api/datasets`, `/api/analysis`) |
| `src/data/loader.ts` | Loads the dataset files and indexes telemetry for the map and charts |
| `src/engine/replay.ts` | Events, countdowns and alert order at any replay time |
| `src/components/Replay/ReplayBar.tsx` | Timeline strip: play, pause, scrub, event markers, weather |
| `src/components/CityMap/CityCanvas.tsx` | Map drawing and recorded weather |
| `src/components/Controls/ControlsMenu.tsx` | Dataset picker, replay and weather drill controls |
| `src/components/AlertPanel/` | Alerts in the required order |
| `public/` | Logo, icons and `data/city_boundaries.json` (city outlines for the map) |

Datasets live in the repo's top-level `data/` folder, not in `public/`.
