import type { ActivityMode, VariableScope, VariableSelection, WeatherCategory, WeatherVariable } from "./types";

const allModes: ActivityMode[] = ["hiking", "trekking", "camping", "fishing", "custom"];
const trailModes: ActivityMode[] = ["hiking", "trekking", "custom"];
const campModes: ActivityMode[] = ["camping", "custom"];
const fishModes: ActivityMode[] = ["fishing", "custom"];
const allOutdoorModes: ActivityMode[] = ["hiking", "trekking", "camping", "fishing", "custom"];

const hourly = (
  key: string,
  label: string,
  unit: string,
  category: WeatherCategory,
  description: string,
  modes: ActivityMode[] = allOutdoorModes
): WeatherVariable => ({ key, label, unit, category, description, scope: "hourly", modes });

const daily = (
  key: string,
  label: string,
  unit: string,
  category: WeatherCategory,
  description: string,
  modes: ActivityMode[] = allOutdoorModes
): WeatherVariable => ({ key, label, unit, category, description, scope: "daily", modes });

const current = (
  key: string,
  label: string,
  unit: string,
  category: WeatherCategory,
  description: string,
  modes: ActivityMode[] = allOutdoorModes
): WeatherVariable => ({ key, label, unit, category, description, scope: "current", modes });

export const weatherVariableRegistry: WeatherVariable[] = [
  current("temperature_2m", "Current temperature", "C", "Temperature", "Air temperature at 2 meters.", allModes),
  current("apparent_temperature", "Feels like now", "C", "Temperature", "Perceived current temperature.", allModes),
  current("relative_humidity_2m", "Current humidity", "%", "Temperature", "Humidity near the ground.", ["camping", "custom"]),
  current("precipitation", "Current precipitation", "mm", "Rain & Snow", "Total current precipitation.", allModes),
  current("rain", "Current rain", "mm", "Rain & Snow", "Current rain amount.", allModes),
  current("showers", "Current showers", "mm", "Rain & Snow", "Current shower amount.", allModes),
  current("snowfall", "Current snowfall", "cm", "Rain & Snow", "Current snowfall amount.", ["hiking", "trekking", "camping", "custom"]),
  current("weather_code", "Current condition", "code", "Safety", "WMO weather condition code.", allModes),
  current("cloud_cover", "Current cloud cover", "%", "Clouds & Visibility", "Cloud cover right now.", allModes),
  current("pressure_msl", "Current sea-level pressure", "hPa", "Pressure", "Pressure reduced to sea level.", fishModes),
  current("surface_pressure", "Current surface pressure", "hPa", "Pressure", "Air pressure at the selected location.", fishModes),
  current("wind_speed_10m", "Current wind speed", "km/h", "Wind", "Wind speed at 10 meters.", allModes),
  current("wind_direction_10m", "Current wind direction", "deg", "Wind", "Wind direction at 10 meters.", fishModes),
  current("wind_gusts_10m", "Current wind gusts", "km/h", "Wind", "Short wind gusts at 10 meters.", allModes),

  hourly("temperature_2m", "Temperature", "C", "Temperature", "Hourly air temperature.", allModes),
  hourly("apparent_temperature", "Feels like", "C", "Temperature", "Hourly apparent temperature.", allModes),
  hourly("relative_humidity_2m", "Humidity", "%", "Temperature", "Hourly relative humidity.", campModes),
  hourly("precipitation", "Precipitation", "mm", "Rain & Snow", "Hourly total precipitation.", allModes),
  hourly("precipitation_probability", "Precipitation chance", "%", "Rain & Snow", "Chance of precipitation per hour.", allModes),
  hourly("rain", "Rain", "mm", "Rain & Snow", "Hourly rain amount.", allModes),
  hourly("showers", "Showers", "mm", "Rain & Snow", "Hourly shower amount.", allModes),
  hourly("snowfall", "Snowfall", "cm", "Rain & Snow", "Hourly snowfall amount.", ["hiking", "trekking", "camping", "custom"]),
  hourly("snow_depth", "Snow depth", "m", "Rain & Snow", "Estimated snow depth on the ground.", ["trekking", "custom"]),
  hourly("weather_code", "Weather condition", "code", "Safety", "Hourly WMO weather code.", allModes),
  hourly("wind_speed_10m", "Wind speed", "km/h", "Wind", "Hourly wind speed at 10 meters.", allModes),
  hourly("wind_gusts_10m", "Wind gusts", "km/h", "Wind", "Hourly wind gusts at 10 meters.", allModes),
  hourly("wind_direction_10m", "Wind direction", "deg", "Wind", "Hourly wind direction at 10 meters.", fishModes),
  hourly("visibility", "Visibility", "m", "Clouds & Visibility", "Horizontal visibility.", ["hiking", "trekking", "fishing", "custom"]),
  hourly("cloud_cover", "Cloud cover", "%", "Clouds & Visibility", "Hourly total cloud cover.", allModes),
  hourly("soil_moisture_0_to_1cm", "Surface soil moisture", "m3/m3", "Soil & Trail", "Soil moisture in the top centimeter.", ["trekking", "camping", "custom"]),
  hourly("soil_moisture_1_to_3cm", "Shallow soil moisture", "m3/m3", "Soil & Trail", "Soil moisture from 1 to 3 cm depth.", ["trekking", "camping", "custom"]),
  hourly("freezing_level_height", "Freezing level", "m", "Safety", "Height where air temperature reaches freezing.", ["trekking", "custom"]),
  hourly("pressure_msl", "Sea-level pressure", "hPa", "Pressure", "Hourly pressure reduced to sea level.", fishModes),
  hourly("surface_pressure", "Surface pressure", "hPa", "Pressure", "Hourly surface pressure.", fishModes),
  hourly("uv_index", "UV index", "index", "Sun & UV", "Hourly UV index.", ["hiking", "trekking", "custom"]),
  hourly("is_day", "Daylight flag", "0/1", "Sun & UV", "Whether the hour is daylight.", allOutdoorModes),

  daily("weather_code", "Daily condition", "code", "Safety", "Most relevant daily WMO weather code.", allModes),
  daily("temperature_2m_max", "Max temperature", "C", "Temperature", "Daily maximum air temperature.", allModes),
  daily("temperature_2m_min", "Min temperature", "C", "Temperature", "Daily minimum air temperature.", allModes),
  daily("apparent_temperature_max", "Max feels like", "C", "Temperature", "Daily maximum apparent temperature.", allModes),
  daily("apparent_temperature_min", "Min feels like", "C", "Temperature", "Daily minimum apparent temperature.", allModes),
  daily("precipitation_sum", "Precipitation total", "mm", "Rain & Snow", "Total daily precipitation.", allModes),
  daily("rain_sum", "Rain total", "mm", "Rain & Snow", "Total daily rain.", allModes),
  daily("showers_sum", "Showers total", "mm", "Rain & Snow", "Total daily showers.", allModes),
  daily("snowfall_sum", "Snowfall total", "cm", "Rain & Snow", "Total daily snowfall.", ["hiking", "trekking", "camping", "custom"]),
  daily("precipitation_probability_max", "Max precipitation chance", "%", "Rain & Snow", "Maximum daily chance of precipitation.", allModes),
  daily("wind_speed_10m_max", "Max wind speed", "km/h", "Wind", "Daily maximum wind speed.", allModes),
  daily("wind_gusts_10m_max", "Max wind gusts", "km/h", "Wind", "Daily maximum wind gusts.", allModes),
  daily("wind_direction_10m_dominant", "Dominant wind direction", "deg", "Wind", "Dominant wind direction for the day.", fishModes),
  daily("sunrise", "Sunrise", "time", "Sun & UV", "Local sunrise time.", allModes),
  daily("sunset", "Sunset", "time", "Sun & UV", "Local sunset time.", allModes),
  daily("daylight_duration", "Daylight duration", "s", "Sun & UV", "Total daylight in seconds.", trailModes),
  daily("uv_index_max", "Max UV index", "index", "Sun & UV", "Maximum daily UV index.", ["hiking", "trekking", "custom"]),
  daily("uv_index_clear_sky_max", "Clear-sky UV index", "index", "Sun & UV", "Maximum UV index with clear sky assumptions.", ["hiking", "trekking", "custom"])
];

