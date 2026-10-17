import { describe, expect, it } from "vitest";

import { fileFingerprint, findSameTrip, sameTrip } from "./dedupe";
import type { Place, Trip } from "./types";

const place = (name: string, lat: number, lng: number, country = "CN"): Place => ({ name, country, lat, lng });
const BJ = place("北京", 39.9042, 116.4074);
const TK = place("东京", 35.6762, 139.6503, "JP");

function trip(patch: Partial<Trip>): Trip {
  return {
    id: 0,
    type: "flight",
    origin: BJ,
    destination: TK,
    start_date: "2025-04-02",
    end_date: "2025-04-02",
    provider: "",
    order_number: "",
    notes: "",
    created_at: "",
    ...patch,
  };
}

describe("sameTrip", () => {
  it("matches identical trips", () => {
    expect(sameTrip(trip({}), trip({ id: 7 }))).toBe(true);
  });

  it("ignores provider, order number and notes", () => {
    expect(sameTrip(trip({ provider: "国航" }), trip({ provider: "Air China", order_number: "X1", notes: "靠窗" }))).toBe(true);
  });

  it("matches names that differ only by 市, case or spaces", () => {
    const a = trip({ origin: place("北京市", 0, 0), destination: place(" Tokyo ", 0, 0) });
    const b = trip({ origin: place("北京", 1, 1), destination: place("tokyo", 1, 1) });
    expect(sameTrip(a, b)).toBe(true);
  });

  it("matches differently spelled places that are close together", () => {
    const b = trip({ destination: place("東京", 35.68, 139.76, "JP") });
    expect(sameTrip(trip({}), b)).toBe(true);
  });

  it("treats places within 50 km as the same and farther ones as different", () => {
    const yokohama = place("横滨", 35.4437, 139.638, "JP"); // ~26 km from Tokyo
    const osaka = place("大阪", 34.6937, 135.5023, "JP");
    expect(sameTrip(trip({}), trip({ destination: yokohama }))).toBe(true);
    expect(sameTrip(trip({}), trip({ destination: osaka }))).toBe(false);
  });

  it("does not match different dates, types or directions", () => {
    expect(sameTrip(trip({}), trip({ start_date: "2025-04-03", end_date: "2025-04-03" }))).toBe(false);
    expect(sameTrip(trip({}), trip({ type: "train" }))).toBe(false);
    expect(sameTrip(trip({}), trip({ origin: TK, destination: BJ }))).toBe(false);
  });

  it("does not match legs of one order (outbound and return)", () => {
    const out = trip({ order_number: "ABC" });
    const back = trip({ order_number: "ABC", origin: TK, destination: BJ, start_date: "2025-04-09", end_date: "2025-04-09" });
    expect(sameTrip(out, back)).toBe(false);
  });

  it("matches hotels by city and check-in date", () => {
    const stay = trip({ type: "hotel", origin: null, start_date: "2025-04-02", end_date: "2025-04-06" });
    expect(sameTrip(stay, { ...stay, provider: "柏悦" })).toBe(true);
    expect(sameTrip(stay, trip({}))).toBe(false);
  });

  it("requires end dates to agree for undated trips", () => {
    const a = trip({ type: "hotel", origin: null, start_date: "", end_date: "" });
    expect(sameTrip(a, { ...a })).toBe(true);
    expect(sameTrip(a, { ...a, end_date: "2025-01-01" })).toBe(false);
  });

  it("does not crash on invalid coordinates", () => {
    const bad = trip({ destination: place("", NaN, 999) });
    expect(sameTrip(bad, trip({}))).toBe(false);
  });
});

describe("findSameTrip", () => {
  it("returns the first matching candidate", () => {
    const list = [{ k: 1, t: trip({ type: "train" }) }, { k: 2, t: trip({}) }, { k: 3, t: trip({}) }];
    expect(findSameTrip(trip({}), list, (c) => c.t)?.k).toBe(2);
    expect(findSameTrip(trip({ type: "ship" }), list, (c) => c.t)).toBeUndefined();
  });
});

describe("fileFingerprint", () => {
  it("is equal for equal bytes and different otherwise", async () => {
    const a = await fileFingerprint(new Blob(["same"]));
    expect(a).toBe(await fileFingerprint(new Blob(["same"])));
    expect(a).not.toBe(await fileFingerprint(new Blob(["other"])));
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});
