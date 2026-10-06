import { create } from "zustand";

export type Notice = { id: number; taskId: number; agentId: number; title: string };

type NotifyStore = {
  notices: Notice[];
  push: (notice: Omit<Notice, "id">) => void;
  dismiss: (id: number) => void;
};

let nextId = 1;

export const useNotifyStore = create<NotifyStore>((set) => ({
  notices: [],
  push: (notice) =>
    set((s) => ({ notices: [...s.notices.filter((n) => n.taskId !== notice.taskId), { ...notice, id: nextId++ }].slice(-4) })),
  dismiss: (id) => set((s) => ({ notices: s.notices.filter((n) => n.id !== id) })),
}));
