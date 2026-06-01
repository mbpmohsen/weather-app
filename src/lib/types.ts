export type ActivityMode = "hiking" | "trekking" | "camping" | "fishing" | "custom";

export type VariableScope = "current" | "hourly" | "daily";

export type WeatherCategory =
  | "Temperature"
  | "Wind"
  | "Rain & Snow"
  | "Clouds & Visibility"
  | "Soil & Trail"
  | "Sun & UV"
  | "Pressure"
  | "Safety";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface WeatherVariable {
  key: string;
  label: string;
  unit: string;
  category: WeatherCategory;
  scope: VariableScope;
  description: string;
  modes: ActivityMode[];
}

export interface VariableSelection {
  current: string[];
  hourly: string[];
  daily: string[];
}

export interface ActivityPreset {
  id: ActivityMode;
  label: string;
  shortLabel: string;
  description: string;
  recommended: VariableSelection;
}

export type DateRangeId = "today" | "tomorrow" | "weekend" | "next7" | "next16" | "custom";

export interface DateRangeSelection {
  id: DateRangeId;
  startDate?: string;
  endDate?: string;
}

export interface ForecastRequest {
  latitude: number;
  longitude: number;
  activity: ActivityMode;
  forecastDays: number;
  variables: VariableSelection;
}

export interface OpenMeteoResponse {
  latitude: number;
  longitude: number;
  timezone?: string;
  timezone_abbreviation?: string;
  utc_offset_seconds?: number;
  generationtime_ms?: number;
  current?: Record<string, number | string>;
  current_units?: Record<string, string>;
  hourly?: Record<string, Array<number | string | null>>;
  hourly_units?: Record<string, string>;
  daily?: Record<string, Array<number | string | null>>;
  daily_units?: Record<string, string>;
  error?: boolean;
  reason?: string;
}

export type ScoreLabel = "Excellent" | "Good" | "Mixed / Use caution" | "Risky" | "Avoid";

export interface TimeWindow {
  start: string;
  end: string;
  reason: string;
  score: number;
}

export type RiskLevel = "notice" | "warning" | "severe";

export interface RiskCard {
  id: string;
  title: string;
  level: RiskLevel;
  detail: string;
  gear?: string[];
}

export interface ScoredDay {
  date: string;
  activity: ActivityMode;
  score: number;
  label: ScoreLabel;
  positiveFactors: string[];
  warnings: string[];
  severeRisks: string[];
  risks: RiskCard[];
  bestWindow: TimeWindow | null;
  avoidWindow: TimeWindow | null;
  gear: string[];
  summary: string;
  details: string;
}

export interface ForecastSummary {
  bestDay: ScoredDay | null;
  worstDay: ScoredDay | null;
  bestWindow: TimeWindow | null;
  mainRisk: string;
}
