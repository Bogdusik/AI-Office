import { useTasksStore } from "@/store/useTasksStore";
import { useWorldStore } from "@/store/useWorldStore";

/** Reload everything a change can touch right away, without waiting for the next poll. */
export async function refreshAll(): Promise<void> {
  useTasksStore.getState().bump();
  await Promise.all([useWorldStore.getState().refresh(), useTasksStore.getState().refresh()]);
}

/** Runs a write and refreshes afterwards — also on failure, since a 409 usually means our data is stale. */
export async function mutate<T>(action: () => Promise<T>): Promise<T> {
  try {
    return await action();
  } finally {
    await refreshAll();
  }
}
