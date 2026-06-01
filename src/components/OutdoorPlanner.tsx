import {
  AlertTriangle,
  Backpack,
  CalendarDays,
  CheckCircle2,
  Clock,
  CloudSun,
  Compass,
  Copy,
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
  Tent
} from "lucide-preact";
import { lazy, Suspense } from "preact/compat";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { activityModes, activityPresets, getActivityPreset } from "../lib/activityPresets";
import { parseCoordinates, validateCoordinates } from "../lib/coordinateParser";
import { dateRangeOptions, filterDatesForRange, forecastDaysForRange } from "../lib/dateRanges";
import { explainForecast } from "../lib/explanationEngine";
import { fetchOpenMeteoForecast, OpenMeteoError } from "../lib/openMeteoClient";
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
import LightMap from "./LightMap";

const WeatherCharts = lazy(() => import("./WeatherCharts"));

const DEFAULT_CENTER: Coordinates = { lat: 39.8283, lng: -98.5795 };

const iconByMode = {
  hiking: Mountain,
  trekking: Navigation,
  camping: Tent,
  fishing: Fish,
  custom: SlidersHorizontal
};

function formatCoordinates(coordinates: Coordinates): string {
  return `${coordinates.lat.toFixed(5)}, ${coordinates.lng.toFixed(5)}`;
}

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
} {
  if (typeof window === "undefined") {
    return { coordinates: null, center: DEFAULT_CENTER, activity: "hiking", range: { id: "next7" }, shouldAutoFetch: false };
  }
  const params = new URLSearchParams(window.location.search);
  const latParam = params.get("lat");
  const lngParam = params.get("lng");
  const lat = Number(latParam);
  const lng = Number(lngParam);
  const activity = (params.get("activity") as ActivityMode) || "hiking";
  const rangeId = (params.get("range") as DateRangeSelection["id"]) || "next7";
  const parsed = latParam !== null && lngParam !== null ? validateCoordinates(lat, lng) : { ok: false as const };
  const coordinates = parsed.ok ? parsed.coordinates! : null;
  return {
    coordinates,
    center: coordinates || DEFAULT_CENTER,
    activity: activity in activityPresets ? activity : "hiking",
    range: {
      id: dateRangeOptions.some((option) => option.id === rangeId) ? rangeId : "next7",
      startDate: params.get("start") || undefined,
      endDate: params.get("end") || undefined
    },
    shouldAutoFetch: Boolean(coordinates)
  };
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

function updateShareUrl(coordinates: Coordinates, activity: ActivityMode, range: DateRangeSelection) {
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
      <p className="hint">{getActivityPreset(value).description}</p>
    </div>
  );
}

