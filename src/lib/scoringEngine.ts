import type { ActivityMode, ForecastSummary, OpenMeteoResponse, RiskCard, RiskLevel, ScoredDay, ScoreLabel, TimeWindow } from "./types";

export type HourPoint = Record<string, number | string | null> & { time: string };

const activityLabels: Record<ActivityMode, string> = {
  hiking: "hiking",
  trekking: "trekking",
  camping: "camping",
  fishing: "fishing",
  custom: "outdoor planning"
};

const baseGear: Record<ActivityMode, string[]> = {
  hiking: ["Water", "trail snacks", "offline map"],
  trekking: ["Water", "offline map", "first-aid kit"],
  camping: ["Headlamp", "warm layer", "water storage"],
  fishing: ["Wind layer", "sun protection", "dry bag"],
  custom: ["Water", "weather-aware layers", "charged phone"]
};

const thunderCodes = new Set([95, 96, 99]);
const snowCodes = new Set([71, 73, 75, 77, 85, 86]);
const fogCodes = new Set([45, 48]);
const rainCodes = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82]);

function clamp(value: number, min = 0, max = 100): number {
  return Math.min(max, Math.max(min, value));
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function datePart(time: string): string {
  return time.slice(0, 10);
}

function hourPart(time: string): number {
  return Number(time.slice(11, 13));
}

function formatTime(time: string): string {
  return time.slice(11, 16);
}

function addHourLabel(time: string, hours: number): string {
  const hour = hourPart(time) + hours;
  const normalized = ((hour % 24) + 24) % 24;
  return `${`${normalized}`.padStart(2, "0")}:00`;
}

function weekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long", month: "short", day: "numeric" }).format(new Date(year, month - 1, day));
}

export function scoreLabel(score: number): ScoreLabel {
  if (score >= 85) return "Excellent";
  if (score >= 70) return "Good";
  if (score >= 50) return "Mixed / Use caution";
  if (score >= 30) return "Risky";
  return "Avoid";
}

function dailyNumber(forecast: OpenMeteoResponse, key: string, dayIndex: number): number | null {
  return asNumber(forecast.daily?.[key]?.[dayIndex]);
}

function hourlyForDate(forecast: OpenMeteoResponse, date: string): HourPoint[] {
  const times = (forecast.hourly?.time || []) as string[];
  return times
    .map((time, index) => {
      const point: HourPoint = { time };
      Object.entries(forecast.hourly || {}).forEach(([key, values]) => {
        if (key !== "time") point[key] = values[index] ?? null;
      });
      return point;
    })
    .filter((point) => datePart(point.time) === date);
}

function maxHourly(hours: HourPoint[], key: string): number | null {
  const values = hours.map((hour) => asNumber(hour[key])).filter((value): value is number => value !== null);
  return values.length ? Math.max(...values) : null;
}

function minHourly(hours: HourPoint[], key: string): number | null {
  const values = hours.map((hour) => asNumber(hour[key])).filter((value): value is number => value !== null);
  return values.length ? Math.min(...values) : null;
}

