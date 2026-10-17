// Mirrors backend/internal/trip.

export const TRIP_TYPES = ["flight", "train", "bus", "car", "ship", "hotel", "other"] as const;
export type TripType = (typeof TRIP_TYPES)[number];

export const TRIP_TYPE_LABELS: Record<TripType, string> = {
  flight: "飞机",
  train: "火车",
  bus: "巴士",
  car: "自驾",
  ship: "轮船",
  hotel: "住宿",
  other: "其他",
};

// Line/point colour per type on the map: atlas inks that read on the paper basemap.
export const TRIP_TYPE_COLORS: Record<TripType, string> = {
  flight: "#2f5d8c",
  train: "#3f7d58",
  bus: "#a8761f",
  car: "#c4622d",
  ship: "#2a8079",
  hotel: "#7a4a7e",
  other: "#7d7266",
};

export interface Place {
  name: string;
  country: string;
  lat: number;
  lng: number;
}

export interface Trip {
  id: number;
  type: TripType;
  origin: Place | null;
  destination: Place;
  start_date: string;
  end_date: string;
  provider: string;
  order_number: string;
  notes: string;
  created_at: string;
}

/** A trip as returned by /api/extract: not yet saved, may fail validation. */
export interface ExtractedTrip {
  trip: Trip;
  error?: string;
}
