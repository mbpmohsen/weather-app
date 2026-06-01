# Trailwise Weather Planner

A fast, mobile-first outdoor weather planning app for hiking, trekking, camping, fishing, and custom outdoor plans. It uses the Open-Meteo Forecast API as the live weather provider and turns forecast data into deterministic planning guidance: score, best window, risks, gear, explanations, and charts.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL printed by Astro. For a production build:

```bash
npm run build
npm run preview
```

Run tests:

```bash
npm run test:run
```

## What It Does

- Select a location from browser geolocation, coordinate input, separate lat/lng inputs, pasted map links, recent locations, or map tap/click.
- Pick Hiking, Trekking, Camping, Fishing, or Custom.
- Choose Today, Tomorrow, Weekend, Next 7 days, Next 16 days, or a custom range.
- Use recommended weather presets or manually select Open-Meteo current/hourly/daily variables.
- Fetch real forecast data from `https://api.open-meteo.com/v1/forecast` with `timezone=auto`.
- Show outdoor score, best time window, avoid window, risk cards, gear suggestions, daily explanations, weekly summary, and lazy-loaded charts.
- Cache recent forecasts and recent locations locally, with stale cached data shown when the network fails.
- Provide PWA basics through `manifest.webmanifest` and a small service worker for static assets.

## Architecture

Core modules live in `src/lib`:

- `openMeteoClient.ts` builds validated Forecast API URLs, fetches data, and surfaces API errors.
- `weatherVariableRegistry.ts` stores typed variable metadata by scope, category, unit, description, and activity usage.
- `activityPresets.ts` defines recommended variables for hiking, trekking, camping, fishing, and custom.
- `coordinateParser.ts` parses coordinate pairs, hemisphere formats, labels, and common map links.
- `scoringEngine.ts` computes deterministic scores, risks, best windows, avoid windows, and gear.
- `explanationEngine.ts` creates deterministic outdoor-language explanations.
- `weatherCache.ts` handles forecast caching, stale fallback, recent locations, and custom presets.
- `chartAdapters.ts` converts Open-Meteo hourly data into chart-ready groups.

UI modules live in `src/components`:

- `OutdoorPlanner.tsx` is the main Preact island and app workflow.
- `LightMap.tsx` is a custom lightweight OpenStreetMap tile map with drag, zoom, tap/click selection, and exact pin placement.
- `WeatherCharts.tsx` is lazy-loaded after forecast data is available and uses `uPlot`.

## Performance Decisions

- Astro provides the static shell; Preact handles only the interactive planner island.
- No backend, auth, database, payment, global state library, or heavy UI framework.
- The map is a small custom tile component instead of a full mapping library.
- Chart code is lazy-loaded and split into a separate chunk.
- Forecast requests are cached by coordinates, activity, date range, and selected variables.
- Stale fetches are aborted when a newer forecast request starts.
- Coordinate validation is debounced.
- The production build keeps the planner and chart code separate; current build output shows the planner at about 20 kB gzip and the chart chunk at about 23 kB gzip.

## Testing

Covered with Vitest:

- Coordinate parsing and validation.
- Open-Meteo URL building.
- Open-Meteo JSON error handling.
- Activity preset variable support.
- Scoring engine risk behavior.
- Best time window calculation.
- Explanation generation.

## Usage Notes

The app intentionally says conditions “look suitable” or “risk is elevated” instead of claiming guaranteed safety. Outdoor decisions still need current local alerts, terrain judgment, and on-site conditions.

OpenStreetMap raster tiles are used for the lightweight map. Open-Meteo forecast data is fetched live; mock weather is only used inside tests.

Verification screenshots are available in `screenshots/desktop-home.png` and `screenshots/mobile-home.png`.
