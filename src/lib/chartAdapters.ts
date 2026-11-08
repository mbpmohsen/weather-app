import { isWetHour } from "./scoringEngine";
import type { OpenMeteoResponse, VariableSelection } from "./types";
import { getVariable } from "./weatherVariableRegistry";

export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  /** Series that share a unit share a y scale; a group shows at most two scales (left and right axis). */
  scale: string;
  kind: "line" | "bars";
  values: Array<number | null>;
  interpretation: (value: number | null) => string;
}

export interface ChartGroup {
  id: string;
  title: string;
  times: string[];
  series: ChartSeries[];
  /** Units of the left and (optional) right axis. */
  scales: string[];
}

export interface ChartTimeline {
  times: string[];
  /** Seconds since epoch, treating the location's local wall-clock time as UTC so the browser's timezone never shifts labels. */
  stamps: number[];
  wet: boolean[];
  night: boolean[];
  groups: ChartGroup[];
}

interface SeriesDefinition {
  key: string;
  kind?: "line" | "bars";
  /** Optional display conversion, e.g. metres to kilometres. */
  convert?: { unit: string; factor: number };
  /** Only plot when at least one value is above zero (e.g. snowfall). */
  onlyIfNonZero?: boolean;
}

const groupDefinitions: Array<{ id: string; title: string; series: SeriesDefinition[] }> = [
  { id: "temperature", title: "Temperature", series: [{ key: "temperature_2m" }, { key: "apparent_temperature" }] },
  {
    id: "rain",
    title: "Rain and snow",
    series: [
      { key: "precipitation", kind: "bars" },
      { key: "precipitation_probability" },
      { key: "snowfall", kind: "bars", onlyIfNonZero: true }
    ]
  },
  // Wind direction (degrees) is left out: it cannot share an axis with speed.
  { id: "wind", title: "Wind", series: [{ key: "wind_speed_10m" }, { key: "wind_gusts_10m" }] },
  {
    id: "visibility",
    title: "Visibility and clouds",
    series: [{ key: "visibility", convert: { unit: "km", factor: 0.001 } }, { key: "cloud_cover" }]
  },
  {
    id: "soil",
    title: "Ground and snow line",
    series: [{ key: "soil_moisture_0_to_1cm" }, { key: "soil_moisture_1_to_3cm" }, { key: "freezing_level_height" }, { key: "snow_depth", onlyIfNonZero: true }]
  },
  { id: "pressure", title: "Pressure", series: [{ key: "pressure_msl" }, { key: "surface_pressure" }] },
  { id: "uv", title: "UV index", series: [{ key: "uv_index" }] }
];

function interpretationFor(key: string, value: number | null): string {
  if (value === null) return "No value";
  if (key.includes("precipitation_probability")) {
    if (value >= 70) return "Rain risk elevated";
    if (value >= 40) return "Watch the sky";
    return "Low rain chance";
  }
  if (key.includes("precipitation") || key === "rain" || key === "showers") {
    if (value >= 3) return "Wet period";
    if (value > 0) return "Light precipitation";
    return "Dry";
  }
  if (key.includes("snow")) return value > 0 ? "Winter conditions possible" : "No snow signal";
  if (key.includes("gust")) {
    if (value >= 45) return "Strong gusts";
    if (value >= 30) return "Breezy";
    return "Manageable gusts";
  }
  if (key.includes("wind_speed")) {
    if (value >= 30) return "Wind may matter";
    return "Calmer wind";
  }
  if (key === "visibility") {
    if (value < 1000) return "Very low visibility";
    if (value < 5000) return "Limited visibility";
    return "Good visibility";
  }
  if (key.includes("uv_index")) {
    if (value >= 8) return "High UV";
    if (value >= 5) return "Moderate UV";
    return "Lower UV";
  }
  if (key.includes("soil_moisture")) {
    if (value >= 0.42) return "Muddy ground likely";
    if (value >= 0.33) return "Damp ground";
    return "Drier ground";
  }
  return "Forecast value";
}

function valuesFor(forecast: OpenMeteoResponse, key: string): Array<number | null> {
  const raw = forecast.hourly?.[key] || [];
  return raw.map((value) => (typeof value === "number" && Number.isFinite(value) ? value : null));
}

export function localStamp(time: string): number {
  return Date.parse(`${time.slice(0, 16)}:00Z`) / 1000;
}

export function buildChartGroups(forecast: OpenMeteoResponse, selection: VariableSelection): ChartGroup[] {
  const times = ((forecast.hourly?.time as string[] | undefined) || []) as string[];
  if (!times.length) return [];
  return groupDefinitions
    .map((group) => {
      const series: ChartSeries[] = [];
      group.series.forEach((definition) => {
        const { key } = definition;
        if (!selection.hourly.includes(key) || !forecast.hourly?.[key]) return;
        const meta = getVariable("hourly", key);
        let values = valuesFor(forecast, key);
        if (definition.onlyIfNonZero && !values.some((value) => (value ?? 0) > 0)) return;
        let unit = forecast.hourly_units?.[key] || meta?.unit || "";
        if (definition.convert) {
          const { factor } = definition.convert;
          values = values.map((value) => (value === null ? null : Math.round(value * factor * 10) / 10));
          unit = definition.convert.unit;
        }
        series.push({
          key,
          label: meta?.label || key,
          unit,
          scale: unit,
          kind: definition.kind ?? "line",
          values,
          interpretation: (value: number | null) => interpretationFor(key, definition.convert ? (value === null ? null : value / definition.convert.factor) : value)
        });
      });
      // Keep the first two units (left/right axis); a third unit would need a third axis, so it is dropped.
      const scales = [...new Set(series.map((item) => item.scale))].slice(0, 2);
      return { id: group.id, title: group.title, times, series: series.filter((item) => scales.includes(item.scale)), scales };
    })
    .filter((group) => group.series.length > 0);
}

export function buildChartTimeline(forecast: OpenMeteoResponse, selection: VariableSelection): ChartTimeline {
  const times = ((forecast.hourly?.time as string[] | undefined) || []) as string[];
  const hourly = forecast.hourly ?? {};
  const wet = times.map((_, index) => {
    const hour: Record<string, unknown> = {};
    Object.entries(hourly).forEach(([key, values]) => {
      if (key !== "time") hour[key] = values[index];
    });
    return isWetHour(hour);
  });
  const isDay = hourly.is_day;
  const night = times.map((_, index) => (isDay ? isDay[index] === 0 : false));
  return { times, stamps: times.map(localStamp), wet, night, groups: buildChartGroups(forecast, selection) };
}
