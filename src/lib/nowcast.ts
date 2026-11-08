import { isWetHour, locationNow } from "./scoringEngine";
import type { OpenMeteoResponse, VariableSelection } from "./types";
import { getVariable, normalizeSelection } from "./weatherVariableRegistry";

/** Variables the "Now" view and the scoring engine always need, whatever the user selected. */
const CORE_VARIABLES: VariableSelection = {
  current: ["temperature_2m", "apparent_temperature", "precipitation", "weather_code", "wind_speed_10m", "wind_gusts_10m"],
  hourly: ["precipitation", "precipitation_probability", "weather_code", "is_day"],
  daily: []
};

export function withCoreVariables(selection: VariableSelection): VariableSelection {
  const merged: VariableSelection = {
    current: selection.current.concat(CORE_VARIABLES.current.filter((key) => getVariable("current", key))),
    hourly: selection.hourly.concat(CORE_VARIABLES.hourly.filter((key) => getVariable("hourly", key))),
    daily: selection.daily
  };
  return normalizeSelection(merged);
}

const codeLabels: Array<[number[], string]> = [
  [[0], "Clear"],
  [[1], "Mostly clear"],
  [[2], "Partly cloudy"],
  [[3], "Overcast"],
  [[45, 48], "Fog"],
  [[51, 53, 55], "Drizzle"],
  [[56, 57], "Freezing drizzle"],
  [[61], "Light rain"],
  [[63], "Rain"],
  [[65], "Heavy rain"],
  [[66, 67], "Freezing rain"],
  [[71], "Light snow"],
  [[73], "Snow"],
  [[75], "Heavy snow"],
  [[77], "Snow grains"],
  [[80], "Light showers"],
  [[81], "Showers"],
  [[82], "Violent showers"],
  [[85, 86], "Snow showers"],
  [[95], "Thunderstorm"],
  [[96, 99], "Thunderstorm with hail"]
];

export function weatherCodeLabel(code: number | null | undefined): string {
  if (code === null || code === undefined) return "Unknown";
  return codeLabels.find(([codes]) => codes.includes(code))?.[1] ?? "Unknown";
}

export interface NowcastHour {
  time: string; // "HH:MM"
  precipitation: number;
  probability: number | null;
  wet: boolean;
}

export interface Nowcast {
  time: string; // local "HH:MM" at the forecast location
  condition: string;
  temperature: number | null;
  apparent: number | null;
  wind: number | null;
  gust: number | null;
  precipitation: number | null;
  wetNow: boolean;
  headline: string;
  hours: NowcastHour[];
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** Current conditions plus the next `span` hours, with a plain-language rain headline. */
export function buildNowcast(forecast: OpenMeteoResponse, span = 12, now = locationNow(forecast)): Nowcast | null {
  const times = (forecast.hourly?.time ?? []) as string[];
  if (!now || !times.length) return null;
  const nowHour = `${now.slice(0, 13)}:00`;
  const start = times.findIndex((time) => time >= nowHour);
  if (start < 0) return null;

  const hourAt = (index: number): Record<string, unknown> => {
    const point: Record<string, unknown> = { time: times[index] };
    Object.entries(forecast.hourly ?? {}).forEach(([key, values]) => {
      if (key !== "time") point[key] = values[index] ?? null;
    });
    return point;
  };

  const window = Array.from({ length: Math.min(span, times.length - start) }, (_, offset) => hourAt(start + offset));
  const hours: NowcastHour[] = window.map((hour) => ({
    time: String(hour.time).slice(11, 16),
    precipitation: (num(hour.precipitation) ?? 0) + (num(hour.snowfall) ?? 0),
    probability: num(hour.precipitation_probability),
    wet: isWetHour(hour)
  }));

  const current = forecast.current ?? {};
  const currentCode = num(current.weather_code) ?? num(window[0]?.weather_code);
  const currentPrecip = num(current.precipitation);
  const wetNow = (currentPrecip !== null && currentPrecip >= 0.1) || isWetHour({ ...window[0], weather_code: currentCode });

  let headline: string;
  if (wetNow) {
    const dryIndex = hours.findIndex((hour, index) => index > 0 && !hour.wet);
    headline = dryIndex > 0 ? `Wet now, drying around ${hours[dryIndex].time}` : `Wet now and for the next ${hours.length} hours`;
  } else {
    const wetIndex = hours.findIndex((hour) => hour.wet);
    headline = wetIndex >= 0 ? `Dry now, rain likely from ${hours[wetIndex].time}` : `Dry for the next ${hours.length} hours`;
  }

  return {
    time: now.slice(11, 16),
    condition: weatherCodeLabel(currentCode),
    temperature: num(current.temperature_2m) ?? num(window[0]?.temperature_2m),
    apparent: num(current.apparent_temperature) ?? num(window[0]?.apparent_temperature),
    wind: num(current.wind_speed_10m) ?? num(window[0]?.wind_speed_10m),
    gust: num(current.wind_gusts_10m) ?? num(window[0]?.wind_gusts_10m),
    precipitation: currentPrecip ?? num(window[0]?.precipitation),
    wetNow,
    headline,
    hours
  };
}
