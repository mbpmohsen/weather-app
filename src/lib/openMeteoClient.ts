import type { ForecastRequest, OpenMeteoResponse } from "./types";
import { normalizeSelection, validateVariableSelection } from "./weatherVariableRegistry";

export const OPEN_METEO_FORECAST_ENDPOINT = "https://api.open-meteo.com/v1/forecast";

export class OpenMeteoError extends Error {
  constructor(
    message: string,
    public readonly reason?: string,
    public readonly status?: number
  ) {
    super(message);
    this.name = "OpenMeteoError";
  }
}

function formatCoordinate(value: number): string {
  return `${Math.round(value * 1_000_000) / 1_000_000}`;
}

export function buildForecastUrl(request: ForecastRequest): string {
  const variables = normalizeSelection(request.variables);
  const unsupported = validateVariableSelection(variables);
  if (unsupported.length) {
    throw new OpenMeteoError(`Unsupported weather variables: ${unsupported.join(", ")}`, unsupported.join(", "));
  }

  const forecastDays = Math.min(16, Math.max(1, Math.round(request.forecastDays || 7)));
  const params = new URLSearchParams({
    latitude: formatCoordinate(request.latitude),
    longitude: formatCoordinate(request.longitude),
    timezone: "auto",
    forecast_days: `${forecastDays}`
  });

  if (typeof request.elevation === "number" && Number.isFinite(request.elevation)) {
    params.set("elevation", `${Math.round(request.elevation)}`);
  }
  if (variables.current.length) params.set("current", variables.current.join(","));
  if (variables.hourly.length) params.set("hourly", variables.hourly.join(","));
  if (variables.daily.length) params.set("daily", variables.daily.join(","));

  return `${OPEN_METEO_FORECAST_ENDPOINT}?${params.toString()}`;
}

export async function fetchOpenMeteoForecast(request: ForecastRequest, signal?: AbortSignal): Promise<OpenMeteoResponse> {
  const url = buildForecastUrl(request);
  let response: Response;

  try {
    response = await fetch(url, { signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new OpenMeteoError("Could not reach Open-Meteo. Check your connection and try again.");
  }

  let data: OpenMeteoResponse;
  try {
    data = (await response.json()) as OpenMeteoResponse;
  } catch {
    throw new OpenMeteoError("Open-Meteo returned an unreadable response.", undefined, response.status);
  }

  if (!response.ok || data.error) {
    throw new OpenMeteoError(data.reason || "Open-Meteo could not return this forecast.", data.reason, response.status);
  }

  if (!data.hourly && !data.daily && !data.current) {
    throw new OpenMeteoError("Open-Meteo returned an empty forecast.");
  }

  return data;
}
