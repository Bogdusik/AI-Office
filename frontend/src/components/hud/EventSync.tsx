"use client";

import { useEffect } from "react";
import { API_URL } from "@/lib/config";
import { refreshAll } from "@/store/actions";
import { useNotifyStore } from "@/store/useNotifyStore";
import { useTasksStore } from "@/store/useTasksStore";

/** Coalesces bursts of events (a stage switch emits several) into one refresh. */
const DEBOUNCE_MS = 80;

type TaskEvent = { id: number; agent_id: number; title: string; status: string; stage: string | null };

/** Live updates over SSE: any agent/task/result event refreshes the stores; polling stays as a fallback. */
export function EventSync() {
  const push = useNotifyStore((s) => s.push);

  useEffect(() => {
    const source = new EventSource(`${API_URL}/api/v1/events`);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshAll(), DEBOUNCE_MS);
    };
    const onTask = (e: MessageEvent<string>) => {
      schedule();
      const task = JSON.parse(e.data) as TaskEvent;
      if (task.status === "needs_review") push({ taskId: task.id, agentId: task.agent_id, title: task.title });
    };

    source.onopen = schedule;
    source.addEventListener("agent", schedule);
    source.addEventListener("artifact", schedule);
    source.addEventListener("run", schedule);
    source.addEventListener("progress", (e: MessageEvent<string>) => {
      const { task_id } = JSON.parse(e.data) as { task_id: number };
      useTasksStore.getState().tick(task_id);
    });
    source.addEventListener("task", onTask);
    return () => {
      clearTimeout(timer);
      source.close();
    };
  }, [push]);

  return null;
}