function avgHourly(hours: HourPoint[], key: string): number | null {
  const values = hours.map((hour) => asNumber(hour[key])).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function sumHourly(hours: HourPoint[], key: string): number | null {
  const values = hours.map((hour) => asNumber(hour[key])).filter((value): value is number => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

function containsCode(hours: HourPoint[], codes: Set<number>): boolean {
  return hours.some((hour) => {
    const code = asNumber(hour.weather_code);
    return code !== null && codes.has(code);
  });
}

function addGear(gear: Set<string>, items: string[] | undefined): void {
  items?.forEach((item) => gear.add(item));
}

function pushRisk(
  risks: RiskCard[],
  warnings: string[],
  severeRisks: string[],
  gear: Set<string>,
  risk: RiskCard,
  penalty: number,
  scoreRef: { value: number }
): void {
  risks.push(risk);
  addGear(gear, risk.gear);
  if (risk.level === "severe") severeRisks.push(risk.detail);
  else warnings.push(risk.detail);
  scoreRef.value -= penalty;
}

function windThresholds(activity: ActivityMode): { warn: number; severe: number } {
  if (activity === "fishing") return { warn: 24, severe: 38 };
  if (activity === "trekking") return { warn: 34, severe: 48 };
  if (activity === "camping") return { warn: 32, severe: 46 };
  return { warn: 38, severe: 55 };
}

function tempComfort(activity: ActivityMode): { min: number; max: number } {
  if (activity === "camping") return { min: 4, max: 29 };
  if (activity === "fishing") return { min: 5, max: 31 };
  if (activity === "trekking") return { min: 3, max: 27 };
  return { min: 5, max: 30 };
}

function hourSuitability(hour: HourPoint, activity: ActivityMode): number {
  let score = 100;
  const apparent = asNumber(hour.apparent_temperature) ?? asNumber(hour.temperature_2m);
  const precipitation = asNumber(hour.precipitation) ?? 0;
  const rain = asNumber(hour.rain) ?? 0;
  const showers = asNumber(hour.showers) ?? 0;
  const snow = asNumber(hour.snowfall) ?? 0;
  const precipitationProbability = asNumber(hour.precipitation_probability) ?? 0;
  const gust = asNumber(hour.wind_gusts_10m) ?? asNumber(hour.wind_speed_10m) ?? 0;
  const visibility = asNumber(hour.visibility);
  const weatherCode = asNumber(hour.weather_code);
  const isDay = asNumber(hour.is_day);
  const hourOfDay = hourPart(hour.time);
  const wind = windThresholds(activity);
  const comfort = tempComfort(activity);

  if (activity !== "camping" && isDay === 0) score -= 45;
  if (activity === "camping" && (hourOfDay < 13 || hourOfDay > 20)) score -= 15;
  if (weatherCode !== null && thunderCodes.has(weatherCode)) score -= 80;
  if (weatherCode !== null && fogCodes.has(weatherCode)) score -= 18;
  if (weatherCode !== null && snowCodes.has(weatherCode)) score -= activity === "trekking" ? 35 : 28;
  if (precipitationProbability >= 80) score -= 26;
  else if (precipitationProbability >= 55) score -= 16;
  else if (precipitationProbability >= 35) score -= 8;
  if (precipitation + rain + showers >= 4) score -= 28;
  else if (precipitation + rain + showers >= 1) score -= 16;
  else if (precipitation + rain + showers > 0.1) score -= 8;
  if (snow > 0) score -= activity === "trekking" ? 28 : 22;
  if (gust >= wind.severe) score -= 35;
  else if (gust >= wind.warn) score -= 18;
  if (visibility !== null && visibility < 1000) score -= 35;
  else if (visibility !== null && visibility < 5000) score -= 14;
  if (apparent !== null && apparent < comfort.min - 8) score -= 25;
  else if (apparent !== null && apparent < comfort.min) score -= 12;
  if (apparent !== null && apparent > comfort.max + 6) score -= 24;
  else if (apparent !== null && apparent > comfort.max) score -= 12;

  if (activity === "fishing") {
    if (gust <= 14) score += 8;
    if (hourOfDay <= 9 || hourOfDay >= 17) score += 8;
  }

  return clamp(score);
}

export function findBestTimeWindow(hours: HourPoint[], activity: ActivityMode): TimeWindow | null {
  if (!hours.length) return null;
  const config =
    activity === "fishing"
      ? { min: 2, max: 4, required: 52 }
      : activity === "camping"
        ? { min: 2, max: 3, required: 48 }
        : { min: 3, max: 6, required: 55 };

  let best: TimeWindow | null = null;
  for (let start = 0; start < hours.length; start += 1) {
    for (let length = config.min; length <= config.max; length += 1) {
      const slice = hours.slice(start, start + length);
      if (slice.length !== length) continue;
      const average = slice.reduce((sum, hour) => sum + hourSuitability(hour, activity), 0) / slice.length;
      const daylightShare = slice.filter((hour) => asNumber(hour.is_day) !== 0).length / slice.length;
      const setupBonus =
        activity === "camping" && hourPart(slice[0].time) >= 14 && hourPart(slice[0].time) <= 18 ? 8 : 0;
      const fishingBonus =
        activity === "fishing" && (hourPart(slice[0].time) <= 9 || hourPart(slice[slice.length - 1].time) >= 17) ? 6 : 0;
      const daylightPenalty = activity !== "camping" && daylightShare < 0.75 ? 20 : 0;
      const windowScore = clamp(average + setupBonus + fishingBonus - daylightPenalty);
      if (!best || windowScore > best.score) {
        const startLabel = formatTime(slice[0].time);
        const endLabel = addHourLabel(slice[slice.length - 1].time, 1);
        const reason =
          activity === "camping"
            ? "Best setup window based on rain, wind, and daylight."
            : activity === "fishing"
              ? "Best calm daylight window, with preference for early or late hours."
              : "Best daylight window based on rain, gusts, temperature, and visibility.";
        best = { start: startLabel, end: endLabel, reason, score: Math.round(windowScore) };
      }
    }
  }

  return best && best.score >= config.required ? best : null;
}

function findAvoidWindow(hours: HourPoint[], activity: ActivityMode): TimeWindow | null {
  if (hours.length < 2) return null;
  let worst: TimeWindow | null = null;
  for (let start = 0; start < hours.length - 1; start += 1) {
    const slice = hours.slice(start, start + 2);
    const average = slice.reduce((sum, hour) => sum + hourSuitability(hour, activity), 0) / slice.length;
    if (!worst || average < worst.score) {
      worst = {
        start: formatTime(slice[0].time),
        end: addHourLabel(slice[slice.length - 1].time, 1),
        reason: "Conditions are least suitable in this period.",
        score: Math.round(average)
      };
    }
  }
  return worst && worst.score < 45 ? worst : null;
}

function overnightHours(hours: HourPoint[]): HourPoint[] {
  return hours.filter((hour) => {
    const currentHour = hourPart(hour.time);
    return currentHour >= 20 || currentHour <= 6;
  });
}

function buildSummary(activity: ActivityMode, date: string, label: ScoreLabel, bestWindow: TimeWindow | null): string {
  const activityName = activityLabels[activity];
  const dayLabel = weekday(date);
  if (label === "Avoid") return `${dayLabel} looks unsuitable for ${activityName}; risk is elevated.`;
  if (label === "Risky") return `${dayLabel} looks risky for ${activityName}; use a conservative plan.`;
  if (bestWindow) return `${dayLabel} looks ${label.toLowerCase()} for ${activityName}, especially ${bestWindow.start}-${bestWindow.end}.`;
  return `${dayLabel} looks ${label.toLowerCase()} for ${activityName}, but no standout time window was found.`;
}

function scoreDay(forecast: OpenMeteoResponse, activity: ActivityMode, date: string, dayIndex: number): ScoredDay {
  const hours = hourlyForDate(forecast, date);
  const risks: RiskCard[] = [];
  const warnings: string[] = [];
  const severeRisks: string[] = [];
  const positiveFactors: string[] = [];
  const gear = new Set(baseGear[activity]);
  const scoreRef = { value: 100 };

  const rainProbability = dailyNumber(forecast, "precipitation_probability_max", dayIndex) ?? maxHourly(hours, "precipitation_probability") ?? 0;
  const precipitation = dailyNumber(forecast, "precipitation_sum", dayIndex) ?? sumHourly(hours, "precipitation") ?? 0;
  const showers = dailyNumber(forecast, "showers_sum", dayIndex) ?? sumHourly(hours, "showers") ?? 0;
  const snowfall = dailyNumber(forecast, "snowfall_sum", dayIndex) ?? sumHourly(hours, "snowfall") ?? 0;
  const maxGust = dailyNumber(forecast, "wind_gusts_10m_max", dayIndex) ?? maxHourly(hours, "wind_gusts_10m") ?? 0;
  const maxWind = dailyNumber(forecast, "wind_speed_10m_max", dayIndex) ?? maxHourly(hours, "wind_speed_10m") ?? 0;
  const minVisibility = minHourly(hours, "visibility");
  const uvIndex = dailyNumber(forecast, "uv_index_max", dayIndex) ?? maxHourly(hours, "uv_index");
  const weatherCode = dailyNumber(forecast, "weather_code", dayIndex);
  const apparentMax = dailyNumber(forecast, "apparent_temperature_max", dayIndex) ?? maxHourly(hours, "apparent_temperature");
  const apparentMin = dailyNumber(forecast, "apparent_temperature_min", dayIndex) ?? minHourly(hours, "apparent_temperature");
  const soilMoisture = avgHourly(hours, "soil_moisture_0_to_1cm") ?? avgHourly(hours, "soil_moisture_1_to_3cm");
  const freezingLevel = minHourly(hours, "freezing_level_height");
  const snowDepth = maxHourly(hours, "snow_depth");

  const hasThunder = (weatherCode !== null && thunderCodes.has(weatherCode)) || containsCode(hours, thunderCodes);
  const hasSnowCode = (weatherCode !== null && snowCodes.has(weatherCode)) || containsCode(hours, snowCodes);
  const hasFog = (weatherCode !== null && fogCodes.has(weatherCode)) || containsCode(hours, fogCodes);
  const hasRainCode = (weatherCode !== null && rainCodes.has(weatherCode)) || containsCode(hours, rainCodes);
  const wind = windThresholds(activity);
  const comfort = tempComfort(activity);

  if (hasThunder) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "thunderstorm",
        title: "Thunderstorm risk",
        level: "severe",
        detail: "Thunderstorm conditions may occur; avoid exposed terrain and open water.",
        gear: ["Backup indoor plan", "weather alerts"]
      },
      42,
      scoreRef
    );
  }

  if (precipitation >= 10 || rainProbability >= 90) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "heavy-rain",
        title: "Heavy rain risk",
        level: "severe",
        detail: "Rain risk is high enough to make the plan less reliable.",
        gear: ["Rain shell", "waterproof shoes", "dry bag"]
      },
      activity === "camping" ? 28 : 24,
      scoreRef
    );
  } else if (precipitation >= 2 || rainProbability >= 60 || hasRainCode) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "rain",
        title: "Rain risk",
        level: "warning",
        detail: "Rain or showers may affect comfort and footing.",
        gear: ["Rain shell", "waterproof shoes"]
      },
      activity === "camping" ? 18 : 14,
      scoreRef
    );
  } else {
    positiveFactors.push("Low rain signal");
  }

  const afternoonShowers = hours.some((hour) => hourPart(hour.time) >= 15 && ((asNumber(hour.showers) ?? 0) > 0.2 || (asNumber(hour.precipitation_probability) ?? 0) >= 55));
  if (afternoonShowers) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "afternoon-showers",
        title: "Afternoon showers",
        level: "warning",
        detail: "Showers become more likely later in the day; start early if you go.",
        gear: ["Rain shell", "pack cover"]
      },
      8,
      scoreRef
    );
  }

  if (maxGust >= wind.severe || maxWind >= wind.severe) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "wind",
        title: "Strong wind",
        level: "severe",
        detail:
          activity === "fishing"
            ? "Wind may make shorelines or small boats less comfortable and less safe."
            : activity === "camping"
              ? "Strong gusts may make camping uncomfortable and can stress tents."
              : "Strong gusts may be unsafe on exposed ridges or open terrain.",
        gear: ["Windproof layer", "secure shelter setup"]
      },
      activity === "fishing" ? 26 : 22,
      scoreRef
    );
  } else if (maxGust >= wind.warn || maxWind >= wind.warn) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "breezy",
        title: "Wind exposure",
        level: "warning",
        detail:
          activity === "fishing"
            ? "Wind may reduce comfort and make casting or open-water plans harder."
            : "Wind may feel stronger on exposed terrain.",
        gear: ["Windproof layer"]
      },
      activity === "fishing" ? 18 : 12,
      scoreRef
    );
  } else {
    positiveFactors.push(activity === "fishing" ? "Calmer wind periods available" : "Wind looks manageable");
  }

  if (minVisibility !== null && minVisibility < 1000) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "visibility",
        title: "Low visibility",
        level: "severe",
        detail: "Very low visibility may make navigation harder.",
        gear: ["GPS/offline map", "headlamp"]
      },
      20,
      scoreRef
    );
  } else if ((minVisibility !== null && minVisibility < 5000) || hasFog) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "fog",
        title: "Fog or haze",
        level: "warning",
        detail: "Visibility may be limited; navigation needs more care.",
        gear: ["GPS/offline map"]
      },
      10,
      scoreRef
    );
  } else if (minVisibility !== null) {
    positiveFactors.push("Visibility looks usable");
  }

  if (snowfall > 0 || hasSnowCode || (snowDepth !== null && snowDepth > 0.02)) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "snow-ice",
        title: "Snow or ice",
        level: activity === "trekking" ? "severe" : "warning",
        detail: "Snow or ice may affect traction, route timing, and exposure.",
        gear: ["Traction aids", "warm gloves", "waterproof boots"]
      },
      activity === "trekking" ? 24 : 16,
      scoreRef
    );
  }

  if (freezingLevel !== null && freezingLevel < 1500 && (precipitation > 0 || snowfall > 0)) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "freezing-level",
        title: "Freezing level",
        level: "warning",
        detail: "Freezing level is low enough that upper terrain could feel winter-like.",
        gear: ["Insulating layer", "gloves"]
      },
      12,
      scoreRef
    );
  }

  if ((activity === "trekking" || activity === "camping") && soilMoisture !== null && soilMoisture >= 0.36) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "mud",
        title: activity === "camping" ? "Wet ground" : "Muddy trail",
        level: soilMoisture >= 0.46 ? "severe" : "warning",
        detail:
          activity === "camping"
            ? "Ground moisture is elevated, so campsite selection matters."
            : "Trail may be muddy or slippery.",
        gear: ["Waterproof shoes", "extra socks"]
      },
      soilMoisture >= 0.46 ? 16 : 10,
      scoreRef
    );
  }

  if (uvIndex !== null && uvIndex >= 8) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "uv",
        title: "High UV",
        level: "warning",
        detail: "UV exposure is high during daylight hours.",
        gear: ["Sunscreen", "cap", "sunglasses"]
      },
      7,
      scoreRef
    );
  }

  if (apparentMax !== null && apparentMax > comfort.max + 6) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "heat",
        title: "Heat stress",
        level: "warning",
        detail: "Feels-like temperature may be hot enough to require extra water and shade breaks.",
        gear: ["Extra water", "electrolytes", "sun hat"]
      },
      12,
      scoreRef
    );
  } else if (apparentMin !== null && apparentMin < comfort.min - 8) {
    pushRisk(
      risks,
      warnings,
      severeRisks,
      gear,
      {
        id: "cold",
        title: "Cold exposure",
        level: "warning",
        detail: "Feels-like temperature may be cold enough to require warmer layers.",
        gear: ["Insulating layer", "warm gloves"]
      },
      12,
      scoreRef
    );
  } else if (apparentMin !== null || apparentMax !== null) {
    positiveFactors.push("Temperature looks workable");
  }

  if (activity === "camping") {
    const overnight = overnightHours(hours);
    const overnightMin = minHourly(overnight, "apparent_temperature") ?? apparentMin;
    const overnightRain = sumHourly(overnight, "precipitation") ?? 0;
    const overnightHumidity = avgHourly(overnight, "relative_humidity_2m");
    if (overnightMin !== null && overnightMin < 0) {
      pushRisk(
        risks,
        warnings,
        severeRisks,
        gear,
        {
          id: "cold-night",
          title: "Cold night",
          level: "severe",
          detail: "Overnight apparent temperature may drop below freezing.",
          gear: ["Warmer sleeping bag", "insulated sleeping pad", "warm base layer"]
        },
        26,
        scoreRef
      );
    } else if (overnightMin !== null && overnightMin < 6) {
      pushRisk(
        risks,
        warnings,
        severeRisks,
        gear,
        {
          id: "chilly-night",
          title: "Chilly night",
          level: "warning",
          detail: "Overnight conditions may feel cold in camp.",
          gear: ["Warmer sleeping bag", "beanie"]
        },
        14,
        scoreRef
      );
    } else {
      positiveFactors.push("Overnight temperature looks workable");
    }
    if (overnightRain > 1) {
      pushRisk(
        risks,
        warnings,
        severeRisks,
        gear,
        {
          id: "wet-overnight",
          title: "Wet overnight",
          level: "warning",
          detail: "Overnight precipitation may make camp damp.",
          gear: ["Tent footprint", "dry bag"]
        },
        12,
        scoreRef
      );
    }
    if (overnightHumidity !== null && overnightHumidity > 92) {
      pushRisk(
        risks,
        warnings,
        severeRisks,
        gear,
        {
          id: "damp-night",
          title: "Damp night",
          level: "notice",
          detail: "High humidity may make gear and sleeping layers feel damp.",
          gear: ["Ventilated shelter setup"]
        },
        5,
        scoreRef
      );
    }
  }

  if (activity === "fishing") {
    const pressures = hours.map((hour) => asNumber(hour.pressure_msl) ?? asNumber(hour.surface_pressure)).filter((value): value is number => value !== null);
    if (pressures.length >= 4 && pressures[pressures.length - 1] - pressures[0] <= -4) {
      pushRisk(
        risks,
        warnings,
        severeRisks,
        gear,
        {
          id: "pressure-drop",
          title: "Falling pressure",
          level: "notice",
          detail: "Pressure appears to be falling, so weather may become less settled.",
          gear: ["Rain shell"]
        },
        5,
        scoreRef
      );
    }
  }

  const bestWindow = findBestTimeWindow(hours, activity);
  const avoidWindow = findAvoidWindow(hours, activity);
  if (!bestWindow) scoreRef.value -= activity === "camping" ? 8 : 12;

  const finalScore = Math.round(clamp(scoreRef.value));
  const label = scoreLabel(finalScore);
  const summary = buildSummary(activity, date, label, bestWindow);
  const topRisk = severeRisks[0] || warnings[0];
  const details = topRisk
    ? `${positiveFactors.slice(0, 2).join(" and ") || "Some conditions are usable"}, but ${topRisk.charAt(0).toLowerCase()}${topRisk.slice(1)}`
    : `${positiveFactors.slice(0, 3).join(", ") || "Core weather signals are acceptable"}.`;

  return {
    date,
    activity,
    score: finalScore,
    label,
    positiveFactors: positiveFactors.slice(0, 5),
    warnings,
    severeRisks,
    risks,
    bestWindow,
    avoidWindow,
    gear: [...gear].slice(0, 10),
    summary,
    details
  };
}

