import type { ExtractedTrip, Trip } from "./types";

// The Go backend. Called directly from the browser (CORS is configured there)
// so long-running screenshot recognition isn't cut off by a proxy timeout.
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://127.0.0.1:8080";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_URL}${path}`, init);
  } catch (e) {
    if (init?.signal?.aborted) throw e;
    throw new Error("无法连接后端服务，请确认 Go 服务已启动");
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(body?.error ?? `请求失败 (${res.status})`);
  }
  return body as T;
}

export function listTrips(): Promise<Trip[]> {
  return request("/api/trips");
}

export async function extractTrips(image: File, signal?: AbortSignal): Promise<ExtractedTrip[]> {
  const form = new FormData();
  form.append("image", image);
  const body = await request<{ trips: ExtractedTrip[] }>("/api/extract", {
    method: "POST",
    body: form,
    signal,
  });
  return body.trips;
}

export function createTrips(trips: Trip[]): Promise<Trip[]> {
  return request("/api/trips", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ trips }),
  });
}

export function updateTrip(trip: Trip): Promise<Trip> {
  return request(`/api/trips/${trip.id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(trip),
  });
}

export function deleteTrip(id: number): Promise<void> {
  return request(`/api/trips/${id}`, { method: "DELETE" });
}
