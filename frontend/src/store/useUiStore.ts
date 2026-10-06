import { create } from "zustand";

export type FloorSelection = "all" | number;

type UiStore = {
  selectedFloor: FloorSelection;
  preview: boolean;
  routes: boolean;
  homeRequest: number;
  selectFloor: (floor: FloorSelection) => void;
  setPreview: (preview: boolean) => void;
  setRoutes: (routes: boolean) => void;
  requestHome: () => void;
};

export const useUiStore = create<UiStore>((set) => ({
  selectedFloor: "all",
  preview: false,
  routes: false,
  homeRequest: 0,
  selectFloor: (selectedFloor) => set({ selectedFloor }),
  setPreview: (preview) => set({ preview }),
  setRoutes: (routes) => set({ routes }),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1 })),
}));

export function isFloorVisible(floorNumber: number, selected: FloorSelection): boolean {
  return selected === "all" || floorNumber <= selected;
}
