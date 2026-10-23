export type TaskState = "todo" | "in_progress" | "in_review" | "done" | "blocked";
export type AgentKind = "agent" | "human";
export type AgentRole = "orchestrator" | "reviewer" | "implementer" | "human";

export interface Agent {
  id: string;
  name: string;
  role: AgentRole | string;
  color: string;
  kind: AgentKind;
}

export interface TaskSeed {
  id: string;
  title: string;
  description?: string;
  plan: string;
  section: string;
  phase: string;
  wave: number;
  assignee: string; // Agent.id
  depends_on: string[];
  owns_files: string[];
  acceptance: string[];
  verify: string[];
  needs_ui_evidence: boolean;
}

export type EventType =
  | "board_created"
  | "task_created"
  | "task_updated"
  | "assign"
  | "move"
  | "comment"
  | "preflight"
  | "review"
  | "block"
  | "unblock";

export interface KanbanEvent {
  ts: string; // ISO 8601
  board: string;
  task?: string;
  by: string;
  type: EventType;
  from?: TaskState;
  to?: TaskState;
  note?: string;
  evidence?: string[];
  question?: string;
  payload?: Record<string, unknown>; // preflight/review: { verdict }; task_created/updated: partial TaskSeed
}

export interface BoardMeta {
  id: string;
  title: string;
  description?: string;
  created_at: string;
  plans: string[];
}

export interface TaskView extends TaskSeed {
  state: TaskState;
  blocked_from?: TaskState; // previous state if state === "blocked"
  question?: string; // open question for a human (raised hand)
  preflight?: { verdict: "approve" | "block"; by: string; note?: string; ts: string };
  review?: { verdict: "approve" | "changes" | "human"; by: string; note?: string; ts: string };
  review_rounds: number; // number of times the reviewer requested changes
  evidence: string[]; // file names in evidence/<task-id>/
  history: KanbanEvent[];
  ready: boolean; // state === "todo" and all depends_on in done
}

export interface BoardState {
  board: BoardMeta;
  agents: Agent[];
  tasks: TaskView[];
  counts: Record<TaskState, number>;
}
