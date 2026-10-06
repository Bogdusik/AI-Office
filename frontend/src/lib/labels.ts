import type { AgentStatus, TaskStage, TaskStatus } from "@/lib/api";

type Tag = { label: string; color: string };

export const AGENT_STATUS: Record<AgentStatus, Tag> = {
  off_site: { label: "Не в офисе", color: "#9aa0ab" },
  arriving: { label: "Едет в офис", color: "#4f8fe8" },
  idle: { label: "Свободен", color: "#2fbf83" },
  working: { label: "Работает", color: "#f0a020" },
  waiting_review: { label: "Ждёт проверки", color: "#8b6cf0" },
  leaving: { label: "Уезжает", color: "#4f8fe8" },
};

export const TASK_STATUS: Record<TaskStatus, Tag> = {
  queued: { label: "В очереди", color: "#7d8796" },
  in_progress: { label: "В работе", color: "#f0a020" },
  paused: { label: "На паузе", color: "#b0a48f" },
  needs_review: { label: "На проверке", color: "#8b6cf0" },
  changes_requested: { label: "На доработке", color: "#ff7a59" },
  done: { label: "Готово", color: "#2fbf83" },
  failed: { label: "Ошибка", color: "#e5484d" },
  cancelled: { label: "Отменена", color: "#5c6370" },
};

export const TASK_STAGE: Record<TaskStage, string> = {
  plan: "План",
  research: "Исследование",
  draft: "Черновик",
  self_check: "Самопроверка",
};
