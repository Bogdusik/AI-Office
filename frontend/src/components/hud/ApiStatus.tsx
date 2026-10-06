"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/config";
import { useApiStore, type ApiState } from "@/store/useApiStore";

const POLL_MS = 5000;

type HealthResponse = { status: string; db: boolean };

async function checkHealth(): Promise<ApiState> {
  try {
    const res = await fetch(`${API_URL}/health`, { cache: "no-store" });
    if (!res.ok) return "down";
    const body = (await res.json()) as HealthResponse;
    return body.status === "ok" ? "ok" : "down";
  } catch {
    return "down";
  }
}

const LABEL: Record<ApiState, string> = {
  checking: "API: …",
  ok: "API: ok",
  down: "API: нет связи",
};

const DOT: Record<ApiState, string> = {
  checking: "bg-ink/30",
  ok: "bg-signal-ok shadow-[0_0_10px_var(--color-signal-ok)]",
  down: "bg-signal-down shadow-[0_0_10px_var(--color-signal-down)]",
};

export function ApiStatus() {
  const status = useApiStore((s) => s.status);
  const setStatus = useApiStore((s) => s.setStatus);

  useEffect(() => {
    let active = true;
    const tick = async () => {
      const next = await checkHealth();
      if (active) setStatus(next);
    };
    void tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      active = false;
      clearInterval(id);
    };
  }, [setStatus]);

  return (
    <div
      data-testid="api-status"
      className="pointer-events-none flex items-center gap-2 rounded-full border border-line bg-white/90 px-3 py-1.5 font-mono text-xs tracking-wide whitespace-nowrap text-ink shadow-[0_12px_40px_-18px_rgba(20,22,31,0.45)] backdrop-blur"
    >
      <span className={`h-2 w-2 rounded-full ${DOT[status]}`} />
      {LABEL[status]}
    </div>
  );
}
