"use client";

import type { Task } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { stageName, taskTag } from "@/lib/labels";
import { formatDate } from "./ui";

export function TaskRow({ task, onOpen, meta, active }: { task: Task; onOpen: () => void; meta?: string; active?: boolean }) {
  const t = useT();
  const s = taskTag(t, task.status);
  const detail = meta ?? (task.stage ? stageName(t, task.stage) : task.finished_at ? formatDate(task.finished_at) : null);
  return (
    <button
      type="button"
      onClick={onOpen}
      data-task-id={task.id}
      className={`group flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition ${active ? "border-accent bg-accent/8" : "border-line bg-white hover:border-ink/25"}`}
    >
      <span className="h-8 w-1 shrink-0 rounded-full" style={{ backgroundColor: s.color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-ink">{task.title}</span>
        <span className="mt-0.5 flex items-center gap-2 text-[11px] text-ink/50">
          <span style={{ color: s.color }} className="font-medium brightness-75">
            {s.label}
          </span>
          {detail && <span className="truncate">· {detail}</span>}
        </span>
      </span>
      <span className="text-ink/25 transition group-hover:translate-x-0.5 group-hover:text-ink/60">›</span>
    </button>
  );
}
