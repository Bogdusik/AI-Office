"use client";

import type { ReactNode } from "react";
import { card } from "@/components/panels/ui";
import { type HudBlock as BlockId, useUiStore } from "@/store/useUiStore";

/** A HUD card that folds down to its title bar. */
export function HudBlock({ id, title, extra, children, className = "" }: { id: BlockId; title: string; extra?: ReactNode; children: ReactNode; className?: string }) {
  const collapsed = useUiStore((s) => s.collapsed[id]);
  const toggle = useUiStore((s) => s.toggle);
  return (
    <section data-testid={`hud-${id}`} className={`${card} pointer-events-auto flex min-h-0 flex-col overflow-hidden ${collapsed ? "w-fit" : ""} ${className}`}>
      <header className="flex items-center gap-2 px-3.5 py-2">
        <h2 className="font-mono text-[10px] tracking-[0.2em] whitespace-nowrap text-ink/50 uppercase">{title}</h2>
        <div className="flex min-w-0 flex-1 items-center justify-end gap-2">{!collapsed && extra}</div>
        <button
          type="button"
          onClick={() => toggle(id)}
          aria-expanded={!collapsed}
          aria-label={collapsed ? `Развернуть: ${title}` : `Свернуть: ${title}`}
          title={collapsed ? "Развернуть" : "Свернуть"}
          className="grid h-6 w-6 place-items-center rounded-full text-ink/45 transition hover:bg-ink/5 hover:text-ink"
        >
          <svg viewBox="0 0 16 16" className={`h-3 w-3 transition ${collapsed ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </header>
      {!collapsed && children}
    </section>
  );
}
