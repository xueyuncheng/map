"use client";

import { useEffect, useRef, useState } from "react";

import { deleteTrip, updateTrip } from "@/lib/api";
import { dateLabel, routeLabel, tripYear, validateTrip } from "@/lib/trip";
import { TRIP_TYPE_COLORS, TRIP_TYPE_LABELS, type Trip } from "@/lib/types";

import TripForm from "./TripForm";
import TripIcon from "./TripIcon";

const ghostButton =
  "rounded-full px-3 py-1 text-ink-soft transition-colors hover:bg-paper-200 hover:text-ink focus-visible:outline-2 disabled:opacity-50";

function TripDetails({ trip }: { trip: Trip }) {
  const rows: [string, string][] = [
    ["类型", TRIP_TYPE_LABELS[trip.type]],
    [trip.type === "hotel" ? "酒店 / 平台" : "承运方", trip.provider],
    ["订单号", trip.order_number],
    ["备注", trip.notes],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-dashed border-paper-300 pt-2.5 text-xs">
      {rows
        .filter(([, v]) => v)
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-faint">{k}</dt>
            <dd className="break-all text-ink">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

interface ItemProps {
  trip: Trip;
  selected: boolean;
  onSelect: (id: number | null) => void;
  onUpdated: (t: Trip) => void;
  onDeleted: (id: number) => void;
}

function TripItem({ trip, selected, onSelect, onUpdated, onDeleted }: ItemProps) {
  const [draft, setDraft] = useState<Trip | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLLIElement>(null);

  // Keep the item visible when it is selected from the map.
  useEffect(() => {
    if (selected) ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [selected]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const save = () =>
    run(async () => {
      onUpdated(await updateTrip(draft!));
      setDraft(null);
    });

  const remove = () => {
    if (!window.confirm(`删除行程「${routeLabel(trip)}」？`)) return;
    run(async () => {
      await deleteTrip(trip.id);
      onDeleted(trip.id);
    });
  };

  const problem = draft && validateTrip(draft);
  const color = TRIP_TYPE_COLORS[trip.type];
  return (
    <li
      ref={ref}
      className={`rounded-xl transition-colors duration-200 ${
        selected ? "bg-paper-50 shadow-[0_0_0_1px_rgb(91_72_48/0.12),0_4px_12px_-4px_rgb(60_44_26/0.18)]" : ""
      }`}
    >
      <button
        type="button"
        aria-expanded={selected}
        onClick={() => onSelect(selected ? null : trip.id)}
        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
          selected ? "" : "hover:bg-paper-200/50"
        }`}
      >
        {/* Outlined at rest, filled with the route's ink when selected. */}
        <span
          role="img"
          className="flex size-8 shrink-0 items-center justify-center rounded-full transition-colors duration-200"
          style={{
            color: selected ? "var(--color-paper-50)" : color,
            backgroundColor: selected ? color : `${color}14`,
            boxShadow: `inset 0 0 0 1px ${color}${selected ? "" : "40"}`,
          }}
          aria-label={TRIP_TYPE_LABELS[trip.type]}
        >
          <TripIcon type={trip.type} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            {trip.origin ? (
              <>
                <span className="truncate">{trip.origin.name}</span>
                <svg viewBox="0 0 16 8" className="h-2 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-label="至">
                  <path d="M1 4h13M11 1l3 3-3 3" />
                </svg>
                <span className="truncate">{trip.destination.name}</span>
              </>
            ) : (
              <span className="truncate">{trip.destination.name}</span>
            )}
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-faint">
            <span className="tabular-nums">{dateLabel(trip)}</span>
            {trip.provider && ` · ${trip.provider}`}
          </span>
        </span>
      </button>

      {selected && (
        <div className="space-y-3 px-3 pb-3">
          {draft ? (
            <TripForm value={draft} onChange={setDraft} />
          ) : (
            <TripDetails trip={trip} />
          )}
          {(error || problem) && (
            <p role="alert" className="text-xs text-danger">
              {error ?? problem}
            </p>
          )}
          <div className="flex justify-end gap-2 text-sm">
            {draft ? (
              <>
                <button type="button" disabled={busy} onClick={() => setDraft(null)} className={ghostButton}>
                  取消
                </button>
                <button
                  type="button"
                  disabled={busy || !!problem}
                  onClick={save}
                  className="rounded-full bg-seal px-3.5 py-1 text-paper-50 transition-colors hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-paper-300 disabled:text-ink-faint"
                >
                  {busy ? "保存中…" : "保存"}
                </button>
              </>
            ) : (
              <>
                <button type="button" disabled={busy} onClick={remove} className={`${ghostButton} text-danger hover:bg-danger/8 hover:text-danger`}>
                  删除
                </button>
                <button type="button" disabled={busy} onClick={() => setDraft(trip)} className={ghostButton}>
                  编辑
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </li>
  );
}

interface Props {
  trips: Trip[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onUpdated: (t: Trip) => void;
  onDeleted: (id: number) => void;
}

/** Trips grouped by year, newest first (the order the API returns). */
export default function TripList({ trips, selectedId, onSelect, onUpdated, onDeleted }: Props) {
  const groups = new Map<string, Trip[]>();
  for (const t of trips) {
    const year = tripYear(t);
    groups.set(year, [...(groups.get(year) ?? []), t]);
  }
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([year, items]) => (
        <section key={year} aria-label={year}>
          <h3 className="paper sticky top-0 z-10 -mx-2 flex items-center gap-3 px-5 pb-1 pt-1.5 backdrop-blur-sm">
            <span
              className={
                /^\d{4}$/.test(year)
                  ? "font-numeral text-lg font-medium italic tabular-nums text-ink-soft [font-variation-settings:'opsz'_48]"
                  : "text-xs font-medium text-ink-faint"
              }
            >
              {year}
            </span>
            <span className="h-px flex-1 bg-paper-200" aria-hidden />
            <span className="text-[11px] tabular-nums text-ink-faint">{items.length} 段</span>
          </h3>
          <ul className="space-y-1">
            {items.map((t) => (
              <TripItem
                key={t.id}
                trip={t}
                selected={t.id === selectedId}
                onSelect={onSelect}
                onUpdated={onUpdated}
                onDeleted={onDeleted}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
