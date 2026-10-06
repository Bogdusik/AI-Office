import { create } from "zustand";

export type FloorSelection = "all" | number;

type UiStore = {
  selectedFloor: FloorSelection;
  preview: boolean;
  homeRequest: number;
  selectFloor: (floor: FloorSelection) => void;
  setPreview: (preview: boolean) => void;
  requestHome: () => void;
};

export const useUiStore = create<UiStore>((set) => ({
  selectedFloor: "all",
  preview: false,
  homeRequest: 0,
  selectFloor: (selectedFloor) => set({ selectedFloor }),
  setPreview: (preview) => set({ preview }),
  requestHome: () => set((s) => ({ homeRequest: s.homeRequest + 1 })),
}));

export function isFloorVisible(floorNumber: number, selected: FloorSelection): boolean {
  return selected === "all" || floorNumber <= selected;
}
