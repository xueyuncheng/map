"use client";

import "maplibre-gl/dist/maplibre-gl.css";

import {
  LngLatBounds,
  Map as MapLibreMap,
  NavigationControl,
  Popup,
  ScaleControl,
  setWorkerUrl,
  type ExpressionSpecification,
  type GeoJSONSource,
  type MapGeoJSONFeature,
  type StyleSpecification,
} from "maplibre-gl";
import { useEffect, useRef, useState } from "react";

import { dateLabel, placeKey, routeLabel } from "@/lib/trip";
import { TRIP_TYPES, TRIP_TYPE_COLORS, type Trip, type TripType } from "@/lib/types";

// MapLibre locates its worker with a dynamic `new URL(...)` that Turbopack
// resolves to the wrong file, so point it at the bundled worker explicitly.
setWorkerUrl(new URL("maplibre-gl/dist/maplibre-gl-worker.mjs", import.meta.url).href);

const STYLE_URL = "https://tiles.openfreemap.org/styles/positron";

// Room left for the floating sidebar when fitting the map to trips: beside it
// on wide screens, below it on phones (where it covers the top half).
function fitPadding() {
  if (window.innerWidth >= 768) return { top: 60, bottom: 60, right: 60, left: 460 };
  return { top: Math.round(window.innerHeight * 0.5) + 24, bottom: 40, right: 24, left: 24 };
}

// Mirrors the paper tokens in globals.css.
const PAPER = "#f6f1e6";
const INK = "#2b2620";

/**
 * Positron's greys swapped for a warm atlas palette, keyed by the colour
 * strings as they appear in the style (whitespace stripped, lower-cased).
 */
const ATLAS_COLORS: Record<string, string> = {
  "rgb(242,243,240)": "#efe8da", // land
  "rgb(230,233,229)": "#e3e1cc", // parks
  "rgb(220,224,220)": "#dedbc5", // woods
  "rgb(234,234,230)": "#eae2d2", // residential
  "rgb(194,200,202)": "#c3d1cd", // water
  "hsl(195,17%,78%)": "#adc0bb", // rivers
  "hsl(0,0%,98%)": "#f7f3ea", // ice
  "rgb(234,234,229)": "#e7dfcf", // buildings
  "rgb(219,219,218)": "#d9cfbc",
  "rgb(213,213,213)": "#d8cdb9", // road casings
  "rgb(234,234,234)": "#e8e0cf",
  "hsl(0,0%,88%)": "#e0d6c3",
  "#dddddd": "#d5cab6", // railways
  "#fafafa": PAPER,
  "#fff": PAPER,
  "#ffffff": PAPER,
  "rgba(255,255,255,1)": PAPER,
  "rgba(255,255,255,0.7)": "rgba(246,241,230,0.8)",
  "hsl(0,0%,70%)": "#b3a58d", // borders
  "hsl(0,0%,66%)": "#8d9b96",
  "#495e91": "#4f6f7a", // sea names
  "#000": INK,
  "#333": "#4a4238",
  "#666": "#6b6155",
};

function recolor(v: unknown): unknown {
  if (typeof v === "string") return ATLAS_COLORS[v.replace(/\s/g, "").toLowerCase()] ?? v;
  if (Array.isArray(v)) return v.map(recolor);
  return v;
}

/** Recolours the basemap and shows Chinese place names where the tiles have them. */
function atlasStyle(_prev: StyleSpecification | undefined, next: StyleSpecification): StyleSpecification {
  const zhName = ["coalesce", ["get", "name:zh-Hans"], ["get", "name:zh"], ["get", "name"]];
  return {
    ...next,
    layers: next.layers.map((input) => {
      let layer = input;
      if ("paint" in layer && layer.paint) {
        const paint = Object.fromEntries(
          Object.entries(layer.paint).map(([k, v]) => [k, k.endsWith("color") ? recolor(v) : v]),
        );
        layer = { ...layer, paint } as typeof layer;
      }
      if (layer.type !== "symbol" || !layer.layout?.["text-field"]) return layer;
      if (!JSON.stringify(layer.layout["text-field"]).includes("name:latin")) return layer;
      return { ...layer, layout: { ...layer.layout, "text-field": zhName } } as typeof layer;
    }),
  };
}

