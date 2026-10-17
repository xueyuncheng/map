import { TRIP_TYPES, type Place, type Trip } from "./types";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validatePlace(p: Place, label: string): string | null {
  if (!p.name.trim()) return `请填写${label}`;
  if (!Number.isFinite(p.lat) || p.lat < -90 || p.lat > 90) return `${label}纬度应在 -90 到 90 之间`;
  if (!Number.isFinite(p.lng) || p.lng < -180 || p.lng > 180) return `${label}经度应在 -180 到 180 之间`;
  return null;
}

/** Mirrors Trip.Validate in the Go backend, with messages for the UI. */
export function validateTrip(t: Trip): string | null {
  if (!TRIP_TYPES.includes(t.type)) return "请选择类型";
  if (t.origin) {
    const err = validatePlace(t.origin, "出发地");
    if (err) return err;
  }
  const err = validatePlace(t.destination, t.type === "hotel" ? "城市" : "目的地");
  if (err) return err;
  if (t.start_date && !DATE_RE.test(t.start_date)) return "开始日期格式应为 YYYY-MM-DD";
  if (t.end_date && !DATE_RE.test(t.end_date)) return "结束日期格式应为 YYYY-MM-DD";
  if (t.start_date && t.end_date && t.end_date < t.start_date) return "结束日期早于开始日期";
  return null;
}

export function emptyPlace(): Place {
  return { name: "", country: "", lat: 0, lng: 0 };
}

export function emptyTrip(): Trip {
  return {
    id: 0,
    type: "flight",
    origin: emptyPlace(),
    destination: emptyPlace(),
    start_date: "",
    end_date: "",
    provider: "",
    order_number: "",
    notes: "",
    created_at: "",
  };
}

export function routeLabel(t: Trip): string {
  return t.origin ? `${t.origin.name} → ${t.destination.name}` : t.destination.name;
}

export function dateLabel(t: Trip): string {
  if (!t.start_date) return "日期未知";
  if (!t.end_date || t.end_date === t.start_date) return t.start_date;
  // Drop the repeated year: 2026-05-01 – 05-04.
  const end = t.end_date.slice(0, 4) === t.start_date.slice(0, 4) ? t.end_date.slice(5) : t.end_date;
  return `${t.start_date} – ${end}`;
}

/** Identifies a city across trips, so repeat visits share one map marker. */
export function placeKey(p: Place): string {
  return `${p.name}|${p.lat.toFixed(2)}|${p.lng.toFixed(2)}`;
}

/** Same order as the backend's List: newest start date first, then newest id. */
export function sortTrips(trips: Trip[]): Trip[] {
  return [...trips].sort((a, b) => b.start_date.localeCompare(a.start_date) || b.id - a.id);
}

export const UNKNOWN_YEAR = "日期未知";

/** The year a trip belongs to, by its start date. */
export function tripYear(t: Trip): string {
  return t.start_date.slice(0, 4) || UNKNOWN_YEAR;
}

/** Distinct years in list order: newest first, undated trips last. */
export function tripYears(trips: Trip[]): string[] {
  return [...new Set(trips.map(tripYear))];
}

export function tripStats(trips: Trip[]) {
  const cities = new Set<string>();
  const countries = new Set<string>();
  for (const t of trips) {
    for (const p of [t.origin, t.destination]) {
      if (!p) continue;
      cities.add(placeKey(p));
      if (p.country) countries.add(p.country.toUpperCase());
    }
  }
  return { trips: trips.length, cities: cities.size, countries: countries.size };
}
