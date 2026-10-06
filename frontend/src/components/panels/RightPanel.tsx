"use client";

import { findAgent } from "@/lib/world";
import { useUiStore } from "@/store/useUiStore";
import { useWorldStore } from "@/store/useWorldStore";
import { AgentPanel } from "./AgentPanel";
import { HirePanel } from "./HirePanel";
import { SpotPanel } from "./SpotPanel";
import { TaskCard } from "./TaskCard";

/** Whether a right panel is showing — the HUD moves out of its way. */
export function useRightPanelOpen(): boolean {
  const selection = useUiStore((s) => s.selection);
  const taskId = useUiStore((s) => s.taskId);
  const world = useWorldStore((s) => s.world);
  if (!world) return false;
  if (taskId !== null) return true;
  switch (selection?.kind) {
    case "agent":
      return findAgent(world, selection.id) !== null;
    case "desk": {
      const floor = world.floors.find((f) => f.id === selection.floorId);
      return !!floor && !floor.agents.some((a) => a.desk_index === selection.deskIndex);
    }
    case "spot":
      return true;
    default:
      return false;
  }
}

/** The panel for whatever is selected; selection lives in the UI store. */
export function RightPanel() {
  const selection = useUiStore((s) => s.selection);
  const taskId = useUiStore((s) => s.taskId);
  const world = useWorldStore((s) => s.world);
  if (!world) return null;

  if (taskId !== null) {
    const located = selection?.kind === "agent" ? findAgent(world, selection.id) : null;
    return <TaskCard key={taskId} taskId={taskId} located={located} />;
  }
  switch (selection?.kind) {
    case "agent": {
      const located = findAgent(world, selection.id);
      return located ? <AgentPanel key={selection.id} located={located} /> : null;
    }
    case "desk": {
      const floor = world.floors.find((f) => f.id === selection.floorId);
      const taken = floor?.agents.some((a) => a.desk_index === selection.deskIndex);
      return floor && !taken ? <HirePanel key={`${floor.id}:${selection.deskIndex}`} floor={floor} deskIndex={selection.deskIndex} /> : null;
    }
    case "spot":
      return <SpotPanel world={world} index={selection.index} />;
    default:
      return null;
  }
}
