import { API_URL } from "@/lib/config";

export type AgentStatus =
  | "off_site"
  | "arriving"
  | "idle"
  | "working"
  | "waiting_review"
  | "leaving";

export type TaskStatus =
  | "queued"
  | "in_progress"
  | "paused"
  | "needs_review"
  | "changes_requested"
  | "done"
  | "failed"
  | "cancelled";

export type TaskStage = "plan" | "research" | "draft" | "self_check";

export type CurrentTask = {
  id: number;
  title: string;
  status: TaskStatus;
  stage: TaskStage | null;
};

export type AgentState = {
  id: number;
  name: string;
  role_key: string;
  title: string;
  desk_index: number;
  status: AgentStatus;
  web_access: boolean;
  current_task: CurrentTask | null;
  queue_length: number;
  awaiting_review: number;
};

export type FloorKind = "reception" | "office";

export type FloorState = {
  id: number;
  number: number;
  name: string;
  kind: FloorKind;
  capacity: number;
  has_director_office: boolean;
  agents: AgentState[];
};

export type WorldStats = {
  tasks_in_progress: number;
  awaiting_review: number;
  done_today: number;
};

export type WorldState = {
  floors: FloorState[];
  stats: WorldStats;
};

export type Agent = {
  id: number;
  floor_id: number | null;
  name: string;
  role_key: string;
  title: string;
  system_prompt: string;
  provider: string;
  model: string | null;
  web_access: boolean;
  desk_index: number | null;
  status: AgentStatus;
  archived_at: string | null;
};

export type AgentCreate = {
  floor_id: number;
  desk_index: number;
  name: string;
  role_key: string;
  title: string;
  system_prompt: string;
};

export type AgentUpdate = Partial<Pick<Agent, "title" | "system_prompt" | "model" | "web_access">>;

export type Task = {
  id: number;
  agent_id: number;
  title: string;
  description: string;
  status: TaskStatus;
  stage: TaskStage | null;
  position: number;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};

export type Comment = { id: number; author: "director" | "agent"; body: string; created_at: string };

export type Run = {
  id: number;
  stage: TaskStage;
  attempt: number;
  provider: string;
  model: string | null;
  input_tokens: number;
  output_tokens: number;
  status: string;
  error: string | null;
  output: string;
  started_at: string;
  finished_at: string | null;
};

export type Artifact = { id: number; version: number; content: string; sources: string[]; created_at: string };

export type TaskDetail = Task & { comments: Comment[]; runs: Run[]; artifacts: Artifact[] };

export type Profile = { name: string; summary: string; goal: string; constraints: string; notes: string; updated_at: string };

export type ProfileUpdate = Omit<Profile, "updated_at">;

export type Floor = Omit<FloorState, "agents">;

export type ValidationIssue = { loc: (string | number)[]; msg: string; type: string; ctx?: Record<string, unknown> };

/** Non-2xx answer; `detail` is FastAPI's: a message for domain errors, a list of issues for validation. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly detail: string | ValidationIssue[] | null,
  ) {
    super(typeof detail === "string" ? detail : `HTTP ${status}`);
  }
}

async function request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method,
    cache: "no-store",
    signal,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => null)) as { detail?: string | ValidationIssue[] } | null;
    throw new ApiError(res.status, payload?.detail ?? null);
  }
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export const fetchState = (signal?: AbortSignal) => request<WorldState>("GET", "/state", undefined, signal);

export const api = {
  agent: (id: number, signal?: AbortSignal) => request<Agent>("GET", `/agents/${id}`, undefined, signal),
  createAgent: (data: AgentCreate) => request<Agent>("POST", "/agents", data),
  updateAgent: (id: number, data: AgentUpdate) => request<Agent>("PATCH", `/agents/${id}`, data),
  archiveAgent: (id: number) => request<void>("DELETE", `/agents/${id}`),

  tasks: (signal?: AbortSignal) => request<Task[]>("GET", "/tasks", undefined, signal),
  task: (id: number, signal?: AbortSignal) => request<TaskDetail>("GET", `/tasks/${id}`, undefined, signal),
  createTask: (agentId: number, title: string, description: string) =>
    request<Task>("POST", "/tasks", { agent_id: agentId, title, description }),
  approve: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/approve`),
  requestChanges: (id: number, body: string) => request<TaskDetail>("POST", `/tasks/${id}/request-changes`, { body }),
  pause: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/pause`),
  resume: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/resume`),
  cancel: (id: number) => request<TaskDetail>("POST", `/tasks/${id}/cancel`),
  comment: (id: number, body: string) => request<Comment>("POST", `/tasks/${id}/comments`, { body }),

  profile: (signal?: AbortSignal) => request<Profile>("GET", "/profile", undefined, signal),
  saveProfile: (data: ProfileUpdate) => request<Profile>("PUT", "/profile", data),

  createFloor: (number: number, name: string, capacity: number) =>
    request<Floor>("POST", "/floors", { number, name, kind: "office", capacity }),
  deleteFloor: (id: number) => request<void>("DELETE", `/floors/${id}`),
};
