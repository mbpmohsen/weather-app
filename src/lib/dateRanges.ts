import type { DateRangeSelection } from "./types";

export const dateRangeOptions: Array<{ id: DateRangeSelection["id"]; label: string; forecastDays: number }> = [
  { id: "today", label: "Today", forecastDays: 1 },
  { id: "tomorrow", label: "Tomorrow", forecastDays: 2 },
  { id: "weekend", label: "Weekend", forecastDays: 7 },
  { id: "next7", label: "Next 7 days", forecastDays: 7 },
  { id: "next16", label: "Next 16 days", forecastDays: 16 },
  { id: "custom", label: "Custom", forecastDays: 16 }
];

export function forecastDaysForRange(range: DateRangeSelection): number {
  return dateRangeOptions.find((option) => option.id === range.id)?.forecastDays ?? 7;
}

function ymd(date: Date): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export type WeekendPreset = "thu-fri" | "fri-sat" | "sat-sun";

export const weekendPresets: Array<{ id: WeekendPreset; label: string; days: number[] }> = [
  { id: "thu-fri", label: "Thu–Fri", days: [4, 5] },
  { id: "fri-sat", label: "Fri–Sat", days: [5, 6] },
  { id: "sat-sun", label: "Sat–Sun", days: [6, 0] }
];

const thuFriZones = new Set(["Asia/Tehran", "Asia/Kabul"]);
const friSatZones = new Set([
  "Asia/Riyadh", "Asia/Dubai", "Asia/Qatar", "Asia/Bahrain", "Asia/Kuwait", "Asia/Muscat",
  "Asia/Baghdad", "Asia/Amman", "Africa/Cairo", "Asia/Jerusalem", "Asia/Dhaka", "Africa/Algiers", "Africa/Tripoli", "Africa/Khartoum"
]);

/** Weekend days follow local custom: Thu–Fri in Iran, Fri–Sat in much of the Middle East, Sat–Sun elsewhere. */
export function defaultWeekend(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone): WeekendPreset {
  if (thuFriZones.has(timeZone)) return "thu-fri";
  if (friSatZones.has(timeZone)) return "fri-sat";
  return "sat-sun";
}

export function filterDatesForRange(
  dates: string[],
  range: DateRangeSelection,
  now = new Date(),
  weekend: WeekendPreset = defaultWeekend()
): string[] {
  if (range.id === "next7" || range.id === "next16") return dates;

  if (range.id === "today") {
    const today = ymd(now);
    return dates.filter((date) => date === today).length ? dates.filter((date) => date === today) : dates.slice(0, 1);
  }

  if (range.id === "tomorrow") {
    const tomorrow = ymd(addDays(now, 1));
    const matched = dates.filter((date) => date === tomorrow);
    return matched.length ? matched : dates.slice(1, 2);
  }

  if (range.id === "custom" && range.startDate && range.endDate) {
    return dates.filter((date) => date >= range.startDate! && date <= range.endDate!);
  }

  if (range.id === "weekend") {
    const weekendDays = weekendPresets.find((preset) => preset.id === weekend)?.days ?? [6, 0];
    const weekendDates = dates.filter((date) => {
      const [year, month, day] = date.split("-").map(Number);
      const weekday = new Date(year, month - 1, day).getDay();
      return weekendDays.includes(weekday);
    });
    return weekendDates.length ? weekendDates.slice(0, 2) : dates.slice(0, 2);
  }

  return dates;
}
