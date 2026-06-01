import type { Coordinates } from "./types";

export interface CoordinateParseResult {
  ok: boolean;
  coordinates?: Coordinates;
  error?: string;
}

const numberPattern = "([+-]?\\d{1,3}(?:\\.\\d+)?)";

function roundCoord(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function applyHemisphere(value: number, hemisphere?: string): number {
  const hemi = hemisphere?.toUpperCase();
  if (hemi === "S" || hemi === "W") return -Math.abs(value);
  if (hemi === "N" || hemi === "E") return Math.abs(value);
  return value;
}

export function validateCoordinates(lat: number, lng: number): CoordinateParseResult {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return { ok: false, error: "Enter numeric latitude and longitude values." };
  }
  if (Math.abs(lat) > 90) {
    return { ok: false, error: "Latitude must be between -90 and 90." };
  }
  if (Math.abs(lng) > 180) {
    return { ok: false, error: "Longitude must be between -180 and 180." };
  }
  return { ok: true, coordinates: { lat: roundCoord(lat), lng: roundCoord(lng) } };
}

function parsePair(latRaw: string, latHemisphere: string | undefined, lngRaw: string, lngHemisphere: string | undefined): CoordinateParseResult {
  const lat = applyHemisphere(Number(latRaw), latHemisphere);
  const lng = applyHemisphere(Number(lngRaw), lngHemisphere);
  return validateCoordinates(lat, lng);
}

export function parseCoordinates(input: string): CoordinateParseResult {
  const value = input.trim();
  if (!value) return { ok: false, error: "Enter a latitude and longitude." };

  const normalized = value
    .replace(/\u2212/g, "-")
    .replace(/%2C/gi, ",")
    .replace(/\s+/g, " ");

  const labeledLat = normalized.match(new RegExp(`(?:lat|latitude)\\s*[:=]\\s*${numberPattern}\\s*([NS])?`, "i"));
  const labeledLng = normalized.match(new RegExp(`(?:lng|lon|long|longitude)\\s*[:=]\\s*${numberPattern}\\s*([EW])?`, "i"));
  if (labeledLat && labeledLng) {
    return parsePair(labeledLat[1], labeledLat[2], labeledLng[1], labeledLng[2]);
  }

  const googleBang = normalized.match(new RegExp(`!3d${numberPattern}!4d${numberPattern}`, "i"));
  if (googleBang) return parsePair(googleBang[1], undefined, googleBang[2], undefined);

  const atPattern = normalized.match(new RegExp(`@${numberPattern}\\s*,\\s*${numberPattern}`, "i"));
  if (atPattern) return parsePair(atPattern[1], undefined, atPattern[2], undefined);

  const queryPattern = normalized.match(
    new RegExp(`(?:[?&](?:q|query|ll|center|destination)=)${numberPattern}\\s*(?:,|%2C|\\s)\\s*${numberPattern}`, "i")
  );
  if (queryPattern) return parsePair(queryPattern[1], undefined, queryPattern[2], undefined);

  const tokens = [...normalized.matchAll(new RegExp(`${numberPattern}\\s*°?\\s*([NSEW])?`, "gi"))]
    .map((match) => ({ value: match[1], hemisphere: match[2]?.toUpperCase() }))
    .filter((token) => token.value !== undefined);

  if (tokens.length >= 2) {
    let first = tokens[0];
    let second = tokens[1];
    if ((first.hemisphere === "E" || first.hemisphere === "W") && (second.hemisphere === "N" || second.hemisphere === "S")) {
      [first, second] = [second, first];
    }
    return parsePair(first.value, first.hemisphere, second.value, second.hemisphere);
  }

  return { ok: false, error: "Could not find a coordinate pair. Try 35.6892, 51.3890." };
}
