import type { TripType } from "@/lib/types";

// Drawn on a 24px grid with one stroke weight so the set reads as a family.
const PATHS: Record<TripType, React.ReactNode> = {
  flight: (
    <>
      <path d="M3 11.2 20.5 4 13.6 20.5l-2.6-7.4L3 11.2Z" />
      <path d="M11 13.1 20.5 4" />
    </>
  ),
  train: (
    <>
      <rect x="5" y="3" width="14" height="14" rx="3.5" />
      <path d="M5 10.5h14M8.5 17 6.5 21M15.5 17l2 4" />
      <circle cx="9" cy="13.75" r=".6" />
      <circle cx="15" cy="13.75" r=".6" />
    </>
  ),
  bus: (
    <>
      <path d="M6.5 3.5h11a2 2 0 0 1 2 2V17h-15V5.5a2 2 0 0 1 2-2Z" />
      <path d="M4.5 11h15M7.5 17v3M16.5 17v3" />
      <circle cx="8" cy="14" r=".6" />
      <circle cx="16" cy="14" r=".6" />
    </>
  ),
  car: (
    <>
      <path d="M3.5 16.5v-3.6l1.9-4.6A2 2 0 0 1 7.3 7h9.4a2 2 0 0 1 1.9 1.3l1.9 4.6v3.6H3.5Z" />
      <path d="M3.5 12.5h17" />
      <circle cx="7.5" cy="16.5" r="1.8" />
      <circle cx="16.5" cy="16.5" r="1.8" />
    </>
  ),
  ship: (
    <>
      <path d="M3 14.5h18l-2.4 4.4a1 1 0 0 1-.9.6H6.3a1 1 0 0 1-.9-.6L3 14.5Z" />
      <path d="M6 14.5V10h12v4.5M10 10V5.5h4V10" />
    </>
  ),
  hotel: (
    <>
      <path d="M3 5v14M3 15h18v4M21 15v-2.5A3.5 3.5 0 0 0 17.5 9H11v6" />
      <circle cx="7" cy="11.5" r="1.9" />
    </>
  ),
  other: (
    <>
      <path d="M12 21s-6.5-5.4-6.5-11a6.5 6.5 0 0 1 13 0c0 5.6-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </>
  ),
};

export default function TripIcon({ type, className = "size-4" }: { type: TripType; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {PATHS[type]}
    </svg>
  );
}