type LngLat = [number, number];

/**
 * How far a route bows out, as a share of its length. Flights arc like an
 * airline route map; surface travel stays close to the straight line.
 */
const BOW: Record<TripType, number> = {
  flight: 0.16,
  ship: 0.12,
  train: 0.06,
  bus: 0.06,
  car: 0.06,
  hotel: 0,
  other: 0.1,
};

// Types drawn as a solid line fading in from the origin; trains add ties on top.
const GRADIENT_TYPES = TRIP_TYPES.filter((t) => t !== "hotel" && t !== "ship");
const TIES_OPACITY = 0.7;

/**
 * A 3-on 4-off dash pattern at successive phase shifts, so swapping through
 * them makes the dashes travel from origin to destination (MapLibre can't
 * animate a dash offset). Arrays are kept even-length: odd ones repeat and
 * would swap dashes for gaps.
 */
const FLOW_DASHES: number[][] = Array.from({ length: 14 }, (_, i) => {
  const phase = (7 - i * 0.5) % 7;
  return phase < 3 ? [3 - phase, 4, phase, 0] : [0, 7 - phase, 3, phase - 3];
});

/** Line width over zoom, `scale` times wider for the routes matching `wide`. */
function routeWidth(type: TripType, wide: ExpressionSpecification | false = false, scale = 1.8): ExpressionSpecification {
  const at = (w: number): ExpressionSpecification | number => (wide ? ["case", wide, w * scale, w] : w);
  return ["interpolate", ["linear"], ["zoom"], 1, at(type === "flight" ? 1.4 : 1.8), 8, at(3.5)];
}

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

const RAD = Math.PI / 180;
const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85, Math.min(85, lat)) * RAD) / 2)) / RAD;
const mercLat = (y: number) => (2 * Math.atan(Math.exp(y * RAD)) - Math.PI / 2) / RAD;

/**
 * A clean arc from origin to destination, drawn in Mercator space so it looks
 * round on screen, bowing to the right of the direction of travel. Bowing to
 * one side means an outbound and a return trip between the same cities draw
 * as two arcs instead of one line, and the side of the bulge says which way
 * each one goes. Longitudes are unwrapped so routes across the Pacific go the
 * short way round.
 */
function routeLine(t: Trip): LngLat[] {
  const x0 = t.origin!.lng;
  const y0 = mercY(t.origin!.lat);
  let dx = t.destination.lng - x0;
  while (dx > 180) dx -= 360;
  while (dx < -180) dx += 360;
  const dy = mercY(t.destination.lat) - y0;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return [[x0, t.origin!.lat], [t.destination.lng, t.destination.lat]];
  // Long routes bow proportionally less, so a transpacific arc stays on the map.
  const h = (len * BOW[t.type]) / (1 + len / 120);
  // Right-hand normal of the chord (y points north).
  const nx = dy / len;
  const ny = -dx / len;
  const steps = 48;
  return Array.from({ length: steps + 1 }, (_, i) => {
    const f = i / steps;
    const k = h * Math.sin(Math.PI * f);
    return [x0 + dx * f + nx * k, mercLat(y0 + dy * f + ny * k)];
  });
}

function routesGeoJSON(trips: Trip[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: trips
      .filter((t) => t.origin)
      .map((t) => ({
        type: "Feature",
        properties: { id: t.id, type: t.type, color: TRIP_TYPE_COLORS[t.type] },
        geometry: { type: "LineString", coordinates: routeLine(t) },
      })),
  };
}

/** One point per distinct city, sized by how many trips touch it. */
function placesGeoJSON(trips: Trip[]): GeoJSON.FeatureCollection {
  const places = new Map<string, { name: string; lng: number; lat: number; ids: number[]; stay: boolean }>();
  for (const t of trips) {
    for (const p of [t.origin, t.destination]) {
      if (!p) continue;
      const key = placeKey(p);
      const entry = places.get(key) ?? { name: p.name, lng: p.lng, lat: p.lat, ids: [], stay: false };
      if (!entry.ids.includes(t.id)) entry.ids.push(t.id);
      if (t.type === "hotel") entry.stay = true;
      places.set(key, entry);
    }
  }
  return {
    type: "FeatureCollection",
    features: [...places.entries()].map(([key, p]) => ({
      type: "Feature",
      properties: { key, name: p.name, count: p.ids.length, ids: JSON.stringify(p.ids), stay: p.stay },
      geometry: { type: "Point", coordinates: [p.lng, p.lat] },
    })),
  };
}

