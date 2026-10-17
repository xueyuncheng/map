"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";

import { listTrips } from "@/lib/api";
import { sortTrips, tripStats, tripYear, tripYears } from "@/lib/trip";
import type { Trip } from "@/lib/types";

import Legend from "./Legend";
import Stats from "./Stats";
import TripList from "./TripList";
import UploadPanel, { IDLE_UPLOAD, type UploadProgress } from "./UploadPanel";
import YearFilter from "./YearFilter";

// MapLibre needs WebGL and window, so it only renders in the browser.
const WorldMap = dynamic(() => import("./WorldMap"), {
  ssr: false,
  loading: () => <div className="absolute inset-0 bg-[#efe8da]" />,
});

/** A compass rose drawn in the map's inks, for the empty state. */
function Compass() {
  return (
    <svg viewBox="0 0 64 64" className="size-16" fill="none" aria-hidden>
      <circle cx="32" cy="32" r="27" stroke="var(--color-paper-300)" strokeWidth="1.5" />
      <circle cx="32" cy="32" r="21" stroke="var(--color-paper-300)" strokeWidth="1" strokeDasharray="1.5 3.5" />
      <path d="M32 8 37 32H27L32 8Z" fill="var(--color-seal)" />
      <path d="M32 56 27 32h10L32 56Z" fill="var(--color-ink-soft)" />
      <path d="M8 32 32 28v8L8 32ZM56 32 32 36v-8l24 4Z" fill="var(--color-paper-300)" />
      <circle cx="32" cy="32" r="2.5" fill="var(--color-paper-50)" stroke="var(--color-ink-soft)" strokeWidth="1.5" />
    </svg>
  );
}

