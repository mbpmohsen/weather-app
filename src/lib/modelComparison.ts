import { OPEN_METEO_FORECAST_ENDPOINT } from "./openMeteoClient";
import type { OpenMeteoResponse } from "./types";

/** Three independent global models. Disagreement between them is the honest signal of forecast uncertainty. */
export const comparisonModels = [
  { id: "ecmwf_ifs025", label: "ECMWF" },
  { id: "gfs_seamless", label: "GFS" },
  { id: "icon_seamless", label: "ICON" }
] as const;

const DAILY = ["precipitation_sum", "temperature_2m_max", "wind_gusts_10m_max"] as const;

export function buildModelComparisonUrl(latitude: number, longitude: number, forecastDays: number, elevation?: number): string {
  const params = new URLSearchParams({
    latitude: `${Math.round(latitude * 1e4) / 1e4}`,
    longitude: `${Math.round(longitude * 1e4) / 1e4}`,
    timezone: "auto",
    forecast_days: `${Math.min(16, Math.max(1, forecastDays))}`,
    daily: DAILY.join(","),
    models: comparisonModels.map((model) => model.id).join(",")
  });
  if (typeof elevation === "number" && Number.isFinite(elevation)) params.set("elevation", `${Math.round(elevation)}`);
  return `${OPEN_METEO_FORECAST_ENDPOINT}?${params.toString()}`;
}

export interface ModelDay {
  model: string;
  label: string;
  precipitation: number | null;
  temperatureMax: number | null;
  gustMax: number | null;
}

export interface ModelAgreement {
  models: ModelDay[];
  agree: boolean;
  summary: string;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Open-Meteo names per-model daily values `<variable>_<model>` when several models are requested. */
export function compareModelsForDate(response: OpenMeteoResponse, date: string): ModelAgreement | null {
  const daily = response.daily ?? {};
  const index = ((daily.time ?? []) as string[]).indexOf(date);
  if (index < 0) return null;
  const models: ModelDay[] = comparisonModels
    .map((model) => ({
      model: model.id,
      label: model.label,
      precipitation: num(daily[`precipitation_sum_${model.id}`]?.[index]),
      temperatureMax: num(daily[`temperature_2m_max_${model.id}`]?.[index]),
      gustMax: num(daily[`wind_gusts_10m_max_${model.id}`]?.[index])
    }))
    .filter((model) => model.precipitation !== null || model.temperatureMax !== null);
  if (models.length < 2) return null;

  const rain = models.map((model) => model.precipitation).filter((value): value is number => value !== null);
  const temps = models.map((model) => model.temperatureMax).filter((value): value is number => value !== null);
  const wetVotes = rain.filter((value) => value >= 1).length;
  const rainSplit = wetVotes > 0 && wetVotes < rain.length;
  const rainSpread = rain.length ? Math.max(...rain) - Math.min(...rain) : 0;
  const tempSpread = temps.length ? Math.max(...temps) - Math.min(...temps) : 0;

  const issues: string[] = [];
  if (rainSplit) issues.push(`${wetVotes} of ${rain.length} models expect rain`);
  else if (rainSpread >= 5) issues.push(`rain totals range ${Math.round(Math.min(...rain))}–${Math.round(Math.max(...rain))} mm`);
  if (tempSpread >= 4) issues.push(`highs differ by ${Math.round(tempSpread)}°`);

  const agree = issues.length === 0;
  const summary = agree
    ? `Models agree${wetVotes === rain.length && rain.length ? " on rain" : wetVotes === 0 ? " on a dry day" : ""}; the forecast is more reliable.`
    : `Models disagree: ${issues.join(", ")}. Treat the score with caution.`;
  return { models, agree, summary };
}
