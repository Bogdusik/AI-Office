import { create } from "zustand";
import { type Selection, selectionKey } from "@/scene/layout";

export type FloorSelection = "all" | number;

export type HudBlock = "metrics" | "list" | "ribbon";

type UiStore = {
  selectedFloor: FloorSelection;
  preview: boolean;
  routes: boolean;
  homeRequest: number;
  /** What the director picked; the scene only reads it. */
  selection: Selection | null;
  hovered: string | null;
  taskId: number | null;
  directorOpen: boolean;
  /** Camera flight request: the scene resolves the key to a position once that object is visible. */
  focus: { key: string; nonce: number } | null;
  collapsed: Record<HudBlock, boolean>;
  /** Animated arrivals and departures; off: people and cars simply appear and disappear (stage 6). */
  animation: boolean;
  /** Office life on top of the animation (coffee, lounge, strolls, talks); off: everyone at their desk. */
  life: boolean;
  setLife: (on: boolean) => void;
  /** Agent the camera follows (person or car), if any. */
  follow: number | null;
  setAnimation: (on: boolean) => void;
  setFollow: (agentId: number | null) => void;
  selectFloor: (floor: FloorSelection) => void;
  setPreview: (preview: boolean) => void;
  setRoutes: (routes: boolean) => void;
  requestHome: () => void;
  select: (selection: Selection | null) => void;
  hover: (key: string | null) => void;
  openTask: (taskId: number | null) => void;
  setDirectorOpen: (open: boolean) => void;
  /** Select, show the object's floor and fly the camera to it. */
  focusOn: (selection: Selection, floorNumber: number | null) => void;
  toggle: (block: HudBlock) => void;
  /** Esc: closes the innermost layer only. */
  back: () => void;
};

const ANIMATION_KEY = "ai-office:animation";
const LIFE_KEY = "ai-office:life";

/** The director's last choice for office life (read after hydration, like `storedAnimation`). */
export function storedLife(): boolean {
  try {
    return localStorage.getItem(LIFE_KEY) !== "0";
  } catch {
    return true;
  }
}

/** The director's last choice, read after hydration (the server always renders with animation on). */
export function storedAnimation(): boolean {
  try {
    return localStorage.getItem(ANIMATION_KEY) !== "0";
  } catch {
    return true;
  }
}

export const useUiStore = create<UiStore>((set, get) => ({
  selectedFloor: "all",
  preview: false,
  routes: false,
  homeRequest: 0,
  selection: null,
  hovered: null,
  taskId: null,
  directorOpen: false,
  focus: null,
  collapsed: { metrics: false, list: false, ribbon: false },
  animation: true,
  life: true,
  setLife: (life) => {
    try {
      localStorage.setItem(LIFE_KEY, life ? "1" : "0");
    } catch {}
    set({ life });
  },
  follow: null,
  setAnimation: (animation) => {
    try {
      localStorage.setItem(ANIMATION_KEY, animation ? "1" : "0");
    } catch {}
    set({ animation, follow: animation ? get().follow : null });
  },
  setFollow: (follow) => set({ follow }),
  selectFloor: (selectedFloor) => set({ selectedFloor }),
  setPreview: (preview) => set({ preview }),
  setRoutes: (routes) => set({ routes }),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1, follow: null })),
  select: (selection) =>
    set((s) => {
      const same = s.selection && selection && selectionKey(s.selection) === selectionKey(selection);
      const keepFollow = selection?.kind === "agent" && selection.id === s.follow;
      return { selection, taskId: same ? s.taskId : null, follow: keepFollow ? s.follow : null };
    }),
  hover: (hovered) => {
    if (get().hovered !== hovered) set({ hovered });
  },
  openTask: (taskId) => set({ taskId }),
  setDirectorOpen: (directorOpen) => set({ directorOpen }),
  focusOn: (selection, floorNumber) => {
    get().select(selection);
    set((s) => ({
      selectedFloor: floorNumber ?? s.selectedFloor,
      focus: { key: selectionKey(selection), nonce: (s.focus?.nonce ?? 0) + 1 },
    }));
  },
  toggle: (block) => set((s) => ({ collapsed: { ...s.collapsed, [block]: !s.collapsed[block] } })),
  back: () => {
    const s = get();
    if (s.directorOpen) set({ directorOpen: false, selection: s.selection?.kind === "director" ? null : s.selection });
    else if (s.taskId !== null) set({ taskId: null });
    else if (s.selection) set({ selection: null });
  },
}));

export function isFloorVisible(floorNumber: number, selected: FloorSelection): boolean {
  return selected === "all" || floorNumber <= selected;
}