export default function TravelApp() {
  const [trips, setTrips] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [upload, setUpload] = useState<UploadProgress>(IDLE_UPLOAD);
  // null shows every year.
  const [year, setYear] = useState<string | null>(null);

  const fetchTrips = () =>
    listTrips()
      .then(setTrips)
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  useEffect(() => {
    fetchTrips();
  }, []);
  const retry = () => {
    setLoading(true);
    setError(null);
    fetchTrips();
  };

  const years = tripYears(trips);
  // Falls back to all years once the chosen year has no trips left.
  const activeYear = year !== null && years.includes(year) ? year : null;
  const shown = activeYear === null ? trips : trips.filter((t) => tripYear(t) === activeYear);
  const stats = tripStats(shown);
  const select = (id: number | null) => {
    setSelectedId(id);
    if (id === null) return;
    // A recognition in progress outranks browsing: the map still frames the
    // trip, but the panel stays on the upload instead of discarding it.
    if (uploading && upload.dirty) return;
    setUploading(false);
    setCollapsed(false);
  };
  const summary = !uploading
    ? `${activeYear ? `${activeYear} · ` : ""}${stats.trips} 段行程 · ${stats.cities} 座城市 · ${stats.countries} 个国家/地区`
    : upload.status === "extracting"
      ? "正在识别截图…"
      : upload.status === "saving"
        ? "正在保存…"
        : upload.dirty
          ? "识别结果待核对，展开面板保存"
          : "识别订单截图";

  return (
    <main className="relative h-dvh w-full overflow-hidden">
      <WorldMap
        trips={shown}
        pending={upload.pending}
        frameKey={activeYear ?? "all"}
        selectedId={selectedId}
        onSelect={select}
      />

      <Legend trips={shown} />

      {/* Capped on phones so the map stays visible above/below the list. */}
      <aside
        className={`paper paper-shadow absolute left-3 top-3 z-10 flex w-[calc(100%-1.5rem)] max-w-md animate-rise flex-col overflow-hidden rounded-2xl backdrop-blur-md transition-[max-height] duration-300 ease-out-expo md:max-h-[calc(100dvh-1.5rem)] ${
          uploading && !collapsed ? "max-h-[85dvh]" : "max-h-[50dvh]"
        }`}
      >
        <header className="flex items-center gap-3 px-4 pb-3 pt-4">
          {/* A name seal: 足迹 ("footprints") read top to bottom. */}
          <span
            className="seal flex size-10 shrink-0 -rotate-3 flex-col items-center justify-center rounded-[5px] font-serif text-[13px] leading-[1.05] font-bold text-paper-50"
            aria-hidden
          >
            <span>足</span>
            <span>迹</span>
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="font-serif text-[19px] leading-tight font-bold tracking-wide text-ink">我的旅行地图</h1>
            <p className="mt-0.5 truncate text-xs text-ink-faint" aria-live="polite">
              {collapsed
                ? summary
                : activeYear
                  ? `${activeYear} 年的足迹`
                  : "所有年份的足迹"}
            </p>
          </div>
          {!uploading && (
            <button
              type="button"
              onClick={() => {
                setUploading(true);
                setCollapsed(false);
              }}
              className="flex items-center gap-1.5 rounded-full bg-seal px-3.5 py-1.5 text-sm font-medium text-paper-50 shadow-[0_1px_2px_rgb(120_30_20/0.3),inset_0_1px_0_rgb(255_255_255/0.15)] transition-colors hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 active:translate-y-px"
            >
              <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
                <path d="M10 2.5a.75.75 0 0 1 .75.75v6h6a.75.75 0 0 1 0 1.5h-6v6a.75.75 0 0 1-1.5 0v-6h-6a.75.75 0 0 1 0-1.5h6v-6A.75.75 0 0 1 10 2.5Z" />
              </svg>
              上传截图
            </button>
          )}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-expanded={!collapsed}
            aria-label={collapsed ? "展开面板" : "收起面板"}
            className="rounded-full p-1.5 text-ink-faint transition-colors hover:bg-paper-200 hover:text-ink focus-visible:outline-2"
          >
            <svg viewBox="0 0 20 20" fill="currentColor" className={`size-5 transition-transform duration-200 ease-out-expo ${collapsed ? "" : "rotate-180"}`} aria-hidden>
              <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.17l3.71-3.94a.75.75 0 1 1 1.08 1.04l-4.25 4.5a.75.75 0 0 1-1.08 0l-4.25-4.5a.75.75 0 0 1 .02-1.06Z" />
            </svg>
          </button>
        </header>

        {!collapsed && !uploading && <Stats {...stats} />}

        {/* Stays visible when collapsed, so the year can be switched while looking at the map. */}
        {!uploading && years.length > 1 && (
          <YearFilter
            years={years}
            value={activeYear}
            onChange={(y) => {
              setYear(y);
              setSelectedId(null);
            }}
          />
        )}

        {/* The upload stays mounted while collapsed so a recognition survives a peek at the map. */}
        {uploading && (
          <div className={`min-h-0 flex-1 flex-col border-t border-paper-200 ${collapsed ? "hidden" : "flex"}`}>
            <UploadPanel
              existing={trips}
              onProgress={setUpload}
              onCancel={() => setUploading(false)}
              onSaved={(created) => {
                setTrips((ts) => sortTrips([...ts, ...created]));
                setUploading(false);
                setSelectedId(created.length === 1 ? created[0].id : null);
                // Don't hide what was just saved behind the year filter.
                if (created.some((t) => tripYear(t) !== activeYear)) setYear(null);
              }}
            />
          </div>
        )}

        {!collapsed && !uploading && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-paper-200">
            <div className="thin-scroll min-h-0 flex-1 overflow-y-auto p-2">
              {loading && (
                <div role="status" aria-label="加载中" className="space-y-2 p-1">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-12 animate-pulse rounded-xl bg-paper-200/60" />
                  ))}
                </div>
              )}
              {error && (
                <div role="alert" className="m-2 rounded-xl bg-danger/8 p-3 text-sm text-danger ring-1 ring-danger/15">
                  <p>{error}</p>
                  <button type="button" onClick={retry} className="mt-2 font-medium underline underline-offset-4 hover:opacity-80">
                    重试
                  </button>
                </div>
              )}
              {!loading && !error && trips.length === 0 && (
                <div className="flex flex-col items-center px-6 py-8 text-center">
                  <Compass />
                  <p className="mt-3 font-serif text-base font-semibold text-ink">地图还是空白的</p>
                  <p className="mt-1 max-w-[30ch] text-sm leading-relaxed text-ink-soft">
                    点击「上传截图」，从机票、火车票或酒店订单截图中自动识别行程。
                  </p>
                </div>
              )}
              <TripList
                trips={shown}
                selectedId={selectedId}
                onSelect={select}
                onUpdated={(t) => setTrips((ts) => sortTrips(ts.map((x) => (x.id === t.id ? t : x))))}
                onDeleted={(id) => {
                  setTrips((ts) => ts.filter((x) => x.id !== id));
                  setSelectedId(null);
                }}
              />
            </div>
          </div>
        )}
      </aside>
    </main>
  );
}
