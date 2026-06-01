import type { OpenMeteoResponse, VariableSelection } from "./types";
import { getVariable } from "./weatherVariableRegistry";

export interface ChartSeries {
  key: string;
  label: string;
  unit: string;
  values: Array<number | null>;
  interpretation: (value: number | null) => string;
}

export interface ChartGroup {
  id: string;
  title: string;
  times: string[];
  series: ChartSeries[];
}

const groupDefinitions: Array<{ id: string; title: string; keys: string[] }> = [
  { id: "temperature", title: "Temperature", keys: ["temperature_2m", "apparent_temperature"] },
  { id: "rain", title: "Rain, showers, and snow", keys: ["precipitation", "precipitation_probability", "rain", "showers", "snowfall"] },
  { id: "wind", title: "Wind", keys: ["wind_speed_10m", "wind_gusts_10m", "wind_direction_10m"] },
  { id: "visibility", title: "Visibility and cloud cover", keys: ["visibility", "cloud_cover"] },
  { id: "soil", title: "Soil and trail", keys: ["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "snow_depth", "freezing_level_height"] },
  { id: "pressure", title: "Pressure", keys: ["pressure_msl", "surface_pressure"] },
  { id: "uv", title: "Sun and UV", keys: ["uv_index"] }
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

export function buildChartGroups(forecast: OpenMeteoResponse, selection: VariableSelection): ChartGroup[] {
  const times = ((forecast.hourly?.time as string[] | undefined) || []) as string[];
  if (!times.length) return [];
  return groupDefinitions
    .map((group) => {
      const selectedKeys = group.keys.filter((key) => selection.hourly.includes(key) && forecast.hourly?.[key]);
      const series = selectedKeys.map((key) => {
        const meta = getVariable("hourly", key);
        const unit = forecast.hourly_units?.[key] || meta?.unit || "";
        return {
          key,
          label: meta?.label || key,
          unit,
          values: valuesFor(forecast, key),
          interpretation: (value: number | null) => interpretationFor(key, value)
        };
      });
      return { id: group.id, title: group.title, times, series };
    })
    .filter((group) => group.series.length > 0);
}
