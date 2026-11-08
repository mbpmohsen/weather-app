import { describe, expect, it } from "vitest";
import { buildChartTimeline, localStamp } from "./chartAdapters";
import type { OpenMeteoResponse } from "./types";

const time = ["2026-11-08T05:00", "2026-11-08T06:00", "2026-11-08T07:00"];
const forecast: OpenMeteoResponse = {
  latitude: 35.7,
  longitude: 51.4,
  hourly: {
    time,
    precipitation: [0, 1.2, 0],
    precipitation_probability: [10, 80, 20],
    wind_speed_10m: [10, 12, 14],
    wind_direction_10m: [180, 190, 200],
    visibility: [20000, 4000, 15000],
    cloud_cover: [10, 100, 40],
    snowfall: [0, 0, 0],
    is_day: [0, 1, 1]
  },
  hourly_units: { precipitation: "mm", precipitation_probability: "%", visibility: "m", cloud_cover: "%", wind_speed_10m: "km/h" }
};
const selection = { current: [], hourly: Object.keys(forecast.hourly!).filter((key) => key !== "time"), daily: [] };

describe("chartAdapters", () => {
  it("uses location wall-clock time, independent of the browser timezone", () => {
    expect(localStamp("2026-11-08T06:00")).toBe(Date.UTC(2026, 10, 8, 6) / 1000);
  });

  it("puts rain amount and rain chance on separate scales", () => {
    const rain = buildChartTimeline(forecast, selection).groups.find((group) => group.id === "rain")!;
    expect(rain.scales).toEqual(["mm", "%"]);
    expect(rain.series.find((item) => item.key === "precipitation")?.kind).toBe("bars");
    expect(rain.series.some((item) => item.key === "snowfall")).toBe(false);
  });

  it("drops wind direction and converts visibility to km", () => {
    const timeline = buildChartTimeline(forecast, selection);
    expect(timeline.groups.find((group) => group.id === "wind")!.series.map((item) => item.key)).toEqual(["wind_speed_10m"]);
    expect(timeline.groups.find((group) => group.id === "visibility")!.series[0].values).toEqual([20, 4, 15]);
  });

  it("marks wet and night hours for shading", () => {
    const timeline = buildChartTimeline(forecast, selection);
    expect(timeline.wet).toEqual([false, true, false]);
    expect(timeline.night).toEqual([true, false, false]);
  });
});
