import type { OpenMeteoResponse } from "./types";

export interface HighPointDay {
  minFeelsLike: number | null;
  maxGust: number | null;
  precipitation: number | null;
  snowfall: number | null;
  minFreezingLevel: number | null;
}

/** Accepts realistic route elevations only; anything else is treated as "not set". */
export function parseElevation(text: string): number | null {
  const value = Number(text.replace(/[^\d.]/g, ""));
  return text.trim() && Number.isFinite(value) && value >= 100 && value <= 8900 ? Math.round(value) : null;
}

function values(forecast: OpenMeteoResponse, key: string, date: string): number[] {
  const times = (forecast.hourly?.time ?? []) as string[];
  const series = forecast.hourly?.[key] ?? [];
  return times
    .map((time, index) => (time.startsWith(date) ? series[index] : null))
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));
}

const min = (list: number[]) => (list.length ? Math.min(...list) : null);
const max = (list: number[]) => (list.length ? Math.max(...list) : null);
const sum = (list: number[]) => (list.length ? Math.round(list.reduce((total, value) => total + value, 0) * 10) / 10 : null);

export function summarizeHighPoint(forecast: OpenMeteoResponse, date: string): HighPointDay {
  return {
    minFeelsLike: min(values(forecast, "apparent_temperature", date)) ?? min(values(forecast, "temperature_2m", date)),
    maxGust: max(values(forecast, "wind_gusts_10m", date)),
    precipitation: sum(values(forecast, "precipitation", date)),
    snowfall: sum(values(forecast, "snowfall", date)),
    minFreezingLevel: min(values(forecast, "freezing_level_height", date))
  };
}