export const weatherCategories: WeatherCategory[] = [
  "Temperature",
  "Wind",
  "Rain & Snow",
  "Clouds & Visibility",
  "Soil & Trail",
  "Sun & UV",
  "Pressure",
  "Safety"
];

export function variableId(scope: VariableScope, key: string): string {
  return `${scope}:${key}`;
}

export function splitVariableId(id: string): { scope: VariableScope; key: string } | null {
  const [scope, ...rest] = id.split(":");
  if (!["current", "hourly", "daily"].includes(scope) || rest.length === 0) return null;
  return { scope: scope as VariableScope, key: rest.join(":") };
}

export function getVariablesByScope(scope: VariableScope): WeatherVariable[] {
  return weatherVariableRegistry.filter((variable) => variable.scope === scope);
}

export function getVariable(scope: VariableScope, key: string): WeatherVariable | undefined {
  return weatherVariableRegistry.find((variable) => variable.scope === scope && variable.key === key);
}

export function normalizeSelection(selection: VariableSelection): VariableSelection {
  return {
    current: [...new Set(selection.current)].sort(),
    hourly: [...new Set(selection.hourly)].sort(),
    daily: [...new Set(selection.daily)].sort()
  };
}

export function validateVariableSelection(selection: VariableSelection): string[] {
  const unsupported: string[] = [];
  (Object.keys(selection) as VariableScope[]).forEach((scope) => {
    selection[scope].forEach((key) => {
      if (!getVariable(scope, key)) unsupported.push(variableId(scope, key));
    });
  });
  return unsupported;
}

export function getVariablesForMode(mode: ActivityMode): WeatherVariable[] {
  return weatherVariableRegistry.filter((variable) => variable.modes.includes(mode));
}
