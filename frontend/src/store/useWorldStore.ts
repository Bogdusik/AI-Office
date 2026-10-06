import { create } from "zustand";
import { fetchState, type WorldState } from "@/lib/api";

/** Fallback only: server-sent events trigger refreshes as things happen. */
export const WORLD_POLL_MS = 15000;

type LoadStatus = "loading" | "ok" | "error";

type WorldStore = {
  world: WorldState | null;
  status: LoadStatus;
  lastUpdated: number | null;
  refresh: (signal?: AbortSignal) => Promise<void>;
  startPolling: () => () => void;
};

export const useWorldStore = create<WorldStore>((set, get) => ({
  world: null,
  status: "loading",
  lastUpdated: null,

  refresh: async (signal) => {
    try {
      const next = await fetchState(signal);
      const prev = get().world;
      const changed = prev === null || JSON.stringify(prev) !== JSON.stringify(next);
      set({ ...(changed ? { world: next } : {}), status: "ok", lastUpdated: Date.now() });
    } catch (err) {
      if (signal?.aborted) return;
      console.warn(err);
      set({ status: "error" });
    }
  },

  startPolling: () => {
    let controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const tick = async () => {
      controller = new AbortController();
      await get().refresh(controller.signal);
      if (!stopped) timer = setTimeout(tick, WORLD_POLL_MS);
    };
    void tick();

    return () => {
      stopped = true;
      controller.abort();
      if (timer) clearTimeout(timer);
    };
  },
}));
