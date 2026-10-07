import { create } from "zustand";
import { api, type Task } from "@/lib/api";

type TasksStore = {
  tasks: Task[];
  loaded: boolean;
  /** Bumped after every change made from the UI so open detail views refetch. */
  revision: number;
  /** Per task: bumped when a running stage saved new partial text (only the open card refetches). */
  progress: Record<number, number>;
  refresh: () => Promise<void>;
  bump: () => void;
  tick: (taskId: number) => void;
};

let inflight: AbortController | null = null;

/** All tasks, reloaded when /state changes or after an action — not on every poll. */
export const useTasksStore = create<TasksStore>((set) => ({
  tasks: [],
  loaded: false,
  revision: 0,
  progress: {},
  refresh: async () => {
    inflight?.abort();
    const controller = (inflight = new AbortController());
    try {
      set({ tasks: await api.tasks(controller.signal), loaded: true });
    } catch (err) {
      if (!controller.signal.aborted) console.warn(err);
    }
  },
  bump: () => set((s) => ({ revision: s.revision + 1 })),
  tick: (taskId) => set((s) => ({ progress: { ...s.progress, [taskId]: (s.progress[taskId] ?? 0) + 1 } })),
}));
