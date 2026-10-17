"use client";

import { useEffect, useRef, useState } from "react";

import { createTrips, extractTrips } from "@/lib/api";
import { fileFingerprint, findSameTrip, sameTrip } from "@/lib/dedupe";
import { dateLabel, routeLabel, validateTrip } from "@/lib/trip";
import { TRIP_TYPE_COLORS, TRIP_TYPE_LABELS, type Trip } from "@/lib/types";

import TripForm from "./TripForm";
import TripIcon from "./TripIcon";

const MAX_BYTES = 5 << 20; // backend and Claude limit
const ACCEPT = ["image/png", "image/jpeg", "image/webp", "image/gif"];
const MAX_SHOTS = 20;
// Recognitions run a few at a time: each one is a long Claude call.
const CONCURRENCY = 2;

/** Re-encodes oversized screenshots as JPEG so they fit the upload limit. */
async function shrinkImage(file: File): Promise<File> {
  if (file.size <= MAX_BYTES) return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 4000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
  if (!blob || blob.size > MAX_BYTES) throw new Error("图片太大，请裁剪后再上传（最大 5 MB）");
  return new File([blob], file.name.replace(/\.\w+$/, ".jpg"), { type: "image/jpeg" });
}

interface Shot {
  key: number;
  url: string;
  status: "queued" | "extracting" | "done" | "error";
  /** Trips recognised, once done. */
  count: number;
  error?: string;
}

interface Draft {
  key: number;
  /** The screenshot it came from. */
  shot: number;
  trip: Trip;
  include: boolean;
}

type Status = "idle" | "extracting" | "review" | "saving";

/** What the rest of the app needs to know about an upload in progress. */
export interface UploadProgress {
  status: Status;
  /** Recognised trips that are ticked and valid, for previewing on the map. */
  pending: Trip[];
  /** True while leaving would throw away a recognition or unsaved drafts. */
  dirty: boolean;
}

export const IDLE_UPLOAD: UploadProgress = { status: "idle", pending: [], dirty: false };

/** Why a draft looks like a trip that is already saved or already in this batch. */
type Duplicate = { saved: Trip } | { draft: number } | null;

/**
 * A recognised trip duplicates a saved trip, or a ticked draft in the same
 * batch (e.g. the order list and the order detail of one booking). Between two
 * ticked copies only the later one is flagged; an unticked copy is flagged
 * against any ticked one, wherever it sits.
 */
function findDuplicate(draft: Draft, drafts: Draft[], existing: Trip[]): Duplicate {
  const saved = findSameTrip(draft.trip, existing, (t) => t);
  if (saved) return { saved };
  for (const other of drafts) {
    if (other.key === draft.key) {
      if (draft.include) break;
      continue;
    }
    if (other.include && sameTrip(draft.trip, other.trip)) return { draft: other.key };
  }
  return null;
}

function duplicateLabel(dup: NonNullable<Duplicate>, drafts: Draft[]): string {
  if ("saved" in dup) return `地图上已有：${routeLabel(dup.saved)} · ${dateLabel(dup.saved)}`;
  const other = drafts.find((d) => d.key === dup.draft);
  return `与「${other ? routeLabel(other.trip) : "另一条"}」相同`;
}