function DateRangeSelector({
  value,
  onChange
}: {
  value: DateRangeSelection;
  onChange: (range: DateRangeSelection) => void;
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

function OutdoorScoreCard({ day }: { day: ScoredDay }) {
  return (
    <section className={`score-card ${statusClass(day.label)}`} aria-labelledby="score-heading">
      <div>
        <p className="eyebrow">Outdoor score</p>
        <h2 id="score-heading">{day.label}</h2>
        <p>{day.summary}</p>
      </div>
      <div className="score-number" aria-label={`Score ${day.score} out of 100`}>
        <span>{day.score}</span>
        <small>/100</small>
      </div>
    </section>
  );
}

function BestTimeWindowCard({ day }: { day: ScoredDay }) {
  return (
    <section className="result-card">
      <div className="card-title">
        <Clock size={18} aria-hidden="true" />
        <h3>Best time window</h3>
      </div>
      {day.bestWindow ? (
        <>
          <p className="window-time">
            {day.bestWindow.start} - {day.bestWindow.end}
          </p>
          <p>{day.bestWindow.reason}</p>
        </>
      ) : (
        <p>No clean weather window stands out. Keep the plan shorter or choose another day.</p>
      )}
      {day.avoidWindow ? <p className="avoid-window">Avoid if possible: {day.avoidWindow.start} - {day.avoidWindow.end}.</p> : null}
    </section>
  );
}

function RiskCards({ day }: { day: ScoredDay }) {
  if (!day.risks.length) {
    return (
      <section className="result-card">
        <div className="card-title">
          <CheckCircle2 size={18} aria-hidden="true" />
          <h3>Main risks</h3>
        </div>
        <p>No major weather risk stands out for the selected day.</p>
      </section>
    );
  }
  return (
    <section className="risk-grid" aria-label="Risk cards">
      {day.risks.slice(0, 6).map((risk) => (
        <article key={`${risk.id}-${risk.detail}`} className={`risk-card risk-${risk.level}`}>
          <div className="card-title">
            {risk.level === "severe" ? <ShieldAlert size={18} aria-hidden="true" /> : <AlertTriangle size={18} aria-hidden="true" />}
            <h3>{risk.title}</h3>
          </div>
          <p>{risk.detail}</p>
        </article>
      ))}
    </section>
  );
}

function GearSuggestions({ day }: { day: ScoredDay }) {
  return (
    <section className="result-card">
      <div className="card-title">
        <Backpack size={18} aria-hidden="true" />
        <h3>Gear suggestions</h3>
      </div>
      <div className="gear-list">
        {day.gear.map((item) => (
          <span key={item}>{item}</span>
        ))}
      </div>
    </section>
  );
}

function DailyExplanationList({ days, activity }: { days: ScoredDay[]; activity: ActivityMode }) {
  const explanations = explainForecast(days, getActivityPreset(activity).label);
  return (
    <section className="daily-section" aria-labelledby="daily-heading">
      <div className="section-heading">
        <p className="eyebrow">Day by day</p>
        <h2 id="daily-heading">Daily explanation</h2>
      </div>
      <div className="daily-list">
        {days.map((day, index) => {
          const explanation = explanations[index];
          return (
            <article key={day.date} className="daily-item">
              <div>
                <h3>
                  {new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${day.date}T12:00:00`))}
                </h3>
                <p>{explanation.summarySentence}</p>
              </div>
              <dl>
                <div>
                  <dt>Best window</dt>
                  <dd>{explanation.bestTimeWindow}</dd>
                </div>
                <div>
                  <dt>Main risks</dt>
                  <dd>{explanation.mainRisks}</dd>
                </div>
                <div>
                  <dt>Gear</dt>
                  <dd>{explanation.gearSuggestions}</dd>
                </div>
                <div>
                  <dt>Reasoning</dt>
                  <dd>{explanation.reasoning}</dd>
                </div>
              </dl>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ForecastResults({
  forecast,
  activity,
  days,
  selection,
  lastUpdated,
  stale
}: {
  forecast: OpenMeteoResponse;
  activity: ActivityMode;
  days: ScoredDay[];
  selection: VariableSelection;
  lastUpdated: number | null;
  stale: boolean;
}) {
  const summary = summarizeScores(days);
  const featured = summary.bestDay || days[0];
  if (!featured) {
    return (
      <section className="results-empty">
        <p>No forecast days match the selected range.</p>
      </section>
    );
  }

  return (
    <div className="results-content">
      <section className="activity-summary">
        <div>
          <p className="eyebrow">{getActivityPreset(activity).label} plan</p>
          <h2>
            {getActivityPreset(activity).label} near selected location looks {featured.label}
          </h2>
          <p>
            Best day: {new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(new Date(`${featured.date}T12:00:00`))}
            {featured.bestWindow ? `, ${featured.bestWindow.start}-${featured.bestWindow.end}.` : "."}
          </p>
        </div>
        <div className="updated-pill">
          <CloudSun size={16} aria-hidden="true" />
          <span>{stale ? "Cached forecast" : "Last updated"} {formatSavedAt(lastUpdated)}</span>
        </div>
      </section>

      <div className="score-layout">
        <OutdoorScoreCard day={featured} />
        <BestTimeWindowCard day={featured} />
        <GearSuggestions day={featured} />
      </div>

      <RiskCards day={featured} />

      <section className="daily-score-strip" aria-label="Scores by day">
        {days.map((day) => (
          <article key={day.date} className={`daily-score ${statusClass(day.label)}`}>
            <span>{new Intl.DateTimeFormat("en", { weekday: "short" }).format(new Date(`${day.date}T12:00:00`))}</span>
            <strong>{day.score}</strong>
            <small>{day.label}</small>
          </article>
        ))}
      </section>

      <section className="weather-summary" aria-labelledby="summary-heading">
        <div className="section-heading">
          <p className="eyebrow">Week scan</p>
          <h2 id="summary-heading">Weather summary</h2>
        </div>
        <dl>
          <div>
            <dt>Best day</dt>
            <dd>{summary.bestDay ? `${summary.bestDay.date} (${summary.bestDay.label})` : "Not available"}</dd>
          </div>
          <div>
            <dt>Worst day</dt>
            <dd>{summary.worstDay ? `${summary.worstDay.date} (${summary.worstDay.label})` : "Not available"}</dd>
          </div>
          <div>
            <dt>Best activity window</dt>
            <dd>{summary.bestWindow ? `${summary.bestWindow.start}-${summary.bestWindow.end}` : "No strong window found"}</dd>
          </div>
          <div>
            <dt>Main risk</dt>
            <dd>{summary.mainRisk}</dd>
          </div>
        </dl>
      </section>

      <DailyExplanationList days={days} activity={activity} />

      <Suspense fallback={<div className="chart-skeleton">Loading charts...</div>}>
        <WeatherCharts forecast={forecast} selection={selection} />
      </Suspense>
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
  const [latText, setLatText] = useState(initial.coordinates ? `${initial.coordinates.lat}` : "");
  const [lngText, setLngText] = useState(initial.coordinates ? `${initial.coordinates.lng}` : "");
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
    }, 250);
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

  function setSelectedLocation(next: Coordinates) {
    setCoordinates(next);
    setCenter(next);
    setCoordinateText(formatCoordinates(next));
    setLatText(`${next.lat}`);
    setLngText(`${next.lng}`);
    setCoordinateError("");
    setRecentLocations(addRecentLocation(next));
  }

  async function requestForecast(nextCoordinates = coordinates, forceRefresh = false) {
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
      variables: selection
    };
    const cacheKey = makeForecastCacheKey(request);
    updateShareUrl(nextCoordinates, activity, range);
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
        requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
        return;
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
      requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
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
        setNotice("Location selected.");
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

  function applySeparateCoordinates() {
    const parsed = validateCoordinates(Number(latText), Number(lngText));
    if (!parsed.ok || !parsed.coordinates) {
      setCoordinateError(parsed.error || "Invalid coordinates.");
      return;
    }
    setSelectedLocation(parsed.coordinates);
  }

  const scoredDays = useMemo(() => {
    if (!forecast) return [];
    const dates = filterDatesForRange(forecastDates(forecast), range);
    return scoreForecast(forecast, activity, dates);
  }, [forecast, activity, range.id, range.startDate, range.endDate]);

  async function shareForecast() {
    if (!coordinates || typeof window === "undefined") return;
    updateShareUrl(coordinates, activity, range);
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

      <section className="planner-hero" aria-label="Outdoor weather planner">
        <div className="map-panel">
          <LightMap selected={coordinates} center={center} onSelect={setSelectedLocation} />
          <div className="map-status">
            <MapPin size={16} aria-hidden="true" />
            <span>{coordinates ? formatCoordinates(coordinates) : "Tap the map, use location, or enter coordinates"}</span>
          </div>
        </div>

        <aside className="control-panel" aria-label="Plan controls">
          <div className="panel-heading">
            <p className="eyebrow">Outdoor decision assistant</p>
            <h1>Plan the right weather window</h1>
            <p>Check suitability, timing, risks, and gear from Open-Meteo forecast data.</p>
          </div>

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
                  placeholder="35.6892, 51.3890"
                  inputMode="text"
                  aria-invalid={Boolean(coordinateError)}
                />
              </label>
              <button type="button" className="icon-button" onClick={applyCoordinateText} aria-label="Use entered coordinates">
                <MapPin size={18} aria-hidden="true" />
              </button>
              <button type="button" className="icon-button" onClick={() => requestLocation(false)} aria-label="Use browser location">
                <LocateFixed size={18} aria-hidden="true" />
              </button>
            </div>
            <div className="split-inputs">
              <label>
                <span>Lat</span>
                <input value={latText} onInput={(event) => setLatText(event.currentTarget.value)} inputMode="decimal" />
              </label>
              <label>
                <span>Lng</span>
                <input value={lngText} onInput={(event) => setLngText(event.currentTarget.value)} inputMode="decimal" />
              </label>
              <button type="button" className="secondary-button compact-button" onClick={applySeparateCoordinates}>
                Use
              </button>
            </div>
            {coordinateError ? <p className="error-text">{coordinateError}</p> : null}
            {recentLocations.length ? (
              <div className="recent-list" aria-label="Recent locations">
                {recentLocations.map((recent) => (
                  <button key={`${recent.lat}-${recent.lng}-${recent.savedAt}`} type="button" onClick={() => setSelectedLocation(recent)}>
                    {recent.label}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          <ActivityModeSelector value={activity} onChange={setActivity} />
          <DateRangeSelector value={range} onChange={setRange} />
          <AdvancedVariableSelector activity={activity} selection={selection} onChange={setSelection} />

          <div className="action-row">
            <button type="button" className="primary-button" onClick={() => void requestForecast(coordinates)} disabled={loading}>
              {loading ? <LoaderCircle className="spin" size={18} aria-hidden="true" /> : <CloudSun size={18} aria-hidden="true" />}
              <span>{loading ? "Checking forecast" : "Check outdoor plan"}</span>
            </button>
            <button type="button" className="icon-button" onClick={() => void requestForecast(coordinates, true)} disabled={loading || !forecast} aria-label="Refresh forecast">
              <RefreshCcw size={18} aria-hidden="true" />
            </button>
          </div>

          <div className="panel-meta">
            <span>Provider: Open-Meteo Forecast API</span>
            <span>{selection.hourly.length + selection.daily.length + selection.current.length} variables selected</span>
          </div>
          {notice ? <p className="notice-text">{notice}</p> : null}
          {shareStatus ? <p className="notice-text">{shareStatus}</p> : null}
          {error ? <p className="error-text">{error}</p> : null}
        </aside>
      </section>

      <div ref={resultsRef} className="results-anchor">
        {loading && !forecast ? (
          <section className="loading-state" aria-live="polite">
            <div className="skeleton large" />
            <div className="skeleton-grid">
              <div className="skeleton" />
              <div className="skeleton" />
              <div className="skeleton" />
            </div>
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
          />
        ) : (
          <section className="empty-results">
            <div>
              <p className="eyebrow">Ready when you are</p>
              <h2>Choose a location and check the plan</h2>
              <p>The first forecast will show scores, time windows, risks, gear, explanations, and charts.</p>
            </div>
            <Copy size={22} aria-hidden="true" />
          </section>
        )}
      </div>
    </main>
  );
}
