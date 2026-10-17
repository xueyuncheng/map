"use client";

interface Props {
  years: string[];
  /** The year being shown, or null for every year. */
  value: string | null;
  onChange: (year: string | null) => void;
}

/** Years as a ruled timeline; the chosen one is ink with a seal mark beneath. */
export default function YearFilter({ years, value, onChange }: Props) {
  return (
    <div
      role="group"
      aria-label="按年份筛选"
      className="thin-scroll -mt-1 flex shrink-0 gap-1 overflow-x-auto px-3"
    >
      {[null, ...years].map((y) => {
        const active = y === value;
        return (
          <button
            key={y ?? "all"}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(y)}
            className={`relative shrink-0 rounded-md px-2 pb-2.5 pt-1.5 transition-colors focus-visible:outline-2 focus-visible:outline-offset-[-2px] ${
              y && /^\d{4}$/.test(y) ? "font-numeral text-[15px] tabular-nums" : "text-xs"
            } ${active ? "text-ink" : "text-ink-faint hover:text-ink"}`}
          >
            {y ?? "全部"}
            <span
              className={`absolute bottom-1 left-1/2 h-[3px] -translate-x-1/2 rounded-full bg-seal transition-all duration-200 ease-out-expo ${
                active ? "w-4 opacity-100" : "w-0 opacity-0"
              }`}
              aria-hidden
            />
          </button>
        );
      })}
    </div>
  );
}
