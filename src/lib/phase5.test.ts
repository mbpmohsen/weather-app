import { describe, expect, it } from "vitest";
import { defaultWeekend, filterDatesForRange } from "./dateRanges";
import { buildModelComparisonUrl, compareModelsForDate } from "./modelComparison";
import { buildForecastUrl } from "./openMeteoClient";
import type { OpenMeteoResponse } from "./types";

describe("weekend presets", () => {
  // 2026-11-12 is a Thursday.
  const dates = ["2026-11-11", "2026-11-12", "2026-11-13", "2026-11-14", "2026-11-15"];
  it("uses Thu–Fri in Iran", () => {
    expect(defaultWeekend("Asia/Tehran")).toBe("thu-fri");
    expect(filterDatesForRange(dates, { id: "weekend" }, new Date(), "thu-fri")).toEqual(["2026-11-12", "2026-11-13"]);
  });
  it("uses Sat–Sun elsewhere", () => {
    expect(defaultWeekend("Europe/Amsterdam")).toBe("sat-sun");
    expect(filterDatesForRange(dates, { id: "weekend" }, new Date(), "sat-sun")).toEqual(["2026-11-14", "2026-11-15"]);
  });
});

describe("elevation", () => {
  it("passes a high-point elevation to Open-Meteo", () => {
    const url = buildForecastUrl({
      latitude: 35.95,
      longitude: 52.11,
      activity: "trekking",
      forecastDays: 3,
      elevation: 5609.4,
      variables: { current: [], hourly: ["temperature_2m"], daily: [] }
    });
    expect(new URL(url).searchParams.get("elevation")).toBe("5609");
  });
});

describe("model comparison", () => {
  const response = (rain: number[], tmax: number[]): OpenMeteoResponse => ({
    latitude: 35.7,
    longitude: 51.4,
    daily: {
      time: ["2026-11-09"],
      precipitation_sum_ecmwf_ifs025: [rain[0]],
      precipitation_sum_gfs_seamless: [rain[1]],
      precipitation_sum_icon_seamless: [rain[2]],
      temperature_2m_max_ecmwf_ifs025: [tmax[0]],
      temperature_2m_max_gfs_seamless: [tmax[1]],
      temperature_2m_max_icon_seamless: [tmax[2]]
    }
  });

  it("requests three models with a small daily payload", () => {
    const url = new URL(buildModelComparisonUrl(35.7, 51.4, 7));
    expect(url.searchParams.get("models")).toBe("ecmwf_ifs025,gfs_seamless,icon_seamless");
    expect(url.searchParams.get("hourly")).toBeNull();
  });

  it("flags disagreement when only some models expect rain", () => {
    const result = compareModelsForDate(response([0, 6, 0.2], [12, 13, 12]), "2026-11-09");
    expect(result?.agree).toBe(false);
    expect(result?.summary).toContain("1 of 3 models expect rain");
  });

  it("reports agreement on a dry day", () => {
    const result = compareModelsForDate(response([0, 0.1, 0], [12, 13, 14]), "2026-11-09");
    expect(result?.agree).toBe(true);
    expect(result?.summary).toContain("dry day");
  });

  it("returns null when the API shape is not what we expect", () => {
    expect(compareModelsForDate({ latitude: 0, longitude: 0, daily: { time: ["2026-11-09"], precipitation_sum: [1] } }, "2026-11-09")).toBeNull();
  });
});

describe("high point", async () => {
  const { parseElevation, summarizeHighPoint } = await import("./highPoint");
  it("parses route elevations and rejects nonsense", () => {
    expect(parseElevation("3,200 m")).toBe(3200);
    expect(parseElevation("")).toBeNull();
    expect(parseElevation("12")).toBeNull();
  });
  it("summarizes the conditions at the high point for one day", () => {
    const summary = summarizeHighPoint(
      {
        latitude: 0,
        longitude: 0,
        hourly: {
          time: ["2026-11-09T10:00", "2026-11-09T11:00", "2026-11-10T10:00"],
          apparent_temperature: [-4, -7, 3],
          wind_gusts_10m: [40, 62, 10],
          snowfall: [0.4, 0.6, 0]
        }
      },
      "2026-11-09"
    );
    expect(summary).toMatchObject({ minFeelsLike: -7, maxGust: 62, snowfall: 1 });
  });
});