/** One recognised trip as a ticket stub: a summary first, the full form on demand. */
function DraftCard({
  draft,
  duplicate,
  onChange,
}: {
  draft: Draft;
  /** Why this looks like a trip that is already there, if it does. */
  duplicate: string | null;
  onChange: (patch: Partial<Draft>) => void;
}) {
  const [open, setOpen] = useState(false);
  const { trip, include } = draft;
  const problem = include ? validateTrip(trip) : null;
  const expanded = include && (open || !!problem);
  const color = TRIP_TYPE_COLORS[trip.type];
  return (
    <li
      className={`rounded-xl border bg-paper-50 transition-[opacity,border-color] duration-200 ${
        problem ? "border-danger/40" : "border-paper-200"
      } ${include ? "" : "opacity-60"}`}
    >
      <div className="flex items-center gap-3 px-3 py-2.5">
        <input
          type="checkbox"
          checked={include}
          onChange={(e) => onChange({ include: e.target.checked })}
          aria-label={`保存这条行程：${routeLabel(trip) || TRIP_TYPE_LABELS[trip.type]}`}
          className="size-4 shrink-0"
        />
        <span
          role="img"
          aria-label={TRIP_TYPE_LABELS[trip.type]}
          className="flex size-8 shrink-0 items-center justify-center rounded-full"
          style={{ color, backgroundColor: `${color}14`, boxShadow: `inset 0 0 0 1px ${color}40` }}
        >
          <TripIcon type={trip.type} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium text-ink">
            {trip.origin && (
              <>
                <span className="truncate">{trip.origin.name || "出发地未知"}</span>
                <svg viewBox="0 0 16 8" className="h-2 w-4 shrink-0 text-ink-faint" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" aria-hidden>
                  <path d="M1 4h13M11 1l3 3-3 3" />
                </svg>
              </>
            )}
            <span className="truncate">{trip.destination.name || "地点未知"}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-ink-faint">
            <span className="tabular-nums">{dateLabel(trip)}</span>
            {trip.provider && ` · ${trip.provider}`}
          </span>
          {duplicate && (
            <span className="mt-1 flex items-center gap-1 text-[11px] text-ink-soft">
              <svg viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
                <rect x="2" y="4.5" width="8" height="9" rx="1.5" />
                <path d="M6 4.5V3.5A1.5 1.5 0 0 1 7.5 2h5A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H10" />
              </svg>
              <span className="truncate">
                疑似重复{include ? "" : "，已取消勾选"} · {duplicate}
              </span>
            </span>
          )}
        </span>
        {include && !problem && (
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => setOpen((o) => !o)}
            className="shrink-0 rounded-full px-2.5 py-1 text-xs text-ink-soft transition-colors hover:bg-paper-200 hover:text-ink focus-visible:outline-2"
          >
            {expanded ? "收起" : "修改"}
          </button>
        )}
      </div>
      {expanded && (
        // The perforation between the stub and its details.
        <div className="border-t border-dashed border-paper-300 px-3 pb-3 pt-2.5">
          {problem && (
            <p role="alert" className="mb-2 text-xs text-danger">
              {problem}
            </p>
          )}
          <TripForm value={trip} onChange={(t) => onChange({ trip: t })} />
        </div>
      )}
    </li>
  );
}

