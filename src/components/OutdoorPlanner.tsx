import {
  AlertTriangle,
  Backpack,
  CalendarDays,
  CheckCircle2,
  Clock,
  CloudSun,
  Compass,
  Fish,
  LocateFixed,
  LoaderCircle,
  MapPin,
  Mountain,
  Navigation,
  RefreshCcw,
  Search,
  Share2,
  ShieldAlert,
  SlidersHorizontal,
  Tent,
  Umbrella,
  ExternalLink,
  Layers
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { activityModes, activityPresets, getActivityPreset } from "../lib/activityPresets";
import { parseCoordinates, validateCoordinates } from "../lib/coordinateParser";
import { dateRangeOptions, defaultWeekend, filterDatesForRange, forecastDaysForRange, weekendPresets, type WeekendPreset } from "../lib/dateRanges";
import { parseElevation, summarizeHighPoint } from "../lib/highPoint";
import { buildModelComparisonUrl, compareModelsForDate, type ModelAgreement } from "../lib/modelComparison";
import { explainForecast } from "../lib/explanationEngine";
import { buildNowcast, withCoreVariables, type Nowcast } from "../lib/nowcast";
import { buildForecastUrl, fetchOpenMeteoForecast, OpenMeteoError } from "../lib/openMeteoClient";
import { scoreForecast, summarizeScores } from "../lib/scoringEngine";
import type { ActivityMode, Coordinates, DateRangeSelection, ForecastRequest, OpenMeteoResponse, ScoredDay, VariableSelection, VariableScope } from "../lib/types";
import {
  addRecentLocation,
  getCachedForecast,
  getCustomPreset,
  getRecentLocations,
  makeForecastCacheKey,
  saveCustomPreset,
  type RecentLocation,
  setCachedForecast
} from "../lib/weatherCache";
import {
  getVariablesByScope,
  normalizeSelection,
  splitVariableId,
  validateVariableSelection,
  variableId,
  weatherCategories,
  weatherVariableRegistry
} from "../lib/weatherVariableRegistry";
// The map pulls ~10-25 OSM tiles (~20 KB each), so it loads only when the user opens it.
const LightMap = lazy(() => import("./LightMap"));

const WeatherCharts = lazy(() => import("./WeatherCharts"));

const DEFAULT_CENTER: Coordinates = { lat: 39.8283, lng: -98.5795 };

const iconByMode = {
  hiking: Mountain,
  trekking: Navigation,
  camping: Tent,
  fishing: Fish,
  custom: SlidersHorizontal
};

/** One formatter for every place a coordinate is shown, so the fields never disagree. */
function formatAxis(value: number): string {
  return String(Number(value.toFixed(5)));
}

function formatCoordinates(coordinates: Coordinates): string {
  return `${formatAxis(coordinates.lat)}, ${formatAxis(coordinates.lng)}`;
}

function formatDayLong(date: string): string {
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${date}T12:00:00`));
}

function sameCoords(a: Coordinates | null, b: Coordinates | null): boolean {
  if (!a || !b) return false;
  return Math.abs(a.lat - b.lat) < 6e-6 && Math.abs(a.lng - b.lng) < 6e-6;
}

type LocationSource = "map" | "combined" | "split" | "other";

function todayYmd(): string {
  const date = new Date();
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function addDaysYmd(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, "0")}-${`${date.getDate()}`.padStart(2, "0")}`;
}

function idsFromSelection(selection: VariableSelection): string[] {
  return (Object.keys(selection) as VariableScope[]).flatMap((scope) => selection[scope].map((key) => variableId(scope, key)));
}

function selectionFromIds(ids: string[]): VariableSelection {
  const selection: VariableSelection = { current: [], hourly: [], daily: [] };
  ids.forEach((id) => {
    const parsed = splitVariableId(id);
    if (!parsed) return;
    selection[parsed.scope].push(parsed.key);
  });
  return normalizeSelection(selection);
}

function initialState(): {
  coordinates: Coordinates | null;
  center: Coordinates;
  activity: ActivityMode;
  range: DateRangeSelection;
  shouldAutoFetch: boolean;
  highPoint: string;
} {
  if (typeof window === "undefined") {
    return { coordinates: null, center: DEFAULT_CENTER, activity: "hiking", range: { id: "next7" }, shouldAutoFetch: false, highPoint: "" };
  }
  const params = new URLSearchParams(window.location.search);
  const latParam = params.get("lat");
  const lngParam = params.get("lng");
  const lat = Number(latParam);
  const lng = Number(lngParam);
  const activity = (params.get("activity") as ActivityMode) || "hiking";
  const rangeId = (params.get("range") as DateRangeSelection["id"]) || "next7";
  const parsed = latParam !== null && lngParam !== null ? validateCoordinates(lat, lng) : { ok: false as const };
  // No location in the URL: reopen the last place the user checked, so the app shows weather immediately.
  const lastPlace = parsed.ok ? null : getRecentLocations()[0] ?? null;
  const coordinates = parsed.ok ? parsed.coordinates! : lastPlace ? { lat: lastPlace.lat, lng: lastPlace.lng } : null;
  return {
    coordinates,
    center: coordinates || DEFAULT_CENTER,
    activity: activity in activityPresets ? activity : "hiking",
    range: {
      id: dateRangeOptions.some((option) => option.id === rangeId) ? rangeId : "next7",
      startDate: params.get("start") || undefined,
      endDate: params.get("end") || undefined
    },
    shouldAutoFetch: Boolean(coordinates),
    highPoint: params.get("alt") || ""
  };
}

const WEEKEND_KEY = "trailwise:weekend";

function readWeekend(): WeekendPreset {
  try {
    const saved = window.localStorage.getItem(WEEKEND_KEY) as WeekendPreset | null;
    if (saved && weekendPresets.some((preset) => preset.id === saved)) return saved;
  } catch {
    // Storage can be blocked; fall back to the local custom.
  }
  return typeof window === "undefined" ? "sat-sun" : defaultWeekend();
}

function saveWeekend(value: WeekendPreset): void {
  try {
    window.localStorage.setItem(WEEKEND_KEY, value);
  } catch {
    // Not critical.
  }
}

function forecastDates(forecast: OpenMeteoResponse): string[] {
  const daily = ((forecast.daily?.time as string[] | undefined) || []) as string[];
  if (daily.length) return daily;
  return Array.from(new Set((((forecast.hourly?.time as string[] | undefined) || []) as string[]).map((time) => time.slice(0, 10))));
}

function statusClass(label: string): string {
  if (label === "Excellent") return "status-excellent";
  if (label === "Good") return "status-good";
  if (label === "Mixed / Use caution") return "status-mixed";
  if (label === "Risky") return "status-risky";
  return "status-avoid";
}

function formatSavedAt(value: number | null): string {
  if (!value) return "Not updated yet";
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));
}

