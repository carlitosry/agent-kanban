import type { Agent, BoardState, TaskState, TaskView } from "../types.js";

export const COLUMNS: { state: TaskState; label: string }[] = [
  { state: "todo", label: "Por hacer" },
  { state: "in_progress", label: "En progreso" },
  { state: "in_review", label: "En revisión" },
  { state: "done", label: "Hecho" },
  { state: "blocked", label: "Bloqueada / Requiere humano" },
];

export const STATE_LABEL: Record<TaskState, string> = Object.fromEntries(
  COLUMNS.map((c) => [c.state, c.label]),
) as Record<TaskState, string>;

export interface Filters { agent: string; wave: string }
export const NO_FILTERS: Filters = { agent: "", wave: "" };

export function applyFilters(tasks: TaskView[], f: Filters): TaskView[] {
  return tasks.filter(
    (t) => (!f.agent || t.assignee === f.agent) && (!f.wave || String(t.wave) === f.wave),
  );
}

export function groupByState(tasks: TaskView[]): Record<TaskState, TaskView[]> {
  const out: Record<TaskState, TaskView[]> = { todo: [], in_progress: [], in_review: [], done: [], blocked: [] };
  for (const t of tasks) out[t.state].push(t);
  return out;
}

export interface PhaseGroup { phase: string; waves: { wave: number; tasks: TaskView[] }[] }

/** Phases keep first-seen order; waves ascending; tasks keep their order. */
export function groupByPhaseWave(tasks: TaskView[]): PhaseGroup[] {
  const phases = new Map<string, Map<number, TaskView[]>>();
  for (const t of tasks) {
    const waves = phases.get(t.phase) ?? new Map<number, TaskView[]>();
    waves.set(t.wave, [...(waves.get(t.wave) ?? []), t]);
    phases.set(t.phase, waves);
  }
  return [...phases].map(([phase, waves]) => ({
    phase,
    waves: [...waves].sort((a, b) => a[0] - b[0]).map(([wave, ts]) => ({ wave, tasks: ts })),
  }));
}

export function waveOptions(tasks: TaskView[]): number[] {
  return [...new Set(tasks.map((t) => t.wave))].sort((a, b) => a - b);
}

export interface AgentSummary { agent: Agent; current?: TaskView; counts: Record<TaskState, number>; total: number }

export function summarizeAgents(agents: Agent[], tasks: TaskView[]): AgentSummary[] {
  return agents.map((agent) => {
    const mine = tasks.filter((t) => t.assignee === agent.id);
    const counts: Record<TaskState, number> = { todo: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0 };
    for (const t of mine) counts[t.state]++;
    const current = mine.find((t) => t.state === "in_progress") ?? mine.find((t) => t.state === "in_review");
    return { agent, current, counts, total: mine.length };
  });
}

export function countStates(tasks: TaskView[]): Record<TaskState, number> {
  const c: Record<TaskState, number> = { todo: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0 };
  for (const t of tasks) c[t.state]++;
  return c;
}

/** Replace (or add) a task from an API response, keeping counts coherent. */
export function upsertTask(state: BoardState, task: TaskView): BoardState {
  const exists = state.tasks.some((t) => t.id === task.id);
  const tasks = exists ? state.tasks.map((t) => (t.id === task.id ? task : t)) : [...state.tasks, task];
  return { ...state, tasks, counts: countStates(tasks) };
}

export function agentById(agents: Agent[], id: string | undefined): Agent | undefined {
  return agents.find((a) => a.id === id);
}

export function initial(name: string): string {
  return (name.trim()[0] ?? "?").toUpperCase();
}

/** Actions a drop onto `target` should trigger. */
export type DropAction =
  | { kind: "none" }
  | { kind: "move"; to: TaskState }
  | { kind: "block" }
  | { kind: "unblock" };

export function dropAction(task: TaskView, target: TaskState): DropAction {
  if (task.state === target) return { kind: "none" };
  if (target === "blocked") return task.state === "done" ? { kind: "none" } : { kind: "block" };
  if (task.state === "blocked") return target === (task.blocked_from ?? "todo") ? { kind: "unblock" } : { kind: "none" };
  return { kind: "move", to: target };
}

/** Whether the actor may act as reviewer (preflight/review/approve). */
export function canReview(actor: Agent | undefined): boolean {
  return !!actor && (actor.role === "reviewer" || actor.kind === "human");
}
