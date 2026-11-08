import { describe, expect, it } from "vitest";
import { buildNowcast, weatherCodeLabel, withCoreVariables } from "./nowcast";
import type { OpenMeteoResponse } from "./types";

function forecast(wet: (hour: number) => boolean, current: Record<string, number | string>): OpenMeteoResponse {
  const time = Array.from({ length: 24 }, (_, h) => `2026-11-08T${`${h}`.padStart(2, "0")}:00`);
  return {
    latitude: 35.7,
    longitude: 51.4,
    current,
    hourly: {
      time,
      precipitation: time.map((_, h) => (wet(h) ? 1.1 : 0)),
      precipitation_probability: time.map((_, h) => (wet(h) ? 90 : 10)),
      weather_code: time.map((_, h) => (wet(h) ? 63 : 2)),
      temperature_2m: time.map(() => 9)
    }
  };
}

describe("nowcast", () => {
  it("reports rain now and when it dries up", () => {
    const now = buildNowcast(forecast((h) => h < 15, { time: "2026-11-08T12:30", weather_code: 63, precipitation: 1.4, temperature_2m: 8 }));
    expect(now?.wetNow).toBe(true);
    expect(now?.condition).toBe("Rain");
    expect(now?.headline).toBe("Wet now, drying around 15:00");
    expect(now?.hours[0].time).toBe("12:00");
  });

  it("reports when rain starts on a dry afternoon", () => {
    const now = buildNowcast(forecast((h) => h >= 18, { time: "2026-11-08T14:00", weather_code: 2, precipitation: 0 }));
    expect(now?.wetNow).toBe(false);
    expect(now?.headline).toBe("Dry now, rain likely from 18:00");
  });

  it("trusts the current weather code even if the hourly forecast was dry", () => {
    const now = buildNowcast(forecast(() => false, { time: "2026-11-08T10:15", weather_code: 61, precipitation: 0.3 }));
    expect(now?.wetNow).toBe(true);
  });

  it("labels codes and always requests the variables the Now view needs", () => {
    expect(weatherCodeLabel(95)).toBe("Thunderstorm");
    const selection = withCoreVariables({ current: [], hourly: ["temperature_2m"], daily: [] });
    expect(selection.current).toContain("weather_code");
    expect(selection.hourly).toEqual(expect.arrayContaining(["precipitation_probability", "temperature_2m"]));
  });
});
