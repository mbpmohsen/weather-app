import type { ActivityMode, ActivityPreset, VariableSelection } from "./types";
import { normalizeSelection } from "./weatherVariableRegistry";

const commonCurrent = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "weather_code",
  "cloud_cover",
  "wind_speed_10m",
  "wind_gusts_10m"
];

const commonHourly = [
  "temperature_2m",
  "apparent_temperature",
  "precipitation",
  "precipitation_probability",
  "rain",
  "showers",
  "snowfall",
  "weather_code",
  "wind_speed_10m",
  "wind_gusts_10m",
  "visibility",
  "cloud_cover",
  "is_day"
];

const commonDaily = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "apparent_temperature_max",
  "apparent_temperature_min",
  "precipitation_sum",
  "rain_sum",
  "showers_sum",
  "snowfall_sum",
  "precipitation_probability_max",
  "wind_speed_10m_max",
  "wind_gusts_10m_max",
  "sunrise",
  "sunset",
  "daylight_duration",
  "uv_index_max"
];

function selection(current: string[], hourly: string[], daily: string[]): VariableSelection {
  return normalizeSelection({ current, hourly, daily });
}

export const activityPresets: Record<ActivityMode, ActivityPreset> = {
  hiking: {
    id: "hiking",
    label: "Hiking",
    shortLabel: "Hike",
    description: "Balances comfortable daylight, low rain risk, manageable wind, visibility, and UV exposure.",
    recommended: selection(commonCurrent, commonHourly.concat("uv_index"), commonDaily)
  },
  trekking: {
    id: "trekking",
    label: "Trekking",
    shortLabel: "Trek",
    description: "A stricter trail profile that adds mud, snow, freezing level, and exposed-route risk.",
    recommended: selection(
      commonCurrent.concat("snowfall"),
      commonHourly.concat("soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "freezing_level_height", "snow_depth", "uv_index"),
      commonDaily
    )
  },
  camping: {
    id: "camping",
    label: "Camping",
    shortLabel: "Camp",
    description: "Prioritizes setup weather, overnight cold, precipitation, gusts, humidity, and ground moisture.",
    recommended: selection(
      commonCurrent.concat("relative_humidity_2m"),
      commonHourly.concat("relative_humidity_2m", "soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm"),
      commonDaily.filter((key) => key !== "uv_index_max").concat("rain_sum", "showers_sum")
    )
  },
  fishing: {
    id: "fishing",
    label: "Fishing",
    shortLabel: "Fish",
    description: "Looks for calm wind, safe precipitation, useful visibility, pressure context, and early or late daylight windows.",
    recommended: selection(
      [
        "temperature_2m",
        "apparent_temperature",
        "precipitation",
        "rain",
        "showers",
        "weather_code",
        "cloud_cover",
        "pressure_msl",
        "surface_pressure",
        "wind_speed_10m",
        "wind_direction_10m",
        "wind_gusts_10m"
      ],
      [
        "temperature_2m",
        "precipitation",
        "precipitation_probability",
        "rain",
        "showers",
        "weather_code",
        "wind_speed_10m",
        "wind_gusts_10m",
        "wind_direction_10m",
        "visibility",
        "cloud_cover",
        "pressure_msl",
        "surface_pressure",
        "is_day"
      ],
      [
        "weather_code",
        "temperature_2m_max",
        "temperature_2m_min",
        "precipitation_sum",
        "rain_sum",
        "showers_sum",
        "precipitation_probability_max",
        "wind_speed_10m_max",
        "wind_gusts_10m_max",
        "wind_direction_10m_dominant",
        "sunrise",
        "sunset"
      ]
    )
  },
  custom: {
    id: "custom",
    label: "Custom",
    shortLabel: "Custom",
    description: "Choose any supported Open-Meteo variables and build a lightweight custom forecast view.",
    recommended: selection(
      ["temperature_2m", "precipitation", "weather_code", "wind_speed_10m"],
      ["temperature_2m", "precipitation_probability", "precipitation", "wind_speed_10m", "wind_gusts_10m", "visibility", "cloud_cover", "is_day"],
      ["weather_code", "temperature_2m_max", "temperature_2m_min", "precipitation_sum", "precipitation_probability_max", "wind_gusts_10m_max", "sunrise", "sunset"]
    )
  }
};

export const activityModes = Object.values(activityPresets);

export function getActivityPreset(mode: ActivityMode): ActivityPreset {
  return activityPresets[mode];
}
