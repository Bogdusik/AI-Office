"use client";

import { IN_OFFICE } from "@/lib/labels";
import { allAgents } from "@/lib/world";
import { useWorldStore } from "@/store/useWorldStore";
import { HudBlock } from "./HudBlock";

function Metric({ id, label, value, total, color }: { id: string; label: string; value: number | null; total?: number; color: string }) {
  return (
    <div data-testid={`metric-${id}`} className="relative overflow-hidden rounded-xl border border-line bg-white px-3 pt-2.5 pb-2">
      <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full" style={{ backgroundColor: color }} />
      <p className="min-h-[2.3em] text-[11px] leading-tight text-ink/55">{label}</p>
      <p className="mt-1 flex items-baseline gap-1 font-mono text-2xl font-semibold tracking-tight text-ink tabular-nums">
        <span data-value>{value ?? "—"}</span>
        {total !== undefined && <span className="text-sm font-normal text-ink/35">/ {total}</span>}
      </p>
    </div>
  );
}

/** Headline numbers; every one comes from /state, nothing is estimated on the client. */
export function Metrics() {
  const world = useWorldStore((s) => s.world);
  const agents = allAgents(world);
  const stats = world?.stats;
  return (
    <HudBlock id="metrics" title="Показатели">
      <div className="grid grid-cols-2 gap-2 px-3 pb-3">
        <Metric id="office" label="Сотрудников в офисе" value={world ? agents.filter((a) => IN_OFFICE.has(a.agent.status)).length : null} total={agents.length} color="#2fbf83" />
        <Metric id="in-progress" label="Задач в работе" value={stats?.tasks_in_progress ?? null} color="#f0a020" />
        <Metric id="review" label="Ждут моей проверки" value={stats?.awaiting_review ?? null} color="#8b6cf0" />
        <Metric id="done-today" label="Завершено сегодня" value={stats?.done_today ?? null} color="#2d323b" />
      </div>
    </HudBlock>
  );
}
