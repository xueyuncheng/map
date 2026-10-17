"use client";

import { useId, useState } from "react";

import { emptyPlace } from "@/lib/trip";
import { TRIP_TYPE_LABELS, TRIP_TYPES, type Place, type Trip, type TripType } from "@/lib/types";

const inputClass =
  "w-full min-w-0 rounded-lg border border-paper-300 bg-paper-50 px-2 py-1 text-sm text-ink transition-colors " +
  "placeholder:text-ink-faint/60 hover:border-ink-faint/50 focus:border-seal focus:outline-none focus:ring-3 focus:ring-seal/15";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  /** Read-only aside shown at the end of the label row. */
  hint?: string;
  children: (id: string) => React.ReactNode;
}) {
  const id = useId();
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <label htmlFor={id} className="text-[11px] tracking-wide text-ink-faint">
          {label}
        </label>
        {hint && <span className="truncate text-[11px] tabular-nums text-ink-faint">{hint}</span>}
      </div>
      {children(id)}
    </div>
  );
}

function badCoords(p: Place): boolean {
  return !Number.isFinite(p.lat) || Math.abs(p.lat) > 90 || !Number.isFinite(p.lng) || Math.abs(p.lng) > 180;
}

/** "CN · 39.90°N 116.41°E", so the recognised position can be checked without opening the fields. */
function coordsHint(p: Place): string {
  if (badCoords(p)) return "坐标待填";
  const lat = `${Math.abs(p.lat).toFixed(2)}°${p.lat >= 0 ? "N" : "S"}`;
  const lng = `${Math.abs(p.lng).toFixed(2)}°${p.lng >= 0 ? "E" : "W"}`;
  return [p.country, `${lat} ${lng}`].filter(Boolean).join(" · ");
}

interface PlaceProps {
  label: string;
  value: Place;
  onChange: (p: Place) => void;
  /** Country code and coordinates; otherwise only the city name is editable. */
  detailed: boolean;
}

function PlaceFields({ label, value, onChange, detailed }: PlaceProps) {
  const num = (s: string) => (s === "" ? NaN : Number(s));
  if (!detailed) {
    return (
      <Field label={label} hint={coordsHint(value)}>
        {(id) => (
          <input
            id={id}
            className={inputClass}
            value={value.name}
            placeholder="城市"
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        )}
      </Field>
    );
  }
  return (
    <fieldset className="grid grid-cols-[2fr_1fr] gap-2 sm:grid-cols-[2fr_1fr_1fr_1fr]">
      <legend className="sr-only">{label}</legend>
      <Field label={label}>
        {(id) => (
          <input
            id={id}
            className={inputClass}
            value={value.name}
            placeholder="城市"
            onChange={(e) => onChange({ ...value, name: e.target.value })}
          />
        )}
      </Field>
      <Field label="国家代码">
        {(id) => (
          <input
            id={id}
            className={inputClass}
            value={value.country}
            maxLength={2}
            placeholder="CN"
            onChange={(e) => onChange({ ...value, country: e.target.value.toUpperCase() })}
          />
        )}
      </Field>
      <Field label="纬度">
        {(id) => (
          <input
            id={id}
            type="number"
            step="any"
            min={-90}
            max={90}
            className={inputClass}
            value={Number.isFinite(value.lat) ? value.lat : ""}
            onChange={(e) => onChange({ ...value, lat: num(e.target.value) })}
          />
        )}
      </Field>
      <Field label="经度">
        {(id) => (
          <input
            id={id}
            type="number"
            step="any"
            min={-180}
            max={180}
            className={inputClass}
            value={Number.isFinite(value.lng) ? value.lng : ""}
            onChange={(e) => onChange({ ...value, lng: num(e.target.value) })}
          />
        )}
      </Field>
    </fieldset>
  );
}

interface Props {
  value: Trip;
  onChange: (t: Trip) => void;
}

/** Editable fields of one trip. Hotels have no origin. */
export default function TripForm({ value, onChange }: Props) {
  const [wantCoords, setWantCoords] = useState(false);
  const set = <K extends keyof Trip>(key: K, v: Trip[K]) => onChange({ ...value, [key]: v });

  const setType = (type: TripType) => {
    let origin = value.origin;
    if (type === "hotel") origin = null;
    else if (!origin) origin = emptyPlace();
    onChange({ ...value, type, origin });
  };

  const isHotel = value.type === "hotel";
  // Coordinates the user must fix are never hidden.
  const mustShowCoords = badCoords(value.destination) || (value.origin !== null && badCoords(value.origin));
  const detailed = wantCoords || mustShowCoords;
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-3 gap-2">
        <Field label="类型">
          {(id) => (
            <select
              id={id}
              className={inputClass}
              value={value.type}
              onChange={(e) => setType(e.target.value as TripType)}
            >
              {TRIP_TYPES.map((t) => (
                <option key={t} value={t}>
                  {TRIP_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          )}
        </Field>
        <Field label={isHotel ? "入住" : "出发日期"}>
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={value.start_date}
              onChange={(e) => set("start_date", e.target.value)}
            />
          )}
        </Field>
        <Field label={isHotel ? "离店" : "到达日期"}>
          {(id) => (
            <input
              id={id}
              type="date"
              className={inputClass}
              value={value.end_date}
              onChange={(e) => set("end_date", e.target.value)}
            />
          )}
        </Field>
      </div>

      {value.origin && (
        <PlaceFields label="出发地" value={value.origin} onChange={(p) => set("origin", p)} detailed={detailed} />
      )}
      <PlaceFields
        label={isHotel ? "城市" : "目的地"}
        value={value.destination}
        onChange={(p) => set("destination", p)}
        detailed={detailed}
      />
      {!mustShowCoords && (
        <button
          type="button"
          aria-expanded={detailed}
          onClick={() => setWantCoords((v) => !v)}
          className="-mt-0.5 self-start rounded text-[11px] text-ink-soft underline decoration-paper-300 underline-offset-4 transition-colors hover:text-ink hover:decoration-ink-faint focus-visible:outline-2"
        >
          {detailed ? "收起国家代码和坐标" : "位置不对？调整国家代码和坐标"}
        </button>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label={isHotel ? "酒店 / 平台" : "承运方"}>
          {(id) => (
            <input id={id} className={inputClass} value={value.provider} onChange={(e) => set("provider", e.target.value)} />
          )}
        </Field>
        <Field label="订单号">
          {(id) => (
            <input
              id={id}
              className={inputClass}
              value={value.order_number}
              onChange={(e) => set("order_number", e.target.value)}
            />
          )}
        </Field>
      </div>
      <Field label="备注">
        {(id) => (
          <input id={id} className={inputClass} value={value.notes} onChange={(e) => set("notes", e.target.value)} />
        )}
      </Field>
    </div>
  );
}
