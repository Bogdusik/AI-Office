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

export type WorldState = {
  floors: FloorState[];
};

export async function fetchState(signal?: AbortSignal): Promise<WorldState> {
  const res = await fetch(`${API_URL}/api/v1/state`, { cache: "no-store", signal });
  if (!res.ok) throw new Error(`GET /api/v1/state failed: ${res.status}`);
  return (await res.json()) as WorldState;
}
