import type { AgentState, AgentStatus, TaskStage, TaskStatus } from "@/lib/api";

type Tag = { label: string; color: string };

export const AGENT_STATUS: Record<AgentStatus, Tag> = {
  off_site: { label: "Не в офисе", color: "#9aa0ab" },
  arriving: { label: "Едет в офис", color: "#4f8fe8" },
  idle: { label: "Свободен", color: "#2fbf83" },
  working: { label: "Работает", color: "#f0a020" },
  waiting_review: { label: "Ждёт проверки", color: "#8b6cf0" },
  leaving: { label: "Уезжает", color: "#4f8fe8" },
};

export const WAITING_FOR_MODEL: Tag = { label: "Ждёт модель", color: "#6f9bc6" };
export const ON_WEB: Tag = { label: "Ищет в сети", color: "#2a9fd6" };

/** Status tag of an agent as shown everywhere: "working" splits into working / waiting for the model. */
export function agentTag(agent: Pick<AgentState, "status" | "current_task">): Tag {
  if (agent.status === "working" && agent.current_task?.on_web) return ON_WEB;
  if (agent.status === "working" && agent.current_task?.waiting_for_model) return WAITING_FOR_MODEL;
  return AGENT_STATUS[agent.status];
}

const WRITING: Record<TaskStage, string> = {
  plan: "Пишет план",
  research: "Изучает материалы",
  draft: "Пишет черновик",
  self_check: "Проверяет результат",
};

/** Caption above an agent's head in office life, from what is really going on (never generated). */
export function activityCaption(agent: Pick<AgentState, "status" | "current_task" | "activity_log">): string | null {
  const now = agent.activity_log.at(-1)?.kind;
  const task = agent.current_task;
  if (now === "waiting_model") return "Ждёт модель";
  if (now === "waiting_review" || agent.status === "waiting_review") return "Ждёт проверки";
  if (now === "idle" || agent.status === "idle") return "На перерыве";
  if (agent.status !== "working") return null;
  if (task?.web_step?.kind === "fetch") return `Читает ${task.web_step.target}`;
  if (task?.web_step?.kind === "search") return "Ищет в сети";
  if (task?.web_step?.kind === "jobs") return "Ищет вакансии";
  if (task?.web_step?.kind === "job") return "Читает вакансию";
  if (task?.run_state === "waiting") return "Ждёт модель";
  return task?.stage ? WRITING[task.stage] : "Работает";
}

const EXCLUSION: [RegExp, string][] = [
  [/^security clearance/, "Допуск с условием проживания (SC/DV/NPPV)"],
  [/residency/, "Требование лет проживания в UK"],
  [/nationality|citizenship/, "Требование гражданства"],
];

/** Russian name of a hard-filter reason sent by the backend (`app/jobs/eligibility.py`). */
export function exclusionReason(reason: string): string {
  return EXCLUSION.find(([re]) => re.test(reason))?.[1] ?? reason;
}

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

export const RUN_STATUS: Record<string, string> = {
  waiting: "Ждёт модель",
  running: "Идёт",
  succeeded: "Успешно",
  failed: "Ошибка",
  interrupted: "Прерван перезапуском",
  cancelled: "Отменён",
};
