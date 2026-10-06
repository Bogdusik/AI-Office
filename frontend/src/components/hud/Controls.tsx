"use client";

import { type FloorSelection, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

const pill =
  "rounded-full px-3.5 py-1.5 text-xs font-medium tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

export function Controls() {
  const floors = useWorldStore((s) => s.world?.floors);
  const selected = useUiStore((s) => s.selectedFloor);
  const selectFloor = useUiStore((s) => s.selectFloor);
  const requestHome = useUiStore((s) => s.requestHome);

  const numbers = (floors ?? []).map((f) => f.number).sort((a, b) => a - b);
  const options: { value: FloorSelection; label: string }[] = [
    { value: "all", label: "Все" },
    ...numbers.map((n) => ({ value: n, label: String(n) })),
  ];

  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 flex justify-center px-4">
      <div className="pointer-events-auto flex items-center gap-2 rounded-full border border-ink/10 bg-white/85 p-1.5 shadow-[0_8px_30px_-12px_rgba(20,22,31,0.35)] backdrop-blur">
        <span className="pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">Этаж</span>
        <div role="radiogroup" aria-label="Выбор этажа" className="flex gap-1">
          {options.map((o) => {
            const active = o.value === selected;
            return (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => selectFloor(o.value)}
                className={`${pill} ${active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5"}`}
              >
                {o.label}
              </button>
            );
          })}
        </div>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <button
          type="button"
          onClick={requestHome}
          aria-label="Вернуть камеру"
          title="Вернуть камеру"
          className={`${pill} flex items-center gap-1.5 text-ink/70 hover:bg-ink/5`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          Домой
        </button>
      </div>
    </div>
  );
}

export function PreviewBadge() {
  const preview = useUiStore((s) => s.preview);
  if (!preview) return null;
  return (
    <div className="pointer-events-none absolute top-4 left-1/2 -translate-x-1/2 rounded-full bg-accent px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.2em] text-white shadow">
      Preview — все на местах
    </div>
  );
}

export function WorldError() {
  const status = useWorldStore((s) => s.status);
  const hasWorld = useWorldStore((s) => s.world !== null);
  if (status !== "error" || hasWorld) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="rounded-lg bg-white/85 px-4 py-3 font-mono text-xs text-ink/70 shadow">
        Нет данных от /api/v1/state — запущен ли backend?
      </p>
    </div>
  );
}
