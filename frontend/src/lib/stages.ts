import type { TaskStage, TaskStatus } from "@/lib/api";

/** Ribbon steps: a task status or a work stage; labels come from `taskStatus` / `taskStage` in the dictionaries. */
export const RIBBON = [
  { id: "queued", kind: "status" },
  { id: "plan", kind: "stage" },
  { id: "research", kind: "stage" },
  { id: "draft", kind: "stage" },
  { id: "self_check", kind: "stage" },
  { id: "needs_review", kind: "status" },
  { id: "done", kind: "status" },
] as const;

const WORK_STAGES: TaskStage[] = ["plan", "research", "draft", "self_check"];
const workStep = (stage: TaskStage | null) => (stage ? 1 + WORK_STAGES.indexOf(stage) : 1);

/**
 * Where a task stands on the ribbon: steps before `current` are passed, `current` is highlighted.
 * `halted` marks a task that left the normal flow (cancelled/failed) at that step.
 */
export type RibbonState = { current: number; complete: boolean; halted: boolean };

export function ribbonState(status: TaskStatus, stage: TaskStage | null): RibbonState {
  switch (status) {
    case "queued":
      return { current: 0, complete: false, halted: false };
    case "in_progress":
    case "paused":
    case "changes_requested":
      return { current: workStep(stage), complete: false, halted: false };
    case "needs_review":
      return { current: 5, complete: false, halted: false };
    case "done":
      return { current: 6, complete: true, halted: false };
    case "failed":
    case "cancelled":
      return { current: stage ? workStep(stage) : 0, complete: false, halted: true };
  }
}
