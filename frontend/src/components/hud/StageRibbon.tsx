"use client";

import { TASK_STATUS, WAITING_FOR_MODEL } from "@/lib/labels";
import { RIBBON, ribbonState } from "@/lib/stages";
import { useTasksStore } from "@/store/useTasksStore";
import { findAgent } from "@/lib/world";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { HudBlock } from "./HudBlock";

/** Progress of the open task through its stages; hidden while no task is open. */
export function StageRibbon() {
  const taskId = useUiStore((s) => s.taskId);
  const task = useTasksStore((s) => s.tasks.find((t) => t.id === taskId));
  const world = useWorldStore((s) => s.world);
  if (!task) return null;
  const ownerTask = findAgent(world, task.agent_id)?.agent.current_task;
  const waiting = ownerTask?.id === task.id && ownerTask.waiting_for_model;

  const { current, complete, halted } = ribbonState(task.status, task.stage);
  const status = TASK_STATUS[task.status];
  const noteColor = waiting ? WAITING_FOR_MODEL.color : status.color;
  const note = waiting
    ? WAITING_FOR_MODEL.label.toLowerCase()
    : task.status === "paused" || task.status === "changes_requested" || halted
      ? status.label
      : null;

  return (
    <HudBlock
      id="ribbon"
      title="Этапы задачи"
      className="w-[560px] max-w-full"
      extra={<span className="truncate text-xs font-medium text-ink/70">{task.title}</span>}
    >
      <ol className="flex items-start px-3.5 pt-1 pb-3" data-testid="stage-ribbon" aria-label="Этапы задачи">
        {RIBBON.map((step, i) => {
          const passed = i < current || (complete && i === current);
          const isCurrent = i === current && !complete;
          const dot = halted && isCurrent ? "#5c6370" : passed ? "#2d323b" : isCurrent ? "#ff7a59" : "transparent";
          return (
            <li key={step.id} className="relative flex flex-1 flex-col items-center gap-1.5" data-state={passed ? "passed" : isCurrent ? "current" : "todo"} aria-current={isCurrent ? "step" : undefined}>
              {i > 0 && <span className={`absolute top-[9px] right-1/2 h-0.5 w-full ${i <= current ? (halted ? "bg-ink/25" : "bg-ink") : "bg-line"}`} />}
              <span
                className={`relative grid h-5 w-5 place-items-center rounded-full border-2 ${isCurrent && !halted ? "ring-4 ring-accent/20" : ""}`}
                style={{ backgroundColor: dot, borderColor: passed ? "#2d323b" : isCurrent ? dot : "#d9d2c5" }}
              >
                {passed && (
                  <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none" stroke="white" strokeWidth="2">
                    <path d="M2.5 6.2 5 8.5l4.5-5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className={`text-center text-[10.5px] leading-tight ${isCurrent ? "font-semibold text-ink" : passed ? "text-ink/75" : "text-ink/40"}`}>{step.label}</span>
              {isCurrent && note && (
                <span className="rounded-full px-1.5 text-[9.5px] font-medium" style={{ backgroundColor: `${noteColor}22`, color: noteColor }} data-note={note}>
                  <span className="brightness-75">{note}</span>
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </HudBlock>
  );
}
