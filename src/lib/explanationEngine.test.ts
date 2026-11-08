import { describe, expect, it } from "vitest";
import { explainDay } from "./explanationEngine";
import type { ScoredDay } from "./types";

describe("explanationEngine", () => {
  it("creates deterministic practical daily copy", () => {
    const day: ScoredDay = {
      date: "2026-06-06",
      activity: "trekking",
      score: 76,
      label: "Good",
      positiveFactors: ["Low rain signal", "Wind looks manageable"],
      warnings: ["Showers become more likely later in the day; start early if you go."],
      severeRisks: [],
      risks: [],
      bestWindow: { start: "07:00", end: "13:00", reason: "Best daylight window based on rain, gusts, temperature, and visibility.", score: 82 },
      avoidWindow: null,
      gear: ["Rain shell", "waterproof shoes", "offline map"],
      summary: "",
      details: ""
    };

    const explanation = explainDay(day, "Trekking");
    expect(explanation.summarySentence).toContain("Saturday looks good for trekking");
    expect(explanation.bestTimeWindow).toContain("07:00–13:00");
    expect(explanation.gearSuggestions).toContain("Rain shell");
    expect(explanation.reasoning).toContain("Low rain signal");
  });
});

describe("explanation wording", () => {
  it("never says a day 'looks avoid'", () => {
    const day = { date: "2026-11-08", activity: "hiking", score: 20, label: "Avoid", positiveFactors: [], warnings: [], severeRisks: [], risks: [], bestWindow: null, avoidWindow: null, gear: [], summary: "", details: "" } as const;
    const text = explainDay({ ...day, positiveFactors: [], warnings: [], severeRisks: [], risks: [], gear: [] }, "Hiking").summarySentence;
    expect(text).not.toContain("looks avoid");
    expect(text).toContain("unsuitable");
  });
});
