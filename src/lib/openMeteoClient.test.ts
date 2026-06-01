import { afterEach, describe, expect, it, vi } from "vitest";
import { activityPresets } from "./activityPresets";
import { buildForecastUrl, fetchOpenMeteoForecast, OpenMeteoError } from "./openMeteoClient";

describe("openMeteoClient", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds a forecast URL with timezone, days, coordinates, and variables", () => {
    const url = new URL(
      buildForecastUrl({
        latitude: 35.6892,
        longitude: 51.389,
        activity: "hiking",
        forecastDays: 7,
        variables: activityPresets.hiking.recommended
      })
    );

    expect(url.origin + url.pathname).toBe("https://api.open-meteo.com/v1/forecast");
    expect(url.searchParams.get("latitude")).toBe("35.6892");
    expect(url.searchParams.get("longitude")).toBe("51.389");
    expect(url.searchParams.get("timezone")).toBe("auto");
    expect(url.searchParams.get("forecast_days")).toBe("7");
    expect(url.searchParams.get("hourly")).toContain("temperature_2m");
    expect(url.searchParams.get("daily")).toContain("sunrise");
  });

  it("rejects unsupported variables before fetching", () => {
    expect(() =>
      buildForecastUrl({
        latitude: 0,
        longitude: 0,
        activity: "custom",
        forecastDays: 7,
        variables: { current: [], hourly: ["not_real"], daily: [] }
      })
    ).toThrow(OpenMeteoError);
  });

  it("surfaces Open-Meteo JSON errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ error: true, reason: "Bad variable" }), { status: 400 }))
    );

    await expect(
      fetchOpenMeteoForecast({
        latitude: 35,
        longitude: 51,
        activity: "hiking",
        forecastDays: 1,
        variables: activityPresets.hiking.recommended
      })
    ).rejects.toMatchObject({ message: "Bad variable", reason: "Bad variable", status: 400 });
  });
});
