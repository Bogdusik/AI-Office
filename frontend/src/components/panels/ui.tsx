"use client";

import { type ButtonHTMLAttributes, type ReactNode, useState } from "react";

/** Right panel width; the HUD keeps clear of it while it is open. */
export const PANEL_WIDTH = 420;

export const card = "rounded-2xl border border-line bg-white/90 shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur";

export const inputCls =
  "w-full rounded-lg border border-line bg-paper/60 px-3 py-2 text-sm text-ink placeholder:text-ink/35 outline-none transition focus:border-accent focus:bg-white focus:ring-2 focus:ring-accent/20";

export function Pill({ label, color, size = "sm" }: { label: string; color: string; size?: "sm" | "xs" }) {
  return (
    <span
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-full font-medium whitespace-nowrap ${size === "sm" ? "px-2.5 py-0.5 text-xs" : "px-2 py-px text-[11px]"}`}
      style={{ backgroundColor: `${color}1f`, color: shade(color) }}
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

/** Darker text shade of a status colour so pale tags stay readable on white. */
function shade(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const f = (v: number) => Math.round(v * 0.62).toString(16).padStart(2, "0");
  return `#${f(n >> 16)}${f((n >> 8) & 255)}${f(n & 255)}`;
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" | "outline"; busy?: boolean };

export function Button({ variant = "outline", busy, disabled, className = "", children, ...rest }: ButtonProps) {
  const look = {
    primary: "bg-ink text-paper hover:bg-ink/85",
    outline: "border border-line bg-white text-ink hover:border-ink/30",
    ghost: "text-ink/65 hover:bg-ink/5 hover:text-ink",
    danger: "border border-signal-down/40 bg-white text-signal-down hover:bg-signal-down hover:text-white",
  }[variant];
  return (
    <button
      type="button"
      disabled={disabled || busy}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${look} ${className}`}
      {...rest}
    >
      {busy ? "…" : children}
    </button>
  );
}

/** Two-step button for destructive actions: the first click asks, the second does. */
export function ConfirmButton({ label, question, onConfirm, busy }: { label: string; question: string; onConfirm: () => void; busy?: boolean }) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <Button variant="danger" onClick={() => setAsking(true)} busy={busy}>
        {label}
      </Button>
    );
  return (
    <div role="alertdialog" className="flex items-center gap-2 rounded-lg border border-signal-down/30 bg-signal-down/5 px-2.5 py-1.5 text-sm">
      <span className="text-ink/80">{question}</span>
      <Button
        variant="danger"
        className="!px-2 !py-0.5"
        onClick={() => {
          setAsking(false);
          onConfirm();
        }}
      >
        Да
      </Button>
      <Button variant="ghost" className="!px-2 !py-0.5" onClick={() => setAsking(false)}>
        Нет
      </Button>
    </div>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium text-ink/60">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-ink/40">{hint}</span>}
    </label>
  );
}

export function ErrorNote({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p role="alert" className="rounded-lg border border-signal-down/25 bg-signal-down/8 px-3 py-2 text-sm text-[#a53535]">
      {text}
    </p>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-ink/45">{children}</p>;
}

export function Section({ title, count, children, action }: { title: string; count?: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="flex items-baseline gap-2 text-[13px] font-semibold text-ink">
          {title}
          {count !== undefined && <span className="font-mono text-[11px] font-normal text-ink/40">{count}</span>}
        </h3>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed border-line px-3 py-2.5 text-xs text-ink/45">{children}</p>;
}

export function CloseButton({ onClick, label = "Закрыть" }: { onClick: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={`${label} (Esc)`}
      className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-ink/50 transition hover:bg-ink/5 hover:text-ink"
    >
      <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** Right-hand panel over the scene. */
export function PanelShell({ eyebrow, title, subtitle, onClose, children, testId }: { eyebrow: ReactNode; title: ReactNode; subtitle?: ReactNode; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <aside
      data-testid={testId}
      className={`${card} pointer-events-auto absolute top-4 right-4 bottom-4 flex flex-col overflow-hidden`}
      style={{ width: PANEL_WIDTH }}
    >
      <header className="flex items-start gap-3 border-b border-line px-5 pt-4 pb-3.5">
        <div className="min-w-0 flex-1">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h2 className="mt-1 text-lg leading-tight font-semibold tracking-tight text-ink">{title}</h2>
          {subtitle && <div className="mt-0.5 text-sm text-ink/60">{subtitle}</div>}
        </div>
        <CloseButton onClick={onClose} />
      </header>
      <div className="flex flex-1 flex-col gap-5 overflow-y-auto px-5 py-4">{children}</div>
    </aside>
  );
}

const dateFmt = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
export const formatDate = (iso: string | null) => (iso ? dateFmt.format(new Date(iso)) : "—");
export const formatNumber = (n: number) => n.toLocaleString("ru-RU");