/** A thumbnail per screenshot with where its recognition has got to. */
function ShotStrip({ shots, onRetry }: { shots: Shot[]; onRetry: (key: number) => void }) {
  return (
    <ul aria-label="已上传的截图" className="thin-scroll -mx-1 flex gap-2 overflow-x-auto px-1 pb-1 pt-1">
      {shots.map((s, i) => {
        const label =
          s.status === "queued"
            ? "排队中"
            : s.status === "extracting"
              ? "识别中"
              : s.status === "error"
                ? "失败"
                : s.count
                  ? `${s.count} 段`
                  : "未识别到";
        return (
          <li key={s.key} className="flex w-14 shrink-0 flex-col items-center gap-1">
            <span className="relative block size-14 overflow-hidden rounded-lg bg-paper-200 shadow-[0_0_0_1px_rgb(91_72_48/0.12)]">
              {/* eslint-disable-next-line @next/next/no-img-element -- local object URL */}
              <img src={s.url} alt={`第 ${i + 1} 张截图`} className={`size-full object-cover ${s.status === "done" ? "" : "opacity-60"}`} />
              {s.status === "extracting" && (
                <span className="absolute inset-0 flex items-center justify-center bg-paper-50/40" aria-hidden>
                  <span className="size-5 animate-spin rounded-full border-2 border-seal border-t-transparent" />
                </span>
              )}
              {s.status === "error" && (
                <span className="absolute inset-x-0 bottom-0 h-1 bg-danger" aria-hidden />
              )}
            </span>
            {s.status === "error" ? (
              <button
                type="button"
                onClick={() => onRetry(s.key)}
                title={s.error}
                className="rounded text-[11px] text-danger underline underline-offset-2 focus-visible:outline-2"
              >
                重试
              </button>
            ) : (
              <span className={`text-[11px] tabular-nums ${s.status === "done" && !s.count ? "text-danger" : "text-ink-faint"}`}>
                {label}
              </span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

interface Props {
  /** Every saved trip, to spot recognitions that are already on the map. */
  existing: Trip[];
  onSaved: (trips: Trip[]) => void;
  onCancel: () => void;
  onProgress: (p: UploadProgress) => void;
}

/** Upload screenshots, review what Claude recognised, then save. */
export default function UploadPanel({ existing, onSaved, onCancel, onProgress }: Props) {
  const [shots, setShots] = useState<Shot[]>([]);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [confirmingLeave, setConfirmingLeave] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Bookkeeping the async recognitions read, outside React state.
  const nextKey = useRef(0);
  const files = useRef(new Map<number, File>());
  const seen = useRef(new Set<string>());
  const queue = useRef<number[]>([]);
  const running = useRef(0);
  // Leaving the panel stops queued and in-flight recognitions, so nothing is
  // recognised (and paid for) after the user has given up on it.
  const abort = useRef(new AbortController());
  useEffect(() => {
    const controller = new AbortController();
    abort.current = controller;
    return () => {
      controller.abort();
      queue.current = [];
    };
  }, []);
  const existingRef = useRef(existing);
  useEffect(() => {
    existingRef.current = existing;
  });

  const extracting = shots.filter((s) => s.status === "queued" || s.status === "extracting").length;
  const status: Status = saving ? "saving" : extracting ? "extracting" : drafts.length ? "review" : "idle";
  const dirty = status !== "idle";
  const failed = shots.filter((s) => s.status === "error");
  const compact = shots.length > 0;

  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  useEffect(() => {
    const pending = drafts.filter((d) => d.include && !validateTrip(d.trip)).map((d) => d.trip);
    onProgress({ status, pending, dirty });
  }, [status, drafts, dirty, onProgress]);
  useEffect(() => () => onProgress(IDLE_UPLOAD), [onProgress]);

  // A reload or closed tab would lose the recognition just like 返回 would.
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirty]);

  const leave = () => (dirty ? setConfirmingLeave(true) : onCancel());

  const patchShot = (key: number, patch: Partial<Shot>) =>
    setShots((ss) => ss.map((s) => (s.key === key ? { ...s, ...patch } : s)));

  const recognise = async (key: number) => {
    patchShot(key, { status: "extracting", error: undefined });
    try {
      const results = await extractTrips(await shrinkImage(files.current.get(key)!), abort.current.signal);
      setDrafts((ds) => {
        const next = [...ds];
        for (const r of results) {
          const draft: Draft = { key: nextKey.current++, shot: key, trip: r.trip, include: true };
          // Duplicates arrive unticked; the user can still tick them back.
          draft.include = !findDuplicate(draft, [...next, draft], existingRef.current);
          next.push(draft);
        }
        // Keep upload order even though recognitions finish out of order.
        return next.sort((a, b) => a.shot - b.shot || a.key - b.key);
      });
      patchShot(key, { status: "done", count: results.length });
    } catch (e) {
      if (abort.current.signal.aborted) return;
      patchShot(key, { status: "error", error: e instanceof Error ? e.message : String(e) });
    }
  };

  const pump = () => {
    while (running.current < CONCURRENCY && queue.current.length && !abort.current.signal.aborted) {
      const key = queue.current.shift()!;
      running.current++;
      recognise(key).finally(() => {
        running.current--;
        pump();
      });
    }
  };

  const enqueue = (key: number) => {
    queue.current.push(key);
    patchShot(key, { status: "queued", error: undefined });
    pump();
  };

  const addFiles = async (list: File[]) => {
    if (saving || !list.length) return;
    setError(null);
    setConfirmingLeave(false);
    const images = list.filter((f) => ACCEPT.includes(f.type));
    const skipped: string[] = [];
    if (images.length < list.length) skipped.push(`${list.length - images.length} 个文件不是 PNG、JPEG、WebP 或 GIF 图片`);

    let repeats = 0;
    const fresh: File[] = [];
    for (const f of images) {
      const hash = await fileFingerprint(f);
      if (seen.current.has(hash)) repeats++;
      else {
        seen.current.add(hash);
        fresh.push(f);
      }
    }
    if (repeats) skipped.push(`${repeats} 张截图已经上传过`);

    const room = MAX_SHOTS - files.current.size;
    if (fresh.length > room) skipped.push(`一次最多识别 ${MAX_SHOTS} 张，多出的 ${fresh.length - Math.max(room, 0)} 张没有加入`);
    const accepted = fresh.slice(0, Math.max(room, 0));
    setNotice(skipped.length ? `${skipped.join("；")}，已跳过。` : null);

    const added: Shot[] = accepted.map((f) => {
      const key = nextKey.current++;
      const url = URL.createObjectURL(f);
      urls.current.push(url);
      files.current.set(key, f);
      return { key, url, status: "queued", count: 0 };
    });
    if (!added.length) return;
    setShots((ss) => [...ss, ...added]);
    for (const s of added) {
      queue.current.push(s.key);
    }
    pump();
  };

  // Paste screenshots straight from the clipboard.
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const pasted = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith("image/"));
      if (pasted.length) {
        e.preventDefault();
        addFiles(pasted);
      }
    };
    window.addEventListener("paste", onPaste);
    return () => window.removeEventListener("paste", onPaste);
  });

  const update = (key: number, patch: Partial<Draft>) =>
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, ...patch } : d)));

  const duplicates = new Map(drafts.map((d) => [d.key, findDuplicate(d, drafts, existing)]));
  const dupCount = [...duplicates.values()].filter(Boolean).length;
  const selected = drafts.filter((d) => d.include);
  const invalid = selected.find((d) => validateTrip(d.trip));

  const save = async () => {
    if (!selected.length || invalid || extracting) return;
    setSaving(true);
    setError(null);
    try {
      onSaved(await createTrips(selected.map((d) => d.trip)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div
      className="flex min-h-0 flex-1 flex-col"
      onKeyDown={(e) => {
        if (e.key !== "Escape") return;
        e.stopPropagation();
        if (confirmingLeave) setConfirmingLeave(false);
        else leave();
      }}
    >
      <div className="flex items-center justify-between px-4 py-3">
        <h2 className="font-serif text-base font-semibold text-ink">识别订单截图</h2>
        <button
          type="button"
          onClick={leave}
          className="flex items-center gap-1 rounded-full px-2.5 py-1 text-sm text-ink-soft transition-colors hover:bg-paper-200 hover:text-ink focus-visible:outline-2"
        >
          <svg viewBox="0 0 20 20" fill="currentColor" className="size-4" aria-hidden>
            <path d="M12.8 5.2a.75.75 0 0 1 0 1.06L9.06 10l3.74 3.74a.75.75 0 1 1-1.06 1.06l-4.27-4.27a.75.75 0 0 1 0-1.06l4.27-4.27a.75.75 0 0 1 1.06 0Z" />
          </svg>
          返回
        </button>
      </div>

      {confirmingLeave && (
        <div role="alert" className="mx-4 mb-3 rounded-xl bg-paper-100 p-3 ring-1 ring-paper-300">
          <p className="text-sm font-medium text-ink">{status === "extracting" ? "放弃这次识别？" : "放弃识别结果？"}</p>
          <p className="mt-0.5 text-xs text-ink-soft">
            {status === "extracting"
              ? `还有 ${extracting} 张截图在识别中，离开后结果不会保留。`
              : `识别到的 ${drafts.length} 条行程还没有保存，离开后需要重新上传。`}
          </p>
          <div className="mt-2.5 flex justify-end gap-2 text-sm">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-full px-3 py-1 text-danger transition-colors hover:bg-danger/8 focus-visible:outline-2"
            >
              放弃
            </button>
            <button
              type="button"
              autoFocus
              onClick={() => setConfirmingLeave(false)}
              className="rounded-full bg-ink px-3.5 py-1 text-paper-50 transition-colors hover:bg-ink-soft focus-visible:outline-2 focus-visible:outline-offset-2"
            >
              {status === "extracting" ? "继续等待" : "继续核对"}
            </button>
          </div>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-4 pb-4">
        <button
          type="button"
          disabled={saving}
          onClick={() => inputRef.current?.click()}
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles([...e.dataTransfer.files]);
          }}
          className={`group flex w-full items-center rounded-2xl border-[1.5px] border-dashed transition-colors duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 ${
            compact ? "flex-row gap-3 px-3 py-2 text-left" : "flex-col justify-center gap-2 px-4 py-6 text-center"
          } ${
            dragging ? "border-seal bg-seal/6" : "border-paper-300 bg-paper-100/60 hover:border-ink-faint/60 hover:bg-paper-100"
          } disabled:cursor-wait disabled:opacity-70`}
        >
          {/* A ticket stub. */}
          <svg
            viewBox="0 0 48 32"
            className={`${compact ? "h-6 w-9" : "h-9 w-14"} shrink-0 transition-transform duration-300 ease-out-expo group-hover:-rotate-6 ${dragging ? "-rotate-6 scale-110 text-seal" : "text-ink-soft"}`}
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinejoin="round"
            aria-hidden
          >
            <path d="M4 4h40v8a4 4 0 0 0 0 8v8H4v-8a4 4 0 0 0 0-8V4Z" />
            <path d="M32 6v20" strokeDasharray="2 2.5" />
            <path d="M11 13h14M11 19h9" strokeLinecap="round" />
          </svg>
          <span className="text-sm text-ink">
            {compact ? "继续添加截图" : "点击选择、拖入或直接粘贴（⌘/Ctrl+V）订单截图"}
            {!compact && <span className="mt-0.5 block text-xs text-ink-soft">可以一次选多张，最多 {MAX_SHOTS} 张</span>}
          </span>
          {!compact && <span className="text-xs text-ink-faint">机票、火车票、酒店、携程 / 飞猪 / 12306 等订单页面均可</span>}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT.join(",")}
          multiple
          className="hidden"
          onChange={(e) => {
            addFiles([...(e.target.files ?? [])]);
            e.target.value = "";
          }}
        />

        {shots.length > 0 && <ShotStrip shots={shots} onRetry={enqueue} />}

        <p role="status" className="text-sm text-ink-soft empty:hidden">
          {extracting > 0 &&
            `Claude 正在识别：已完成 ${shots.length - extracting} / ${shots.length} 张，每张通常需要 10–60 秒…`}
        </p>
        {notice && <p className="text-xs text-ink-soft">{notice}</p>}
        {failed.length > 0 && (
          <ul role="alert" className="space-y-0.5 rounded-xl bg-danger/8 px-3 py-2 text-xs text-danger ring-1 ring-danger/15">
            {failed.map((s) => (
              <li key={s.key}>
                第 {shots.indexOf(s) + 1} 张识别失败：{s.error}
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="rounded-xl bg-danger/8 px-3 py-2 text-sm text-danger ring-1 ring-danger/15">
            {error}
          </p>
        )}

        {drafts.length > 0 && (
          <section aria-label="识别结果" className="space-y-2">
            <p className="text-sm text-ink-soft">
              识别到 {drafts.length} 条行程
              {dupCount > 0 && `，其中 ${dupCount} 条疑似重复`}
              。地图上的虚线是勾选的行程，核对无误后保存：
            </p>
            <ul className="space-y-2">
              {drafts.map((d) => {
                const dup = duplicates.get(d.key);
                return (
                  <DraftCard
                    key={d.key}
                    draft={d}
                    duplicate={dup ? duplicateLabel(dup, drafts) : null}
                    onChange={(patch) => update(d.key, patch)}
                  />
                );
              })}
            </ul>
          </section>
        )}
      </div>

      {drafts.length > 0 && (
        <div className="border-t border-paper-200 p-4">
          <button
            type="button"
            onClick={save}
            disabled={!selected.length || !!invalid || saving || extracting > 0}
            className="w-full rounded-full bg-seal px-4 py-2.5 text-sm font-medium text-paper-50 shadow-[0_1px_2px_rgb(120_30_20/0.3),inset_0_1px_0_rgb(255_255_255/0.15)] transition-colors hover:bg-seal-deep focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:bg-paper-300 disabled:text-ink-faint disabled:shadow-none"
          >
            {saving
              ? "保存中…"
              : extracting
                ? `等待其余 ${extracting} 张识别完成…`
                : invalid
                ? "先修正标红的行程"
                : selected.length
                  ? `保存 ${selected.length} 条行程`
                  : "至少勾选一条行程"}
          </button>
        </div>
      )}
    </div>
  );
}