export function scoreForecast(forecast: OpenMeteoResponse, activity: ActivityMode, allowedDates?: string[]): ScoredDay[] {
  const dailyDates = ((forecast.daily?.time as string[] | undefined) || []) as string[];
  const hourlyDates = Array.from(new Set(((forecast.hourly?.time as string[] | undefined) || []).map(datePart)));
  const dates = dailyDates.length ? dailyDates : hourlyDates;
  const filteredDates = allowedDates?.length ? dates.filter((date) => allowedDates.includes(date)) : dates;
  return filteredDates.map((date) => scoreDay(forecast, activity, date, dates.indexOf(date)));
}

export function summarizeScores(days: ScoredDay[]): ForecastSummary {
  const bestDay = days.length ? [...days].sort((a, b) => b.score - a.score)[0] : null;
  const worstDay = days.length ? [...days].sort((a, b) => a.score - b.score)[0] : null;
  const bestWindow = bestDay?.bestWindow ?? null;
  const riskCounts = new Map<string, number>();
  days.forEach((day) => {
    [...day.severeRisks, ...day.warnings].forEach((risk) => riskCounts.set(risk, (riskCounts.get(risk) || 0) + 1));
  });
  const mainRisk = [...riskCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "No major repeated risk stands out.";
  return { bestDay, worstDay, bestWindow, mainRisk };
}
