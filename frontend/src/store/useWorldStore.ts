import { create } from "zustand";
import { type WorldState, fetchState } from "@/lib/api";

/** Fallback only: server-sent events trigger refreshes as things happen. */
export const WORLD_POLL_MS = 15000;

type LoadStatus = "loading" | "ok" | "error";

type WorldStore = {
  world: WorldState | null;
  /** Server clock minus the browser clock, in ms: trips are timed on the server clock. */
  clockOffset: number;
  status: LoadStatus;
  lastUpdated: number | null;
  refresh: (signal?: AbortSignal) => Promise<void>;
  startPolling: () => () => void;
};

export const useWorldStore = create<WorldStore>((set, get) => ({
  world: null,
  clockOffset: 0,
  status: "loading",
  lastUpdated: null,

  refresh: async (signal) => {
    try {
      const sent = Date.now();
      const next = await fetchState(signal);
      const received = Date.now();
      const clockOffset = Date.parse(next.motion.server_time) - (sent + received) / 2;
      const prev = get().world;
      // The server time changes on every response; it alone is not a change of the world.
      const comparable = (w: WorldState) => JSON.stringify({ ...w, motion: { ...w.motion, server_time: "" } });
      const changed = prev === null || comparable(prev) !== comparable(next);
      set({ ...(changed ? { world: next } : {}), clockOffset, status: "ok", lastUpdated: received });
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
