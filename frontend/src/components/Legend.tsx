import { TRIP_TYPES, TRIP_TYPE_COLORS, TRIP_TYPE_LABELS, type Trip, type TripType } from "@/lib/types";

/** A swatch drawn the way the map draws that type: ties for rail, dots for sea. */
function LineKey({ type }: { type: TripType }) {
  const color = TRIP_TYPE_COLORS[type];
  if (type === "hotel") {
    return <span className="size-2 rounded-full ring-2 ring-paper-50" style={{ backgroundColor: color }} aria-hidden />;
  }
  return (
    <svg viewBox="0 0 18 8" className="h-2 w-[18px]" fill="none" stroke={color} strokeLinecap="round" aria-hidden>
      {type === "ship" ? (
        <path d="M2 4h14" strokeWidth="2.4" strokeDasharray="0 4" />
      ) : (
        <>
          <path d="M2 6C6 2.5 12 2.5 16 6" strokeWidth="1.8" />
          {type === "train" && <path d="M5 2.2v3.6M9 1.3v3.6M13 2.2v3.6" strokeWidth="1" opacity=".7" />}
        </>
      )}
    </svg>
  );
}

/** Colour key for the trip types currently on the map. */
export default function Legend({ trips }: { trips: Trip[] }) {
  const present = TRIP_TYPES.filter((type) => trips.some((t) => t.type === type));
  if (present.length === 0) return null;
  return (
    <ul
      aria-label="图例"
      className="paper paper-shadow absolute right-3 top-3 z-10 hidden animate-rise gap-4 rounded-full px-4 py-2 text-xs text-ink-soft [animation-delay:120ms] md:flex"
    >
      {present.map((type) => (
        <li key={type} className="flex items-center gap-1.5">
          <LineKey type={type} />
          {TRIP_TYPE_LABELS[type]}
        </li>
      ))}
    </ul>
  );
}
