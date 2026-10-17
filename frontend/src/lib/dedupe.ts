import type { Place, Trip } from "./types";

// Two recognitions of the same city can differ in spelling (东京 / 東京 /
// Tokyo) or in a few hundred metres of geocoding, so places match by name or
// by being close together.
const SAME_PLACE_KM = 50;

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, "").replace(/市$/, "");
}

function distanceKm(a: Place, b: Place): number {
  const rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad;
  const dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

function validCoords(p: Place): boolean {
  return Number.isFinite(p.lat) && Math.abs(p.lat) <= 90 && Number.isFinite(p.lng) && Math.abs(p.lng) <= 180;
}

function samePlace(a: Place | null, b: Place | null): boolean {
  if (!a || !b) return a === b;
  const na = normalizeName(a.name);
  if (na && na === normalizeName(b.name)) return true;
  return validCoords(a) && validCoords(b) && distanceKm(a, b) <= SAME_PLACE_KM;
}

/**
 * Whether two trips describe the same journey or stay: same type, same start
 * date and the same places. Order numbers are not used, because one order
 * often covers several legs (an outbound and a return flight).
 */
export function sameTrip(a: Trip, b: Trip): boolean {
  if (a.type !== b.type || a.start_date !== b.start_date) return false;
  // Undated trips need the end date to agree too, or every undated stay in a
  // city would collapse into one.
  if (!a.start_date && a.end_date !== b.end_date) return false;
  return samePlace(a.origin, b.origin) && samePlace(a.destination, b.destination);
}

/** The first of `candidates` that is the same trip as `trip`, if any. */
export function findSameTrip<T>(trip: Trip, candidates: T[], get: (c: T) => Trip): T | undefined {
  return candidates.find((c) => sameTrip(trip, get(c)));
}

/** Content hash of a file, so the same screenshot uploaded twice is recognised only once. */
export async function fileFingerprint(file: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
