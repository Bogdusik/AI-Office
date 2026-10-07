"use client";

import { useEffect, useState } from "react";
import { type LlmStatus, api } from "@/lib/api";

const POLL_MS = 10_000;

const DOT = {
  ok: "bg-signal-ok shadow-[0_0_10px_var(--color-signal-ok)]",
  down: "bg-signal-down shadow-[0_0_10px_var(--color-signal-down)]",
  fake: "bg-ink/30",
  checking: "bg-ink/20",
};

/** HUD dot for the model: green — ready, red — Ollama down or model missing, grey — fake worker. */
export function ModelStatus() {
  const [status, setStatus] = useState<LlmStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      try {
        const next = await api.llmStatus();
        if (active) {
          setStatus(next);
          setFailed(false);
        }
      } catch {
        if (active) setFailed(true);
      }
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, []);

  const state = failed ? "checking" : !status ? "checking" : status.worker === "fake" ? "fake" : status.ok ? "ok" : "down";
  const label = status?.worker === "fake" ? "fake" : (status?.model ?? "модель");
  const title = status?.message ?? (status?.loaded ? "Модель загружена в видеопамять" : status?.ok ? "Модель скачана, загрузится при первом запросе" : "Проверка модели…");

  return (
    <div
      data-testid="model-status"
      data-state={state}
      title={title}
      className="pointer-events-auto flex items-center gap-2 rounded-full border border-line bg-white/90 px-3 py-1.5 font-mono text-xs tracking-wide whitespace-nowrap text-ink shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[state]}`} />
      {label}
      {state === "down" && <span className="font-sans text-[11px] text-signal-down">{status?.ollama === false ? "Ollama не отвечает" : "нет модели"}</span>}
    </div>
  );
}
