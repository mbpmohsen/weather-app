import type { Coordinates, ForecastRequest, OpenMeteoResponse } from "./types";
import { normalizeSelection } from "./weatherVariableRegistry";

const FORECAST_PREFIX = "trailwise:forecast:";
const RECENT_LOCATIONS_KEY = "trailwise:recent-locations";
const CUSTOM_PRESET_KEY = "trailwise:custom-preset";
const FORECAST_TTL_MS = 30 * 60 * 1000;
const MAX_RECENT_LOCATIONS = 6;

export interface CachedForecast {
  data: OpenMeteoResponse;
  savedAt: number;
  key: string;
}

export interface RecentLocation extends Coordinates {
  label: string;
  savedAt: number;
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined";
}

export function makeForecastCacheKey(request: ForecastRequest): string {
  const variables = normalizeSelection(request.variables);
  return [
    request.latitude.toFixed(4),
    request.longitude.toFixed(4),
    request.activity,
    request.forecastDays,
    request.elevation ?? "",
    variables.current.join("."),
    variables.hourly.join("."),
    variables.daily.join(".")
  ].join("|");
}

export function getCachedForecast(key: string, allowStale = false): CachedForecast | null {
  if (!canUseStorage()) return null;
  try {
    const raw = window.localStorage.getItem(`${FORECAST_PREFIX}${key}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedForecast;
    const isFresh = Date.now() - parsed.savedAt < FORECAST_TTL_MS;
    return isFresh || allowStale ? parsed : null;
  } catch {
    return null;
  }
}

export function setCachedForecast(key: string, data: OpenMeteoResponse): void {
  if (!canUseStorage()) return;
  const payload: CachedForecast = { key, data, savedAt: Date.now() };
  try {
    window.localStorage.setItem(`${FORECAST_PREFIX}${key}`, JSON.stringify(payload));
  } catch {
    // Storage can be unavailable in private browsing or full quota situations.
  }
}

export function getRecentLocations(): RecentLocation[] {
  if (!canUseStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(RECENT_LOCATIONS_KEY) || "[]") as RecentLocation[];
  } catch {
    return [];
  }
}

export function addRecentLocation(location: Coordinates): RecentLocation[] {
  if (!canUseStorage()) return [];
  const label = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
  const next: RecentLocation[] = [
    { ...location, label, savedAt: Date.now() },
    ...getRecentLocations().filter((recent) => Math.abs(recent.lat - location.lat) > 0.0001 || Math.abs(recent.lng - location.lng) > 0.0001)
  ].slice(0, MAX_RECENT_LOCATIONS);
  try {
    window.localStorage.setItem(RECENT_LOCATIONS_KEY, JSON.stringify(next));
  } catch {
    // Ignore storage failures; recent locations are an enhancement.
  }
  return next;
}

export function getCustomPreset(): string[] {
  if (!canUseStorage()) return [];
  try {
    return JSON.parse(window.localStorage.getItem(CUSTOM_PRESET_KEY) || "[]") as string[];
  } catch {
    return [];
  }
}

export function saveCustomPreset(variableIds: string[]): void {
  if (!canUseStorage()) return;
  try {
    window.localStorage.setItem(CUSTOM_PRESET_KEY, JSON.stringify([...new Set(variableIds)].sort()));
  } catch {
    // Ignore storage failures.
  }
}
