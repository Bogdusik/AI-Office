import { create } from "zustand";

export type ApiState = "checking" | "ok" | "down";

type ApiStore = {
  status: ApiState;
  setStatus: (status: ApiState) => void;
};

export const useApiStore = create<ApiStore>((set) => ({
  status: "checking",
  setStatus: (status) => set({ status }),
}));
