import type { ForecastSummary, ScoredDay } from "./types";
import { summarizeScores } from "./scoringEngine";

export interface DailyExplanation {
  date: string;
  summarySentence: string;
  bestTimeWindow: string;
  mainRisks: string;
  gearSuggestions: string;
  reasoning: string;
}

function weekday(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en", { weekday: "long" }).format(new Date(year, month - 1, day));
}

function lowerLabel(label: string): string {
  return label === "Mixed / Use caution" ? "mixed, so use caution" : label.toLowerCase();
}

export function explainDay(day: ScoredDay, activityLabel: string): DailyExplanation {
  const dayName = weekday(day.date);
  const windowText = day.bestWindow
    ? `${day.bestWindow.start}-${day.bestWindow.end}: ${day.bestWindow.reason}`
    : "No strong weather window found; keep the plan flexible.";
  const risks = [...day.severeRisks, ...day.warnings];
  const riskText = risks.length ? risks.slice(0, 3).join(" ") : "No major weather risk stands out.";
  const gearText = day.gear.length ? day.gear.slice(0, 7).join(", ") : "Standard outdoor essentials.";
  const positiveText = day.positiveFactors.length ? day.positiveFactors.slice(0, 3).join(", ") : "core weather signals are acceptable";
  const summarySentence = day.bestWindow
    ? `${dayName} looks ${lowerLabel(day.label)} for ${activityLabel.toLowerCase()} if you use the ${day.bestWindow.start}-${day.bestWindow.end} window.`
    : `${dayName} looks ${lowerLabel(day.label)} for ${activityLabel.toLowerCase()}, with no standout low-risk window.`;
  const reasoning = `${positiveText}. ${riskText}`;

  return {
    date: day.date,
    summarySentence,
    bestTimeWindow: windowText,
    mainRisks: riskText,
    gearSuggestions: gearText,
    reasoning
  };
}

export function explainForecast(days: ScoredDay[], activityLabel: string): DailyExplanation[] {
  return days.map((day) => explainDay(day, activityLabel));
}

export function createWeatherSummary(days: ScoredDay[]): ForecastSummary {
  return summarizeScores(days);
}
