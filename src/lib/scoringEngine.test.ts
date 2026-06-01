import { describe, expect, it } from "vitest";
import type { OpenMeteoResponse } from "./types";
import { findBestTimeWindow, scoreForecast, type HourPoint } from "./scoringEngine";

function hours(date: string, overrides: Partial<Record<string, number>> = {}): Record<string, Array<number | string>> {
  const time = Array.from({ length: 24 }, (_, hour) => `${date}T${`${hour}`.padStart(2, "0")}:00`);
  const isDay = time.map((_, hour) => (hour >= 6 && hour <= 19 ? 1 : 0));
  return {
    time,
    temperature_2m: time.map(() => overrides.temperature_2m ?? 18),
    apparent_temperature: time.map(() => overrides.apparent_temperature ?? 18),
    precipitation: time.map(() => overrides.precipitation ?? 0),
    precipitation_probability: time.map(() => overrides.precipitation_probability ?? 5),
    rain: time.map(() => overrides.rain ?? 0),
    showers: time.map(() => overrides.showers ?? 0),
    snowfall: time.map(() => overrides.snowfall ?? 0),
    weather_code: time.map(() => overrides.weather_code ?? 1),
    wind_speed_10m: time.map(() => overrides.wind_speed_10m ?? 8),
    wind_gusts_10m: time.map(() => overrides.wind_gusts_10m ?? 14),
    visibility: time.map(() => overrides.visibility ?? 16000),
    cloud_cover: time.map(() => overrides.cloud_cover ?? 30),
    uv_index: time.map(() => overrides.uv_index ?? 4),
    is_day: isDay
  };
}

function forecast(date: string, overrides: Partial<Record<string, number>> = {}): OpenMeteoResponse {
  return {
    latitude: 35,
    longitude: 51,
    timezone: "auto",
    hourly: hours(date, overrides),
    daily: {
      time: [date],
      weather_code: [overrides.weather_code ?? 1],
      temperature_2m_max: [overrides.temperature_2m ?? 22],
      temperature_2m_min: [overrides.temperature_2m ?? 12],
      apparent_temperature_max: [overrides.apparent_temperature ?? 22],
      apparent_temperature_min: [overrides.apparent_temperature ?? 12],
      precipitation_sum: [overrides.precipitation_sum ?? overrides.precipitation ?? 0],
      rain_sum: [overrides.rain ?? 0],
      showers_sum: [overrides.showers ?? 0],
      snowfall_sum: [overrides.snowfall ?? 0],
      precipitation_probability_max: [overrides.precipitation_probability ?? 5],
      wind_speed_10m_max: [overrides.wind_speed_10m ?? 8],
      wind_gusts_10m_max: [overrides.wind_gusts_10m ?? 14],
      sunrise: [`${date}T06:00`],
      sunset: [`${date}T19:00`],
      daylight_duration: [46800],
      uv_index_max: [overrides.uv_index ?? 4]
    }
  };
}

describe("scoringEngine", () => {
  it("scores a calm dry hiking day highly and finds a daylight window", () => {
    const [day] = scoreForecast(forecast("2026-06-06"), "hiking");
    expect(day.score).toBeGreaterThanOrEqual(80);
    expect(day.bestWindow).not.toBeNull();
    expect(day.positiveFactors).toContain("Low rain signal");
  });

  it("reduces score for thunderstorm, heavy rain, and strong gusts", () => {
    const [day] = scoreForecast(
      forecast("2026-06-06", {
        weather_code: 95,
        precipitation_probability: 95,
        precipitation_sum: 18,
        wind_gusts_10m: 58,
        visibility: 800
      }),
      "trekking"
    );
    expect(day.score).toBeLessThan(30);
    expect(day.label).toBe("Avoid");
    expect(day.severeRisks.join(" ")).toContain("Thunderstorm");
  });

  it("cares about overnight cold for camping", () => {
    const cold = forecast("2026-06-06", { apparent_temperature: -2, temperature_2m: -1 });
    const [day] = scoreForecast(cold, "camping");
    expect(day.risks.some((risk) => risk.id === "cold-night")).toBe(true);
    expect(day.gear).toContain("Warmer sleeping bag");
  });

  it("calculates a best continuous activity window", () => {
    const points: HourPoint[] = Array.from({ length: 8 }, (_, index) => ({
      time: `2026-06-06T${`${8 + index}`.padStart(2, "0")}:00`,
      apparent_temperature: 17,
      precipitation_probability: index >= 5 ? 80 : 5,
      precipitation: 0,
      wind_gusts_10m: index >= 5 ? 40 : 10,
      visibility: 12000,
      weather_code: 1,
      is_day: 1
    }));
    const window = findBestTimeWindow(points, "hiking");
    expect(window?.start).toBe("08:00");
    expect(window?.score).toBeGreaterThan(70);
  });
});