/**
 * Smallest box containing every route and place. The longitude range is
 * chosen around the widest empty gap, so trips across the Pacific are framed
 * across the antimeridian rather than across the whole world.
 */
function tripBounds(trips: Trip[]): LngLatBounds | null {
  const points: LngLat[] = [];
  for (const t of trips) {
    if (t.origin) {
      points.push(...routeLine(t));
    } else {
      points.push([t.destination.lng, t.destination.lat]);
    }
  }
  if (!points.length) return null;

  const lngs = points.map(([lng]) => ((((lng + 180) % 360) + 360) % 360) - 180).sort((a, b) => a - b);
  // Default: the gap that wraps from the east-most point back to the west-most.
  let west = lngs[0];
  let east = lngs[lngs.length - 1];
  let widest = lngs[0] + 360 - east;
  for (let i = 0; i < lngs.length - 1; i++) {
    const gap = lngs[i + 1] - lngs[i];
    if (gap > widest) {
      widest = gap;
      west = lngs[i + 1];
      east = lngs[i] + 360;
    }
  }
  const lats = points.map(([, lat]) => lat);
  return new LngLatBounds([west, Math.min(...lats)], [east, Math.max(...lats)]);
}

// Popup content is built with DOM nodes (not HTML strings) because names come
// from model output.
function tripPopup(trips: Trip[], onSelect: (id: number) => void): HTMLElement {
  const root = document.createElement("div");
  root.className = "space-y-0.5 pr-4 text-sm";
  for (const t of trips) {
    const row = document.createElement("button");
    row.type = "button";
    row.className =
      "flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-paper-200/70 focus-visible:outline-2";
    const dot = document.createElement("span");
    dot.className = "mt-1.5 size-2 shrink-0 rounded-full";
    dot.style.backgroundColor = TRIP_TYPE_COLORS[t.type];
    const text = document.createElement("span");
    const title = document.createElement("span");
    title.className = "block font-medium text-ink";
    title.textContent = routeLabel(t);
    const sub = document.createElement("span");
    sub.className = "block text-xs text-ink-faint";
    sub.textContent = [dateLabel(t), t.provider].filter(Boolean).join(" · ");
    text.append(title, sub);
    row.append(dot, text);
    row.addEventListener("click", () => onSelect(t.id));
    root.append(row);
  }
  return root;
}

interface Props {
  trips: Trip[];
  /** Recognised but unsaved trips, drawn dashed and framed as they arrive. */
  pending: Trip[];
  /** The map re-frames to fit `trips` whenever this changes (e.g. a new year filter). */
  frameKey: string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
}