function updateShareUrl(coordinates: Coordinates, activity: ActivityMode, range: DateRangeSelection, highPoint: number | null = null) {
  if (typeof window === "undefined") return;
  const params = new URLSearchParams({
    lat: coordinates.lat.toFixed(5),
    lng: coordinates.lng.toFixed(5),
    activity,
    range: range.id
  });
  if (range.id === "custom" && range.startDate && range.endDate) {
    params.set("start", range.startDate);
    params.set("end", range.endDate);
  }
  if (highPoint) params.set("alt", `${highPoint}`);
  window.history.replaceState(null, "", `${window.location.pathname}?${params.toString()}`);
}

function ActivityModeSelector({
  value,
  onChange
}: {
  value: ActivityMode;
  onChange: (mode: ActivityMode) => void;
}) {
  return (
    <div className="field-group">
      <div className="control-label">
        <Compass size={16} aria-hidden="true" />
        <span>Activity</span>
      </div>
      <div className="activity-grid">
        {activityModes.map((mode) => {
          const Icon = iconByMode[mode.id];
          return (
            <button
              key={mode.id}
              type="button"
              className={`activity-button ${value === mode.id ? "is-selected" : ""}`}
              onClick={() => onChange(mode.id)}
              aria-pressed={value === mode.id}
            >
              <Icon size={18} aria-hidden="true" />
              <span>{mode.shortLabel}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function DateRangeSelector({
  value,
  onChange,
  weekend,
  onWeekend
}: {
  value: DateRangeSelection;
  onChange: (range: DateRangeSelection) => void;
  weekend: WeekendPreset;
  onWeekend: (value: WeekendPreset) => void;
}) {
  return (
    <div className="field-group">
      <div className="control-label">
        <CalendarDays size={16} aria-hidden="true" />
        <span>Date range</span>
      </div>
      <div className="segmented" role="group" aria-label="Forecast date range">
        {dateRangeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            className={value.id === option.id ? "is-selected" : ""}
            onClick={() =>
              onChange({
                id: option.id,
                startDate: option.id === "custom" ? value.startDate || todayYmd() : undefined,
                endDate: option.id === "custom" ? value.endDate || addDaysYmd(6) : undefined
              })
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      {value.id === "weekend" ? (
        <div className="segmented compact weekend-picker" role="group" aria-label="Weekend days">
          {weekendPresets.map((preset) => (
            <button key={preset.id} type="button" className={weekend === preset.id ? "is-selected" : ""} aria-pressed={weekend === preset.id} onClick={() => onWeekend(preset.id)}>
              {preset.label}
            </button>
          ))}
        </div>
      ) : null}
      {value.id === "custom" ? (
        <div className="split-inputs">
          <label>
            <span>Start</span>
            <input
              type="date"
              value={value.startDate || todayYmd()}
              onInput={(event) => onChange({ ...value, startDate: event.currentTarget.value })}
            />
          </label>
          <label>
            <span>End</span>
            <input
              type="date"
              value={value.endDate || addDaysYmd(6)}
              onInput={(event) => onChange({ ...value, endDate: event.currentTarget.value })}
            />
          </label>
        </div>
      ) : null}
    </div>
  );
}

function AdvancedVariableSelector({
  activity,
  selection,
  onChange
}: {
  activity: ActivityMode;
  selection: VariableSelection;
  onChange: (selection: VariableSelection) => void;
}) {
  const [isOpen, setIsOpen] = useState(activity === "custom");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [scope, setScope] = useState<VariableScope | "all">("hourly");
  const [saved, setSaved] = useState("");
  const selectedIds = useMemo(() => new Set(idsFromSelection(selection)), [selection]);

  useEffect(() => {
    if (activity === "custom") setIsOpen(true);
  }, [activity]);

  const visibleVariables = weatherVariableRegistry.filter((variable) => {
    const matchesSearch =
      !search ||
      variable.label.toLowerCase().includes(search.toLowerCase()) ||
      variable.key.toLowerCase().includes(search.toLowerCase()) ||
      variable.description.toLowerCase().includes(search.toLowerCase());
    const matchesCategory = category === "All" || variable.category === category;
    const matchesScope = scope === "all" || variable.scope === scope;
    return matchesSearch && matchesCategory && matchesScope;
  });

  function toggle(id: string) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(selectionFromIds([...next]));
  }

  return (
    <div className="advanced">
      <button type="button" className="advanced-toggle" onClick={() => setIsOpen((current) => !current)} aria-expanded={isOpen}>
        <SlidersHorizontal size={18} aria-hidden="true" />
        <span>{activity === "custom" ? "Custom variables" : "Advanced variables"}</span>
      </button>
      {isOpen ? (
        <div className="advanced-panel">
          <div className="selector-toolbar">
            <label className="search-field">
              <Search size={16} aria-hidden="true" />
              <span className="sr-only">Search weather variables</span>
              <input value={search} onInput={(event) => setSearch(event.currentTarget.value)} placeholder="Search variables" />
            </label>
            <select value={category} onChange={(event) => setCategory(event.currentTarget.value)} aria-label="Filter by category">
              <option>All</option>
              {weatherCategories.map((item) => (
                <option key={item}>{item}</option>
              ))}
            </select>
          </div>
          <div className="segmented compact" role="group" aria-label="Variable scope">
            {(["hourly", "daily", "current", "all"] as const).map((item) => (
              <button key={item} type="button" className={scope === item ? "is-selected" : ""} onClick={() => setScope(item)}>
                {item === "all" ? "All" : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>
          <div className="variable-list">
            {visibleVariables.map((variable) => {
              const id = variableId(variable.scope, variable.key);
              const isRecommended = variable.modes.includes(activity);
              return (
                <label key={id} className="variable-row">
                  <input type="checkbox" checked={selectedIds.has(id)} onChange={() => toggle(id)} />
                  <span>
                    <strong>{variable.label}</strong>
                    <small>
                      {variable.scope} · {variable.category} · {variable.unit}
                      {isRecommended ? " · preset" : ""}
                    </small>
                  </span>
                </label>
              );
            })}
          </div>
          <div className="advanced-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                saveCustomPreset([...selectedIds]);
                setSaved("Saved locally");
              }}
            >
              Save preset
            </button>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                onChange(getActivityPreset(activity).recommended);
                setSaved("Reset to recommended");
              }}
            >
              Reset
            </button>
            <span aria-live="polite">{saved}</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Renders children only once the placeholder scrolls near the viewport, so their code and data load on demand. */
function WhenVisible({ children, placeholder }: { children: ComponentChildren; placeholder: ComponentChildren }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element || visible) return undefined;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return undefined;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "300px 0px" }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  return <div ref={ref}>{visible ? children : placeholder}</div>;
}

function formatReading(value: number | null, unit: string): string {
  return value === null ? "–" : `${Math.round(value)}${unit}`;
}

function NowCard({ now }: { now: Nowcast }) {
  const maxRain = Math.max(1, ...now.hours.map((hour) => hour.precipitation));
  return (
    <section className={`now-card ${now.wetNow ? "is-wet" : ""}`} aria-labelledby="now-heading">
      <div className="now-main">
        <p className="eyebrow">Now · {now.time} local</p>
        <h2 id="now-heading">
          {now.wetNow ? <Umbrella size={22} aria-hidden="true" /> : <CloudSun size={22} aria-hidden="true" />}
          {now.condition}, {formatReading(now.temperature, "°")}
        </h2>
        <p className="now-headline">{now.headline}</p>
        <p className="now-details">
          Feels {formatReading(now.apparent, "°")} · Wind {formatReading(now.wind, "")}–{formatReading(now.gust, " km/h")}
          {now.precipitation !== null && now.precipitation > 0 ? ` · ${now.precipitation.toFixed(1)} mm/h` : ""}
        </p>
      </div>
      <ol className="now-timeline" aria-label={`Rain over the next ${now.hours.length} hours`}>
        {now.hours.map((hour) => (
          <li key={hour.time} className={hour.wet ? "is-wet" : ""}>
            <span className="now-bar" style={{ height: `${Math.max(6, (hour.precipitation / maxRain) * 100)}%` }} aria-hidden="true" />
            <span className="now-prob">{hour.probability === null ? "" : `${Math.round(hour.probability)}%`}</span>
            <span className="now-hour">{hour.time.slice(0, 2)}</span>
            <span className="sr-only">
              {hour.time}: {hour.wet ? "wet" : "dry"}, {hour.precipitation.toFixed(1)} mm
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function shortLabel(label: string): string {
  return label === "Mixed / Use caution" ? "Mixed" : label;
}

interface HighPointView {
  elevation: number;
  day: ScoredDay | undefined;
  summary: ReturnType<typeof summarizeHighPoint>;
}

function round(value: number | null, unit: string): string {
  return value === null ? "–" : `${Math.round(value)}${unit}`;
}

function HighPointBlock({ high }: { high: HighPointView }) {
  const { day, summary } = high;
  return (
    <div className={`high-point-block ${day ? statusClass(day.label) : ""}`}>
      <h3>
        <Mountain size={16} aria-hidden="true" />
        At {high.elevation.toLocaleString("en")} m
        {day ? (
          <span className="high-point-score">
            {shortLabel(day.label)} · {day.score}
          </span>
        ) : null}
      </h3>
      <dl>
        <div>
          <dt>Coldest feels-like</dt>
          <dd>{round(summary.minFeelsLike, "°")}</dd>
        </div>
        <div>
          <dt>Strongest gust</dt>
          <dd>{round(summary.maxGust, " km/h")}</dd>
        </div>
        <div>
          <dt>Precipitation</dt>
          <dd>{summary.precipitation === null ? "–" : `${summary.precipitation} mm`}</dd>
        </div>
        {summary.snowfall ? (
          <div>
            <dt>Snow</dt>
            <dd>{summary.snowfall} cm</dd>
          </div>
        ) : null}
        {summary.minFreezingLevel !== null ? (
          <div>
            <dt>Lowest freezing level</dt>
            <dd>{Math.round(summary.minFreezingLevel).toLocaleString("en")} m</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

function ModelCheck({ url, date }: { url: string; date: string }) {
  const [state, setState] = useState<{ url: string; data: OpenMeteoResponse | null; error: boolean; loading: boolean } | null>(null);
  const current = state?.url === url ? state : null;
  const result: ModelAgreement | null = current?.data ? compareModelsForDate(current.data, date) : null;

  async function load() {
    setState({ url, data: null, error: false, loading: true });
    try {
      const response = await fetch(url);
      const data = (await response.json()) as OpenMeteoResponse;
      if (!response.ok || data.error) throw new Error(data.reason || "failed");
      setState({ url, data, error: false, loading: false });
    } catch {
      setState({ url, data: null, error: true, loading: false });
    }
  }

  if (!current) {
    return (
      <button type="button" className="link-button" onClick={() => void load()}>
        <Layers size={16} aria-hidden="true" /> Compare weather models
      </button>
    );
  }
  if (current.loading) return <p className="muted">Checking ECMWF, GFS and ICON…</p>;
  if (current.error || !result) {
    return (
      <p className="muted">
        Model comparison isn’t available right now.{" "}
        <button type="button" className="link-button" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  }
  return (
    <div className={`model-check ${result.agree ? "is-agree" : "is-disagree"}`}>
      <p className="model-summary">{result.summary}</p>
      <table>
        <thead>
          <tr>
            <th scope="col">Model</th>
            <th scope="col">Rain</th>
            <th scope="col">High</th>
            <th scope="col">Gusts</th>
          </tr>
        </thead>
        <tbody>
          {result.models.map((model) => (
            <tr key={model.model}>
              <th scope="row">{model.label}</th>
              <td>{model.precipitation === null ? "–" : `${Math.round(model.precipitation * 10) / 10} mm`}</td>
              <td>{round(model.temperatureMax, "°")}</td>
              <td>{round(model.gustMax, " km/h")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function DayDetail({
  day,
  reasoning,
  forecastElevation,
  high,
  rawUrl,
  modelUrl
}: {
  day: ScoredDay;
  reasoning: string;
  forecastElevation?: number;
  high: HighPointView | null;
  rawUrl: string | null;
  modelUrl: string | null;
}) {
  return (
    <section className={`day-detail ${statusClass(day.label)}`} aria-labelledby="day-detail-heading">
      <header className="day-detail-head">
        <div>
          <p className="eyebrow">{formatDayLong(day.date)}</p>
          <h2 id="day-detail-heading">{shortLabel(day.label)}</h2>
          <p className="day-summary">{day.summary}</p>
          {high?.day && day.score - high.day.score >= 15 ? (
            <p className="high-warning" role="note">
              <Mountain size={16} aria-hidden="true" />
              Much worse at {high.elevation.toLocaleString("en")} m: {shortLabel(high.day.label)} ({high.day.score}). Plan for the high point, not the valley.
            </p>
          ) : null}
        </div>
        <p className="score-badge" aria-label={`Score ${day.score} out of 100`}>
          <strong>{day.score}</strong>
          <span aria-hidden="true">/100</span>
        </p>
      </header>

      <div className="day-detail-grid">
        <div className="detail-block">
          <h3>
            <Clock size={16} aria-hidden="true" />
            Best time
          </h3>
          {day.bestWindow ? (
            <>
              <p className="window-time">
                {day.bestWindow.start}–{day.bestWindow.end}
              </p>
              <p className="muted">{day.bestWindow.reason}</p>
            </>
          ) : (
            <p>No dry window stands out. Keep the plan short or pick another day.</p>
          )}
          {day.avoidWindow ? (
            <p className="avoid-window">
              Avoid {day.avoidWindow.start}–{day.avoidWindow.end}
            </p>
          ) : null}
          {day.fromTime ? <p className="window-note">Judged from {day.fromTime}; earlier hours today are ignored.</p> : null}
        </div>

        <div className="detail-block">
          <h3>
            <ShieldAlert size={16} aria-hidden="true" />
            Risks
          </h3>
          {day.risks.length ? (
            <ul className="risk-list">
              {day.risks.slice(0, 6).map((risk) => (
                <li key={`${risk.id}-${risk.detail}`} className={`risk-${risk.level}`}>
                  {risk.level === "severe" ? <ShieldAlert size={16} aria-hidden="true" /> : <AlertTriangle size={16} aria-hidden="true" />}
                  <span>
                    <strong>{risk.title}</strong>
                    <span className="sr-only"> ({risk.level})</span>
                    <span className="risk-detail">{risk.detail}</span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="risk-none">
              <CheckCircle2 size={16} aria-hidden="true" /> No major weather risk stands out.
            </p>
          )}
        </div>

        <div className="detail-block">
          <h3>
            <Backpack size={16} aria-hidden="true" />
            Bring
          </h3>
          <ul className="gear-list">
            {day.gear.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      {high ? <HighPointBlock high={high} /> : null}

      <details className="why">
        <summary>Why this score</summary>
        <p>{reasoning}</p>
      </details>

      <p className="detail-footer">
        {typeof forecastElevation === "number" ? <span>Forecast for {Math.round(forecastElevation).toLocaleString("en")} m</span> : null}
        {rawUrl ? (
          <a href={rawUrl} target="_blank" rel="noopener noreferrer">
            See raw data on Open-Meteo <ExternalLink size={14} aria-hidden="true" />
          </a>
        ) : null}
      </p>
      {modelUrl ? <ModelCheck key={`${modelUrl}-${day.date}`} url={modelUrl} date={day.date} /> : null}
    </section>
  );
}

function ForecastResults({
  forecast,
  activity,
  days,
  selection,
  lastUpdated,
  stale,
  refreshing,
  highDays,
  highForecast,
  highPoint,
  rawUrl,
  modelUrl
}: {
  forecast: OpenMeteoResponse;
  activity: ActivityMode;
  days: ScoredDay[];
  selection: VariableSelection;
  lastUpdated: number | null;
  stale: boolean;
  refreshing: boolean;
  highDays: ScoredDay[];
  highForecast: OpenMeteoResponse | null;
  highPoint: number | null;
  rawUrl: string | null;
  modelUrl: string | null;
}) {
  const summary = summarizeScores(days);
  const best = summary.bestDay || days[0];
  const [pickedDate, setPickedDate] = useState<string | null>(null);
  const featured = days.find((day) => day.date === pickedDate) || best;
  const now = useMemo(() => buildNowcast(forecast), [forecast]);
  const explanations = useMemo(() => explainForecast(days, getActivityPreset(activity).label), [days, activity]);
  if (!featured) {
    return (
      <section className="results-empty">
        <p>No forecast days match the selected range.</p>
      </section>
    );
  }
  const featuredReasoning = explanations[days.indexOf(featured)]?.reasoning ?? featured.details;

  return (
    <div className={`results-content ${refreshing ? "is-refreshing" : ""}`} aria-busy={refreshing}>
      {now ? <NowCard now={now} /> : null}

      <section className="days-section" aria-labelledby="days-heading">
        <div className="section-row">
          <h2 id="days-heading">
            {getActivityPreset(activity).label} · {days.length} {days.length === 1 ? "day" : "days"}
          </h2>
          <p className={`updated-pill ${stale ? "is-stale" : ""}`} aria-live="polite">
            {refreshing ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : null}
            <span>{refreshing ? "Updating…" : `${stale ? "Offline copy ·" : "Updated"} ${formatSavedAt(lastUpdated)}`}</span>
          </p>
        </div>
        <div className="daily-score-strip" role="group" aria-label="Pick a day">
          {days.map((day) => {
            const date = new Date(`${day.date}T12:00:00`);
            const isBest = day.date === best.date && days.length > 1;
            return (
              <button
                key={day.date}
                type="button"
                className={`daily-score ${statusClass(day.label)} ${day.date === featured.date ? "is-selected" : ""}`}
                aria-pressed={day.date === featured.date}
                aria-label={`${formatDayLong(day.date)}: ${day.label}, score ${day.score}${isBest ? ", best day" : ""}`}
                onClick={() => setPickedDate(day.date)}
              >
                <span className="ds-day">{new Intl.DateTimeFormat("en", { weekday: "short" }).format(date)}</span>
                <span className="ds-date">{date.getDate()}</span>
                <strong>{day.score}</strong>
                <small>{shortLabel(day.label)}</small>
                {isBest ? <span className="ds-best">Best</span> : null}
              </button>
            );
          })}
        </div>
      </section>

      <DayDetail
        day={featured}
        reasoning={featuredReasoning}
        forecastElevation={forecast.elevation}
        high={
          highPoint && highForecast
            ? { elevation: highPoint, day: highDays.find((day) => day.date === featured.date), summary: summarizeHighPoint(highForecast, featured.date) }
            : null
        }
        rawUrl={rawUrl}
        modelUrl={modelUrl}
      />

      <WhenVisible placeholder={<div className="chart-skeleton">Charts load when you scroll here</div>}>
        <Suspense fallback={<div className="chart-skeleton">Loading charts…</div>}>
          <WeatherCharts forecast={forecast} selection={selection} />
        </Suspense>
      </WhenVisible>
    </div>
  );
}

export default function OutdoorPlanner() {
  const initial = useMemo(initialState, []);
  const resultsRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const autoFetchRef = useRef(initial.shouldAutoFetch);
  const [coordinates, setCoordinates] = useState<Coordinates | null>(initial.coordinates);
  const [center, setCenter] = useState<Coordinates>(initial.center);
  const [coordinateText, setCoordinateText] = useState(initial.coordinates ? formatCoordinates(initial.coordinates) : "");
  const [latText, setLatText] = useState(initial.coordinates ? formatAxis(initial.coordinates.lat) : "");
  const [lngText, setLngText] = useState(initial.coordinates ? formatAxis(initial.coordinates.lng) : "");
  const [coordinateError, setCoordinateError] = useState("");
  const [activity, setActivity] = useState<ActivityMode>(initial.activity);
  const [range, setRange] = useState<DateRangeSelection>(initial.range);
  const [selection, setSelection] = useState<VariableSelection>(() => {
    if (initial.activity === "custom") {
      const saved = getCustomPreset();
      if (saved.length) return selectionFromIds(saved);
    }
    return getActivityPreset(initial.activity).recommended;
  });
  const [forecast, setForecast] = useState<OpenMeteoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [stale, setStale] = useState(false);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>([]);
  const [shareStatus, setShareStatus] = useState("");
  // The map is the heaviest thing on a 3G link, so it stays closed whenever we already know a place.
  // It starts closed on server and client alike (hydration does not patch class names), then opens
  // after mount only for first-time users who have no location yet.
  const [mapOpen, setMapOpen] = useState(false);
  const [weekend, setWeekend] = useState<WeekendPreset>("sat-sun");
  const [highPointText, setHighPointText] = useState(initial.highPoint);
  const [highForecast, setHighForecast] = useState<OpenMeteoResponse | null>(null);
  const highPoint = parseElevation(highPointText);
  useEffect(() => setWeekend(readWeekend()), []);
  // Returning users see the weather first; the full form only opens by default for first-time users.
  const [formOpen, setFormOpen] = useState(false);
  useEffect(() => {
    if (!initial.coordinates) {
      setMapOpen(true);
      setFormOpen(true);
    }
  }, []);
  const [splitError, setSplitError] = useState("");

  useEffect(() => {
    setRecentLocations(getRecentLocations());
  }, []);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!coordinateText.trim()) {
        setCoordinateError("");
        return;
      }
      const parsed = parseCoordinates(coordinateText);
      setCoordinateError(parsed.ok ? "" : parsed.error || "Invalid coordinates.");
      // Live sync: a valid pair moves the pin and fills Lat/Lng without pressing a button.
      if (parsed.ok && parsed.coordinates && !sameCoords(parsed.coordinates, coordinatesRef.current)) {
        setSelectedLocation(parsed.coordinates, "combined");
      }
    }, 350);
    return () => window.clearTimeout(handle);
  }, [coordinateText]);

  useEffect(() => {
    if (activity === "custom") {
      const saved = getCustomPreset();
      setSelection(saved.length ? selectionFromIds(saved) : getActivityPreset("custom").recommended);
    } else {
      setSelection(getActivityPreset(activity).recommended);
    }
  }, [activity]);

  const coordinatesRef = useRef(coordinates);
  coordinatesRef.current = coordinates;

  /**
   * The single write path for location. Every input, the map, geolocation and recents go
   * through here, and every display is re-derived from `next`. The field the user is
   * typing in is left alone so the caret never jumps.
   */
  function setSelectedLocation(next: Coordinates, source: LocationSource = "other") {
    setCoordinates(next);
    setCenter(next);
    if (source !== "combined") setCoordinateText(formatCoordinates(next));
    if (source !== "split") {
      setLatText(formatAxis(next.lat));
      setLngText(formatAxis(next.lng));
    }
    setCoordinateError("");
    setSplitError("");
    if (source !== "combined" && source !== "split") setRecentLocations(addRecentLocation(next));
  }

  async function requestForecast(nextCoordinates = coordinates, forceRefresh = false, scroll = true) {
    if (!nextCoordinates) {
      setError("Choose a location first.");
      return;
    }
    const unsupported = validateVariableSelection(selection);
    if (unsupported.length) {
      setError(`Unsupported variables selected: ${unsupported.join(", ")}`);
      return;
    }

    const request: ForecastRequest = {
      latitude: nextCoordinates.lat,
      longitude: nextCoordinates.lng,
      activity,
      forecastDays: forecastDaysForRange(range),
      variables: withCoreVariables(selection)
    };
    const cacheKey = makeForecastCacheKey(request);
    updateShareUrl(nextCoordinates, activity, range, parseElevation(highPointText));
    setError("");
    setNotice("");
    setShareStatus("");

    if (!forceRefresh) {
      const cached = getCachedForecast(cacheKey);
      if (cached) {
        setForecast(cached.data);
        setLastUpdated(cached.savedAt);
        setStale(false);
        setNotice("Loaded a recent cached forecast.");
        if (scroll) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
      }
    }

    // Show the last saved forecast for this place right away (marked as an offline copy) while the network catches up.
    if (!forceRefresh) {
      const previous = getCachedForecast(cacheKey, true);
      if (previous) {
        setForecast(previous.data);
        setLastUpdated(previous.savedAt);
        setStale(true);
      }
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    let timedOut = false;
    const timeoutId = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 18000);
    setLoading(true);
    try {
      const data = await fetchOpenMeteoForecast(request, controller.signal);
      setCachedForecast(cacheKey, data);
      setForecast(data);
      setLastUpdated(Date.now());
      setStale(false);
      setRecentLocations(addRecentLocation(nextCoordinates));
      if (scroll) requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
    } catch (fetchError) {
      if (fetchError instanceof DOMException && fetchError.name === "AbortError" && !timedOut) return;
      const displayError =
        fetchError instanceof DOMException && fetchError.name === "AbortError" && timedOut
          ? new OpenMeteoError("Forecast request timed out. Try again, or use the last cached forecast if available.")
          : fetchError;
      const staleCache = getCachedForecast(cacheKey, true);
      if (staleCache) {
        setForecast(staleCache.data);
        setLastUpdated(staleCache.savedAt);
        setStale(true);
        setNotice("Network failed, so the last cached forecast is shown.");
      } else {
        setForecast(null);
        setError(displayError instanceof OpenMeteoError ? displayError.message : "Could not load the forecast.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      if (abortRef.current === controller) abortRef.current = null;
      setLoading(false);
    }
  }

  function requestLocation(auto = false) {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setNotice("Browser geolocation is not available here.");
      return;
    }
    setNotice(auto ? "Requesting browser location..." : "Finding your location...");
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const next = {
          lat: Math.round(position.coords.latitude * 1_000_000) / 1_000_000,
          lng: Math.round(position.coords.longitude * 1_000_000) / 1_000_000
        };
        if (auto && next.lat === 0 && next.lng === 0) {
          autoFetchRef.current = false;
          setNotice("Browser location was unavailable. Enter coordinates or tap the map.");
          return;
        }
        setSelectedLocation(next);
        setNotice("");
        if (autoFetchRef.current || auto) {
          autoFetchRef.current = false;
          void requestForecast(next);
        }
      },
      (geoError) => {
        autoFetchRef.current = false;
        setNotice(geoError.code === geoError.PERMISSION_DENIED ? "Location permission was denied. Enter coordinates or tap the map." : "Could not get browser location.");
      },
      { enableHighAccuracy: false, maximumAge: 10 * 60 * 1000, timeout: 10000 }
    );
  }

  useEffect(() => {
    if (initial.coordinates && autoFetchRef.current) {
      autoFetchRef.current = false;
      void requestForecast(initial.coordinates);
      return;
    }
    if (!initial.coordinates) requestLocation(true);
    return () => abortRef.current?.abort();
  }, []);

  function applyCoordinateText() {
    const parsed = parseCoordinates(coordinateText);
    if (!parsed.ok || !parsed.coordinates) {
      setCoordinateError(parsed.error || "Invalid coordinates.");
      return;
    }
    setSelectedLocation(parsed.coordinates);
  }

  // Live sync for the separate Lat / Lng fields.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      if (!latText.trim() || !lngText.trim()) return;
      const parsed = validateCoordinates(Number(latText.replace(",", ".")), Number(lngText.replace(",", ".")));
      if (!parsed.ok || !parsed.coordinates) {
        setSplitError(parsed.error || "Invalid coordinates.");
        return;
      }
      setSplitError("");
      if (!sameCoords(parsed.coordinates, coordinatesRef.current)) setSelectedLocation(parsed.coordinates, "split");
    }, 350);
    return () => window.clearTimeout(handle);
  }, [latText, lngText]);

  // Once a forecast is on screen, keep it in step with the inputs instead of
  // silently showing results for a location/activity the user has moved away from.
  const hasForecast = Boolean(forecast);
  const settingsKey = JSON.stringify([coordinates, activity, range, selection]);
  const lastFetchedKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hasForecast || !coordinates) return;
    if (lastFetchedKeyRef.current === null) {
      lastFetchedKeyRef.current = settingsKey;
      return;
    }
    if (lastFetchedKeyRef.current === settingsKey) return;
    const handle = window.setTimeout(() => {
      lastFetchedKeyRef.current = settingsKey;
      void requestForecast(coordinates, false, false);
    }, 600);
    return () => window.clearTimeout(handle);
  }, [settingsKey, hasForecast]);

  function commitRecent() {
    if (coordinates) setRecentLocations(addRecentLocation(coordinates));
  }

  const scoredDays = useMemo(() => {
    if (!forecast) return [];
    const dates = filterDatesForRange(forecastDates(forecast), range, new Date(), weekend);
    return scoreForecast(forecast, activity, dates);
  }, [forecast, activity, range.id, range.startDate, range.endDate, weekend]);

  // High point (summit, pass): a second forecast downscaled to that elevation, fetched only when set.
  useEffect(() => {
    if (!forecast || !coordinates || !highPoint) {
      setHighForecast(null);
      return undefined;
    }
    const request: ForecastRequest = {
      latitude: coordinates.lat,
      longitude: coordinates.lng,
      activity,
      forecastDays: forecastDaysForRange(range),
      variables: withCoreVariables(selection),
      elevation: highPoint
    };
    const key = makeForecastCacheKey(request);
    const cached = getCachedForecast(key);
    if (cached) {
      setHighForecast(cached.data);
      return undefined;
    }
    const controller = new AbortController();
    fetchOpenMeteoForecast(request, controller.signal)
      .then((data) => {
        setCachedForecast(key, data);
        setHighForecast(data);
      })
      .catch(() => {
        const stale = getCachedForecast(key, true);
        setHighForecast(stale ? stale.data : null);
      });
    return () => controller.abort();
  }, [forecast, highPoint, coordinates?.lat, coordinates?.lng]);

  const highDays = useMemo(() => {
    if (!highForecast) return [];
    return scoreForecast(highForecast, activity, scoredDays.map((day) => day.date));
  }, [highForecast, activity, scoredDays]);

  const rawUrl = useMemo(() => {
    if (!coordinates) return null;
    try {
      return buildForecastUrl({
        latitude: coordinates.lat,
        longitude: coordinates.lng,
        activity,
        forecastDays: forecastDaysForRange(range),
        variables: withCoreVariables(selection)
      });
    } catch {
      return null;
    }
  }, [coordinates?.lat, coordinates?.lng, activity, range.id, selection]);

  async function shareForecast() {
    if (!coordinates || typeof window === "undefined") return;
    updateShareUrl(coordinates, activity, range, parseElevation(highPointText));
    try {
      await navigator.clipboard.writeText(window.location.href);
      setShareStatus("Link copied");
    } catch {
      setShareStatus("Copy failed");
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="/" aria-label="Trailwise Weather Planner home">
          <span className="brand-mark">
            <Mountain size={22} aria-hidden="true" />
          </span>
          <span>Trailwise</span>
        </a>
        <div className="topbar-actions">
          <button type="button" className="icon-text-button" onClick={shareForecast} disabled={!coordinates}>
            <Share2 size={17} aria-hidden="true" />
            <span>Share</span>
          </button>
        </div>
      </header>

      {coordinates ? (
        <section className="plan-bar" aria-label="Current plan">
          <button type="button" className="plan-bar-summary" onClick={() => setFormOpen((open) => !open)} aria-expanded={formOpen} aria-controls="plan-form">
            <MapPin size={16} aria-hidden="true" />
            <span className="plan-bar-text">
              <strong>{formatCoordinates(coordinates)}</strong>
              <span>
                {getActivityPreset(activity).label} · {dateRangeOptions.find((option) => option.id === range.id)?.label ?? "Custom"}
              </span>
            </span>
            <span className="plan-bar-edit">
              <SlidersHorizontal size={16} aria-hidden="true" />
              {formOpen ? "Close" : "Edit"}
            </span>
          </button>
          <button type="button" className="icon-button" onClick={() => void requestForecast(coordinates, true, false)} disabled={loading} aria-label="Refresh forecast" title="Refresh forecast">
            <RefreshCcw size={18} className={loading ? "spin" : ""} aria-hidden="true" />
          </button>
        </section>
      ) : null}

      {formOpen ? (
      <section id="plan-form" className={`planner-hero ${mapOpen ? "" : "map-closed"}`} aria-label="Outdoor weather planner">
        {mapOpen ? (
          <div className="map-panel">
            <Suspense fallback={<div className="map-loading">Loading map…</div>}>
              <LightMap selected={coordinates} center={center} onSelect={(next) => setSelectedLocation(next, "map")} />
            </Suspense>
            <div className="map-status">
              <MapPin size={16} aria-hidden="true" />
              <span>{coordinates ? formatCoordinates(coordinates) : "Tap the map to drop a pin"}</span>
            </div>
          </div>
        ) : null}

        <aside className="control-panel" aria-label="Plan controls">
          {coordinates ? (
            <h1 className="sr-only">Trailwise weather planner</h1>
          ) : (
            <div className="panel-heading">
              <h1>Plan the right weather window</h1>
              <p>Pick a place, an activity and dates. You get a score per day, the best hours, risks and gear.</p>
            </div>
          )}

          <div className="field-group">
            <div className="control-label">
              <MapPin size={16} aria-hidden="true" />
              <span>Location</span>
            </div>
            <div className="coordinate-row">
              <label className="coordinate-input">
                <span className="sr-only">Coordinates or map link</span>
                <input
                  value={coordinateText}
                  onInput={(event) => setCoordinateText(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") applyCoordinateText();
                  }}
                  onBlur={() => {
                    if (coordinates) setCoordinateText(formatCoordinates(coordinates));
                    commitRecent();
                  }}
                  placeholder="Paste coordinates or a map link"
                  inputMode="text"
                  aria-invalid={Boolean(coordinateError)}
                  aria-describedby={coordinateError ? "coordinate-error" : undefined}
                />
              </label>
              <button type="button" className="icon-button" onClick={() => requestLocation(false)} aria-label="Use my location" title="Use my location">
                <LocateFixed size={18} aria-hidden="true" />
              </button>
              <button
                type="button"
                className={`icon-button ${mapOpen ? "is-active" : ""}`}
                onClick={() => setMapOpen((open) => !open)}
                aria-pressed={mapOpen}
                aria-label={mapOpen ? "Hide map" : "Pick on map"}
                title={mapOpen ? "Hide map" : "Pick on map (uses more data)"}
              >
                <MapPin size={18} aria-hidden="true" />
              </button>
            </div>
            {coordinateError ? <p id="coordinate-error" className="error-text">{coordinateError}</p> : null}
            <details className="more-location">
              <summary>Enter latitude and longitude separately</summary>
            <div className="split-inputs two">
              <label>
                <span>Latitude</span>
                <input
                  value={latText}
                  onInput={(event) => setLatText(event.currentTarget.value)}
                  onBlur={() => {
                    if (coordinates && !splitError) setLatText(formatAxis(coordinates.lat));
                    commitRecent();
                  }}
                  inputMode="decimal"
                  placeholder="-90 to 90"
                  aria-invalid={Boolean(splitError)}
                />
              </label>
              <label>
                <span>Longitude</span>
                <input
                  value={lngText}
                  onInput={(event) => setLngText(event.currentTarget.value)}
                  onBlur={() => {
                    if (coordinates && !splitError) setLngText(formatAxis(coordinates.lng));
                    commitRecent();
                  }}
                  inputMode="decimal"
                  placeholder="-180 to 180"
                  aria-invalid={Boolean(splitError)}
                />
              </label>
            </div>
            {splitError ? <p className="error-text">{splitError}</p> : null}
            </details>
            <label className="high-point">
              <span>
                High point <small>optional, metres</small>
              </span>
              <input
                value={highPointText}
                onInput={(event) => setHighPointText(event.currentTarget.value)}
                inputMode="numeric"
                placeholder="e.g. 3200 for a summit or pass"
                aria-describedby="high-point-help"
              />
              <small id="high-point-help" className="muted">
                Adds a second forecast for that elevation. Mountain weather can differ a lot from the valley.
              </small>
            </label>
            {recentLocations.length ? (
              <div className="recent-list" aria-label="Recent locations">
                {recentLocations
                  .filter((recent) => !(recent.lat === 0 && recent.lng === 0) && !sameCoords(recent, coordinates))
                  .map((recent) => (
                  <button key={`${recent.lat}-${recent.lng}-${recent.savedAt}`} type="button" onClick={() => setSelectedLocation(recent)}>
                    {recent.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <ActivityModeSelector value={activity} onChange={setActivity} />
          <DateRangeSelector
            value={range}
            onChange={setRange}
            weekend={weekend}
            onWeekend={(next) => {
              setWeekend(next);
              saveWeekend(next);
            }}
          />
          <AdvancedVariableSelector activity={activity} selection={selection} onChange={setSelection} />

          <div className="action-row">
            <button type="button" className="primary-button" onClick={() => {
                void requestForecast(coordinates);
                if (coordinates) setFormOpen(false);
              }} disabled={loading || !coordinates}>
              {loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <CloudSun size={18} aria-hidden="true" />}
              <span>{loading ? "Checking forecast…" : coordinates ? "Check outdoor plan" : "Pick a location first"}</span>
            </button>
            <button type="button" className="icon-button" onClick={() => void requestForecast(coordinates, true)} disabled={loading || !forecast} aria-label="Refresh forecast">
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
          </div>

          {notice ? <p className="notice-text">{notice}</p> : null}
          {shareStatus ? <p className="notice-text">{shareStatus}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </section>
      ) : null}
      {!formOpen && (notice || error || shareStatus) ? (
        <div className="status-line" role="status">
          {notice ? <p className="notice-text">{notice}</p> : null}
          {shareStatus ? <p className="notice-text">{shareStatus}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </div>
      ) : null}

      <div ref={resultsRef} className="results-anchor">
        {loading && !forecast ? (
          <section className="loading-state" aria-live="polite" aria-label="Loading forecast">
            <div className="skeleton now" />
            <div className="skeleton strip" />
            <div className="skeleton detail" />
          </section>
        ) : null}

        {forecast ? (
          <ForecastResults
            forecast={forecast}
            activity={activity}
            days={scoredDays}
            selection={selection}
            lastUpdated={lastUpdated}
            stale={stale}
            refreshing={loading}
            highDays={highDays}
            highForecast={highForecast}
            highPoint={highPoint}
            rawUrl={rawUrl}
            modelUrl={coordinates ? buildModelComparisonUrl(coordinates.lat, coordinates.lng, forecastDaysForRange(range)) : null}
          />
        ) : (
          <section className="empty-results">
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2>{coordinates ? "Location set. Check the plan." : "Start by tapping the map"}</h2>
              <p>You will get a score for each day, the best hours to go, risks and gear to bring.</p>
            </div>
            <MapPin size={22} aria-hidden="true" />
          </section>
        )}
      </div>
      <footer className="app-footer">
        Weather data by{" "}
        <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
          Open-Meteo.com
        </a>{" "}
        (CC BY 4.0) · Map © OpenStreetMap contributors
      </footer>
    </main>
  );
}
