"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Task, TaskStatus } from "@/lib/api";
import { useT } from "@/lib/i18n";
import { agentTag, stageName, taskTag } from "@/lib/labels";
import { allAgents, findAgent } from "@/lib/world";
import { useTasksStore } from "@/store/useTasksStore";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { HudBlock } from "./HudBlock";

type Tab = "agents" | "tasks" | "review";

/** Active work first, then the most recently finished. */
const ORDER: Record<TaskStatus, number> = {
  in_progress: 0,
  changes_requested: 1,
  needs_review: 2,
  paused: 3,
  queued: 4,
  done: 5,
  failed: 5,
  cancelled: 5,
};

function Row({ color, title, sub, tag, active, onClick, testId }: { color: string; title: string; sub: string; tag: string; active: "strong" | "soft" | null; onClick: () => void; testId: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active === "strong") ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [active]);
  return (
    <button
      ref={ref}
      type="button"
      onClick={onClick}
      data-testid={testId}
      data-active={active ?? undefined}
      className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left transition ${
        active === "strong" ? "bg-accent/12 ring-1 ring-accent" : active === "soft" ? "bg-accent/5" : "hover:bg-ink/4"
      }`}
    >
      <span className="h-7 w-1 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-medium text-ink">{title}</span>
        <span className="block truncate text-[11px] text-ink/50">{sub}</span>
      </span>
      <span className="shrink-0 rounded-full px-2 py-px text-[10px] font-medium whitespace-nowrap" style={{ backgroundColor: `${color}22`, color }}>
        <span className="brightness-75">{tag}</span>
      </span>
    </button>
  );
}

export function ListDock() {
  const t = useT();
  const world = useWorldStore((s) => s.world);
  const tasks = useTasksStore((s) => s.tasks);
  const selection = useUiStore((s) => s.selection);
  const taskId = useUiStore((s) => s.taskId);
  const focusOn = useUiStore((s) => s.focusOn);
  const openTask = useUiStore((s) => s.openTask);
  const [tab, setTab] = useState<Tab>("agents");

  const agents = allAgents(world);
  const selectedAgent = selection?.kind === "agent" ? selection.id : null;

  const visible = useMemo(() => {
    const known = tasks.filter((t) => findAgent(world, t.agent_id));
    return {
      tasks: [...known].sort((a, b) => ORDER[a.status] - ORDER[b.status] || (b.finished_at ?? "").localeCompare(a.finished_at ?? "") || a.position - b.position),
      review: known.filter((t) => t.status === "needs_review"),
    };
  }, [tasks, world]);

  const goTask = (task: Task) => {
    const located = findAgent(world, task.agent_id);
    if (!located) return;
    focusOn({ kind: "agent", id: task.agent_id }, located.floor.number);
    openTask(task.id);
  };

  const taskRow = (task: Task) => {
    const s = taskTag(t, task.status);
    const owner = findAgent(world, task.agent_id)?.agent;
    const active = task.id === taskId ? "strong" : task.agent_id === selectedAgent && taskId === null ? "soft" : null;
    return (
      <Row
        key={task.id}
        testId={`row-task-${task.id}`}
        color={s.color}
        title={task.title}
        sub={`${owner?.title ?? ""}${task.stage ? ` · ${stageName(t, task.stage)}` : ""}`}
        tag={s.label}
        active={active}
        onClick={() => goTask(task)}
      />
    );
  };

  const tabs: { id: Tab; label: string; count: number }[] = [
    { id: "agents", label: t("list.agents"), count: agents.length },
    { id: "tasks", label: t("list.tasks"), count: visible.tasks.length },
    { id: "review", label: t("list.review"), count: visible.review.length },
  ];

  return (
    <HudBlock
      id="list"
      title={t("list.title")}
      className="max-h-[min(420px,calc(100dvh-140px))] w-[360px]"
      extra={
        <div role="tablist" className="flex gap-0.5 rounded-full bg-ink/5 p-0.5">
          {tabs.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium whitespace-nowrap transition ${tab === item.id ? "bg-white text-ink shadow-sm" : "text-ink/55 hover:text-ink"}`}
            >
              {item.label} <span className="font-mono opacity-50">{item.count}</span>
            </button>
          ))}
        </div>
      }
    >
      <div className="flex min-h-0 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {tab === "agents" &&
          agents.map(({ agent, floor }) => {
            const s = agentTag(t, agent);
            const current = agent.current_task;
            return (
              <Row
                key={agent.id}
                testId={`row-agent-${agent.id}`}
                color={s.color}
                title={`${agent.title} · ${agent.name}`}
                sub={current ? `${taskTag(t, current.status).label}: ${current.title}` : t("list.noTask", { floor: floor.number })}
                tag={s.label}
                active={agent.id === selectedAgent ? "strong" : null}
                onClick={() => focusOn({ kind: "agent", id: agent.id }, floor.number)}
              />
            );
          })}
        {tab === "tasks" && (visible.tasks.length ? visible.tasks.map(taskRow) : <p className="px-2.5 py-3 text-xs text-ink/45">{t("list.noTasks")}</p>)}
        {tab === "review" && (visible.review.length ? visible.review.map(taskRow) : <p className="px-2.5 py-3 text-xs text-ink/45">{t("list.nothingToReview")}</p>)}
      </div>
    </HudBlock>
  );
}
