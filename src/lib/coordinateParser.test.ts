import { describe, expect, it } from "vitest";
import { parseCoordinates, validateCoordinates } from "./coordinateParser";

describe("coordinateParser", () => {
  it("parses comma and space separated coordinates", () => {
    expect(parseCoordinates("35.6892, 51.3890").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
    expect(parseCoordinates("35.6892 51.3890").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
  });

  it("parses labeled and hemisphere formats", () => {
    expect(parseCoordinates("lat:35.6892 lng:51.3890").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
    expect(parseCoordinates("35.6892N, 51.3890E").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
    expect(parseCoordinates("51.3890E 35.6892N").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
  });

  it("extracts coordinates from common map links", () => {
    expect(parseCoordinates("https://maps.google.com/@35.6892,51.3890,12z").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
    expect(parseCoordinates("https://maps.example/?q=35.6892,51.3890").coordinates).toEqual({ lat: 35.6892, lng: 51.389 });
  });

  it("validates coordinate bounds", () => {
    expect(validateCoordinates(91, 20).ok).toBe(false);
    expect(validateCoordinates(45, 181).ok).toBe(false);
    expect(parseCoordinates("not a coordinate").ok).toBe(false);
  });
});
