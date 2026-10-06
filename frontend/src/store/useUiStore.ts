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
  selectFloor: (selectedFloor) => set({ selectedFloor }),
  setPreview: (preview) => set({ preview }),
  setRoutes: (routes) => set({ routes }),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1 })),
  select: (selection) =>
    set((s) => {
      const same = s.selection && selection && selectionKey(s.selection) === selectionKey(selection);
      return { selection, taskId: same ? s.taskId : null };
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
