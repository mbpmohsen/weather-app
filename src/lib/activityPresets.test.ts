import { describe, expect, it } from "vitest";
import { activityPresets } from "./activityPresets";
import { validateVariableSelection } from "./weatherVariableRegistry";

describe("activityPresets", () => {
  it("uses only supported Open-Meteo variables", () => {
    Object.values(activityPresets).forEach((preset) => {
      expect(validateVariableSelection(preset.recommended), preset.id).toEqual([]);
    });
  });

  it("includes activity-specific variables", () => {
    expect(activityPresets.trekking.recommended.hourly).toEqual(
      expect.arrayContaining(["soil_moisture_0_to_1cm", "soil_moisture_1_to_3cm", "freezing_level_height", "snow_depth"])
    );
    expect(activityPresets.camping.recommended.hourly).toContain("relative_humidity_2m");
    expect(activityPresets.fishing.recommended.hourly).toEqual(expect.arrayContaining(["pressure_msl", "surface_pressure", "wind_direction_10m"]));
  });
});
