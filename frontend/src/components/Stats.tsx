interface Props {
  trips: number;
  cities: number;
  countries: number;
}

/** A ledger line of totals, divided by hairlines like an atlas key. */
export default function Stats({ trips, cities, countries }: Props) {
  const items: [string, number][] = [
    ["段行程", trips],
    ["座城市", cities],
    ["个国家/地区", countries],
  ];
  return (
    <dl className="mx-4 mb-3 grid grid-cols-3 divide-x divide-paper-200 border-y border-paper-200 py-2.5">
      {items.map(([label, value]) => (
        <div key={label} className="flex flex-col-reverse items-center gap-0.5 px-2">
          <dt className="truncate text-[11px] tracking-wide text-ink-faint">{label}</dt>
          <dd className="font-numeral text-[26px] leading-none font-medium tabular-nums text-ink [font-variation-settings:'opsz'_72,'SOFT'_50]">
            {value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