export default function WorldMap({ trips, pending, frameKey, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const [ready, setReady] = useState(false);
  const popupRef = useRef<Popup | null>(null);
  const fittedRef = useRef<string | null>(null);
  // Read by map event handlers, which are registered once.
  const tripsRef = useRef(trips);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    tripsRef.current = trips;
    onSelectRef.current = onSelect;
  });

  // Create the map once.
  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current!,
      center: [110, 30],
      zoom: 2,
      minZoom: 1,
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    map.setStyle(STYLE_URL, { transformStyle: atlasStyle });
    map.addControl(new NavigationControl({ visualizePitch: false }), "bottom-right");
    map.addControl(new ScaleControl(), "bottom-left");

    map.on("load", () => {
      // lineMetrics enables line-progress for the gradients.
      map.addSource("routes", { type: "geojson", data: routesGeoJSON([]), lineMetrics: true });
      map.addSource("places", { type: "geojson", data: placesGeoJSON([]) });
      map.addSource("pending-routes", { type: "geojson", data: routesGeoJSON([]) });
      map.addSource("pending-places", { type: "geojson", data: placesGeoJSON([]) });
      // Halo under the selected route.
      map.addLayer({
        id: "routes-selected",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "id"], -1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: { "line-color": ["get", "color"], "line-width": 10, "line-opacity": 0.18 },
      });
      map.addLayer({
        id: "routes-casing",
        type: "line",
        source: "routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PAPER,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 3, 8, 6],
          "line-opacity": 0.5,
        },
      });
      // One layer per type: line-gradient can't vary by feature. Each route
      // fades in from its origin, so the strong end is where it arrives.
      for (const type of GRADIENT_TYPES) {
        const color = TRIP_TYPE_COLORS[type];
        map.addLayer({
          id: `route-${type}`,
          type: "line",
          source: "routes",
          filter: ["==", ["get", "type"], type],
          layout: { "line-cap": "round", "line-join": "round" },
          paint: {
            "line-width": routeWidth(type),
            "line-gradient": [
              "interpolate",
              ["linear"],
              ["line-progress"],
              0,
              rgba(color, 0.3),
              0.5,
              rgba(color, 0.8),
              1,
              rgba(color, 1),
            ],
          },
        });
      }
      // Railway hatching, as on an old atlas: short ties across the line.
      map.addLayer({
        id: "route-train-ties",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "type"], "train"],
        layout: { "line-cap": "butt", "line-join": "round" },
        paint: {
          "line-color": TRIP_TYPE_COLORS.train,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 6, 8, 10],
          // Dash lengths are in line widths: a sliver of a dash makes a tie.
          "line-dasharray": [0.2, 2],
          "line-opacity": TIES_OPACITY,
        },
      });
      // Sea crossings as a dotted line.
      map.addLayer({
        id: "route-ship",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "type"], "ship"],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": TRIP_TYPE_COLORS.ship,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 2.5, 8, 4],
          "line-dasharray": [0, 1.8],
        },
      });
      // Paper-coloured pulses travelling from origin to destination inside
      // the selected (thickened) route.
      map.addLayer({
        id: "routes-flow",
        type: "line",
        source: "routes",
        filter: ["==", ["get", "id"], -1],
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": PAPER,
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 1, 8, 2.5],
          "line-opacity": 0.85,
          "line-dasharray": FLOW_DASHES[0],
        },
      });
      // Invisible and wide, so thin routes are easy to click.
      map.addLayer({
        id: "routes-hit",
        type: "line",
        source: "routes",
        paint: { "line-color": "rgba(0,0,0,0)", "line-width": 14 },
      });
      map.addLayer({
        id: "places",
        type: "circle",
        source: "places",
        paint: {
          // Plum marks cities with a stay; the rest are ink stops.
          "circle-color": ["case", ["get", "stay"], TRIP_TYPE_COLORS.hotel, INK],
          "circle-radius": ["interpolate", ["linear"], ["get", "count"], 1, 4.5, 10, 9],
          "circle-stroke-color": PAPER,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "place-labels",
        type: "symbol",
        source: "places",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
          "text-letter-spacing": 0.05,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: { "text-color": INK, "text-halo-color": PAPER, "text-halo-width": 1.75 },
      });
      // Pencilled in on top: dashed routes and hollow stops until saved.
      map.addLayer({
        id: "pending-routes",
        type: "line",
        source: "pending-routes",
        layout: { "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["get", "color"],
          "line-width": ["interpolate", ["linear"], ["zoom"], 1, 2, 8, 3.5],
          "line-dasharray": [1.5, 2],
        },
      });
      map.addLayer({
        id: "pending-places",
        type: "circle",
        source: "pending-places",
        paint: {
          "circle-color": PAPER,
          "circle-radius": 5,
          "circle-stroke-color": INK,
          "circle-stroke-width": 2,
        },
      });
      map.addLayer({
        id: "pending-labels",
        type: "symbol",
        source: "pending-places",
        layout: {
          "text-field": ["get", "name"],
          "text-font": ["Noto Sans Bold"],
          "text-size": 13,
          "text-letter-spacing": 0.05,
          "text-offset": [0, 1.1],
          "text-anchor": "top",
        },
        paint: { "text-color": INK, "text-halo-color": PAPER, "text-halo-width": 1.75 },
      });
      setReady(true);
    });

    map.on("click", (e) => {
      popupRef.current?.remove();
      const hit: MapGeoJSONFeature | undefined = map.queryRenderedFeatures(e.point, {
        layers: ["places", "routes-hit"],
      })[0];
      if (!hit) {
        onSelectRef.current(null);
        return;
      }
      if (hit.layer.id === "places") {
        const ids: number[] = JSON.parse(hit.properties.ids);
        const here = tripsRef.current.filter((t) => ids.includes(t.id));
        popupRef.current = new Popup({ maxWidth: "280px" })
          .setLngLat(e.lngLat)
          .setDOMContent(
            tripPopup(here, (id) => {
              popupRef.current?.remove();
              onSelectRef.current(id);
            }),
          )
          .addTo(map);
        return;
      }
      onSelectRef.current(hit.properties.id as number);
    });
    for (const layer of ["places", "routes-hit"]) {
      map.on("mouseenter", layer, () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", layer, () => (map.getCanvas().style.cursor = ""));
    }

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, []);

  // Push trip data into the map sources.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>("routes")?.setData(routesGeoJSON(trips));
    map.getSource<GeoJSONSource>("places")?.setData(placesGeoJSON(trips));
    // Frame all trips the first time there are any, and again per frameKey.
    if (fittedRef.current !== frameKey && trips.length) {
      popupRef.current?.remove();
      const bounds = tripBounds(trips);
      if (bounds) {
        const first = fittedRef.current === null;
        map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 6, duration: first ? 0 : 800 });
      }
      fittedRef.current = frameKey;
    }
  }, [ready, trips, frameKey]);

  // Preview unsaved trips, framing them when a new recognition comes in.
  const pendingCountRef = useRef(0);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getSource<GeoJSONSource>("pending-routes")?.setData(routesGeoJSON(pending));
    map.getSource<GeoJSONSource>("pending-places")?.setData(placesGeoJSON(pending));
    const bounds = pendingCountRef.current === 0 && pending.length ? tripBounds(pending) : null;
    pendingCountRef.current = pending.length;
    if (!bounds) return;
    popupRef.current?.remove();
    map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 6 });
  }, [ready, pending]);

  // Highlight and frame the selected trip. Reads trips through a ref so that
  // editing a trip doesn't move the camera again.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const isSelected: ExpressionSpecification = ["==", ["get", "id"], selectedId ?? -1];
    map.setFilter("routes-selected", isSelected);
    map.setFilter("routes-flow", isSelected);
    // Everything else steps back while one route is selected.
    const dim = (full: number): ExpressionSpecification | number =>
      selectedId === null ? full : ["case", isSelected, full, full * 0.3];
    for (const type of GRADIENT_TYPES) {
      map.setPaintProperty(`route-${type}`, "line-opacity", dim(1));
      map.setPaintProperty(`route-${type}`, "line-width", routeWidth(type, selectedId !== null && isSelected));
    }
    map.setPaintProperty("route-ship", "line-opacity", dim(1));
    map.setPaintProperty("route-train-ties", "line-opacity", dim(TIES_OPACITY));
    const trip = tripsRef.current.find((t) => t.id === selectedId);
    const bounds = trip && tripBounds([trip]);
    if (!trip || !bounds) return;
    if (trip.origin) {
      map.fitBounds(bounds, { padding: fitPadding(), maxZoom: 7 });
    } else {
      map.flyTo({ center: bounds.getCenter(), zoom: Math.max(map.getZoom(), 8) });
    }
  }, [ready, selectedId]);

  // March the dashes of the selected route, unless motion is reduced.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || selectedId === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let step = -1;
    const tick = (time: number) => {
      const next = Math.floor(time / 60) % FLOW_DASHES.length;
      if (next !== step) {
        step = next;
        map.setPaintProperty("routes-flow", "line-dasharray", FLOW_DASHES[step]);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [ready, selectedId]);

  // MapLibre's own CSS sets `position: relative` on the container, so the
  // absolute positioning lives on a wrapper.
  return (
    <div className="absolute inset-0" aria-label="旅行地图" role="region">
      <div ref={containerRef} className="h-full w-full" />
      {/* Darkened edges, like an old sheet of paper. */}
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_55%,rgb(92_70_40/0.14))]"
        aria-hidden
      />
    </div>
  );
}
