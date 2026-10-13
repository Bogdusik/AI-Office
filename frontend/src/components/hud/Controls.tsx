"use client";

import { useEffect } from "react";
import { FPS_OPTIONS } from "@/lib/frameRate";
import { LANGS, useLangStore, useT } from "@/lib/i18n";
import { type FloorSelection, useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";

const pill =
  "rounded-full px-3.5 py-1.5 text-xs font-medium whitespace-nowrap tracking-wide transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent";

/** 15 | 30 | 60: how often the scene is drawn (fewer frames leave the graphics card to the model). */
function FpsSwitch() {
  const t = useT();
  const fps = useUiStore((s) => s.fps);
  const setFps = useUiStore((s) => s.setFps);
  return (
    <div role="radiogroup" aria-label={t("hud.fpsChoice")} title={t("hud.fpsChoice")} className="flex items-center gap-0.5 rounded-full bg-ink/5 p-0.5" data-testid="fps-switch">
      <span className="px-1.5 font-mono text-[9px] tracking-[0.14em] text-ink/45 uppercase">{t("hud.fps")}</span>
      {FPS_OPTIONS.map((value) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={fps === value}
          onClick={() => setFps(value)}
          className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold transition ${fps === value ? "bg-white text-ink shadow-sm" : "text-ink/45 hover:text-ink"}`}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

/** EN | RU: the interface language, remembered in the browser (English until changed). */
function LanguageSwitch() {
  const t = useT();
  const lang = useLangStore((s) => s.lang);
  const setLang = useLangStore((s) => s.setLang);
  const restore = useLangStore((s) => s.restore);
  useEffect(() => restore(), [restore]);
  return (
    <div role="radiogroup" aria-label={t("common.language")} title={t("common.language")} className="flex gap-0.5 rounded-full bg-ink/5 p-0.5" data-testid="language-switch">
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          role="radio"
          aria-checked={lang === l}
          onClick={() => setLang(l)}
          className={`rounded-full px-2 py-1 font-mono text-[10px] font-semibold tracking-wider uppercase transition ${lang === l ? "bg-white text-ink shadow-sm" : "text-ink/45 hover:text-ink"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

export function FloorControls() {
  const t = useT();
  const floors = useWorldStore((s) => s.world?.floors);
  const selected = useUiStore((s) => s.selectedFloor);
  const selectFloor = useUiStore((s) => s.selectFloor);
  const requestHome = useUiStore((s) => s.requestHome);
  const animation = useUiStore((s) => s.animation);
  const setAnimation = useUiStore((s) => s.setAnimation);
  const life = useUiStore((s) => s.life);
  const setLife = useUiStore((s) => s.setLife);

  const numbers = (floors ?? []).map((f) => f.number).sort((a, b) => a - b);
  const options: { value: FloorSelection; label: string }[] = [
    { value: "all", label: t("hud.allFloors") },
    ...numbers.map((n) => ({ value: n, label: String(n) })),
  ];

  return (
    <div data-testid="floor-controls" className="pointer-events-auto flex w-fit items-center gap-2 rounded-full border border-line bg-white/90 p-1.5 shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur">
        <span className="pl-2.5 pr-1 font-mono text-[10px] uppercase tracking-[0.18em] text-ink/45">{t("hud.floor")}</span>
        <div role="radiogroup" aria-label={t("hud.floorChoice")} className="flex gap-1">
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
          aria-label={t("hud.homeTitle")}
          title={t("hud.homeTitle")}
          className={`${pill} flex items-center gap-1.5 text-ink/70 hover:bg-ink/5`}
        >
          <svg viewBox="0 0 16 16" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M2.5 7.5 8 3l5.5 4.5M4 6.5V13h8V6.5" strokeLinejoin="round" strokeLinecap="round" />
          </svg>
          {t("hud.home")}
        </button>
        <button
          type="button"
          onClick={() => setAnimation(!animation)}
          aria-pressed={animation}
          title={animation ? t("hud.animationOn") : t("hud.animationOff")}
          className={`${pill} flex items-center gap-1.5 ${animation ? "text-ink/80 hover:bg-ink/5" : "text-ink/45 hover:bg-ink/5"}`}
        >
          <span className={`h-2 w-2 rounded-full ${animation ? "bg-accent" : "bg-ink/25"}`} />
          {t("hud.animation")}
        </button>
        <button
          type="button"
          onClick={() => setLife(!life)}
          aria-pressed={life}
          disabled={!animation}
          title={life ? t("hud.lifeOn") : t("hud.lifeOff")}
          className={`${pill} flex items-center gap-1.5 disabled:opacity-40 ${life && animation ? "text-ink/80 hover:bg-ink/5" : "text-ink/45 hover:bg-ink/5"}`}
        >
          <span className={`h-2 w-2 rounded-full ${life && animation ? "bg-accent" : "bg-ink/25"}`} />
          {t("hud.life")}
        </button>
        <span className="mx-1 h-5 w-px bg-ink/10" />
        <FpsSwitch />
        <LanguageSwitch />
    </div>
  );
}

export function PreviewBadge() {
  const preview = useUiStore((s) => s.preview);
  if (!preview) return null;
  return (
    <div className="pointer-events-none rounded-full bg-accent px-3 py-1.5 font-mono text-[10px] font-semibold whitespace-nowrap uppercase tracking-[0.2em] text-white shadow">
      Preview
    </div>
  );
}

export function WorldError() {
  const t = useT();
  const status = useWorldStore((s) => s.status);
  const hasWorld = useWorldStore((s) => s.world !== null);
  if (status !== "error" || hasWorld) return null;
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <p className="rounded-lg bg-white/85 px-4 py-3 font-mono text-xs text-ink/70 shadow">
        {t("api.noState")}
      </p>
    </div>
  );
}
