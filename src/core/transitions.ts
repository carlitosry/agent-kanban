import { DomainError } from "./errors.js";
import { assertCanMove, assertReviewerOrHuman, isReviewerOrHuman, isPrivileged } from "./permissions.js";
import type { Agent, TaskState, TaskView } from "./types.js";

/** Pure state graph; `blocked` is handled separately (it depends on `blocked_from`). */
const ALLOWED: Record<TaskState, TaskState[]> = {
  todo: ["in_progress"],
  in_progress: ["in_review"],
  in_review: ["done", "in_progress"],
  done: [],
  blocked: [],
};

export function isValidTransition(task: Pick<TaskView, "state" | "blocked_from">, to: TaskState): boolean {
  const from = task.state;
  if (to === "blocked") return from !== "done" && from !== "blocked";
  if (from === "blocked") return task.blocked_from !== undefined && to === task.blocked_from;
  return ALLOWED[from].includes(to);
}

/**
 * Validates a `move` (state graph, permissions, dependencies, preflight).
 * Check order: transition, permission, dependencies, preflight.
 */
export function assertMove(actorId: string, task: TaskView, to: TaskState, all: TaskView[], agents: Agent[]): void {
  if (!isValidTransition(task, to)) {
    throw new DomainError("invalid_transition", `${task.id}: ${task.state} -> ${to} is not allowed`);
  }
  const actor = assertCanMove(actorId, task, agents);

  if (task.state === "in_review" && to === "in_progress" && !isPrivileged(actor)) {
    throw new DomainError("not_assignee", `${actorId} cannot send ${task.id} back from review`);
  }
  if (to === "done" && !isReviewerOrHuman(actor)) {
    throw new DomainError("not_assignee", `only a reviewer or a human can set ${task.id} to done`);
  }

  if (task.state === "todo" && to === "in_progress") {
    assertReady(task, all);
  }
}

export function assertReady(task: TaskView, all: TaskView[]): void {
  const pending = task.depends_on.filter((d) => all.find((t) => t.id === d)?.state !== "done");
  if (pending.length > 0) {
    throw new DomainError("dependencies_pending", `${task.id}: pending dependencies: ${pending.join(", ")}`);
  }
  if (task.preflight?.verdict !== "approve") {
    throw new DomainError("preflight_required", `${task.id}: approved preflight required`);
  }
}

export function assertCanBlock(actorId: string, task: TaskView, agents: Agent[]): void {
  if (!isValidTransition(task, "blocked")) {
    throw new DomainError("invalid_transition", `${task.id}: cannot block a task in ${task.state}`);
  }
  assertCanMove(actorId, task, agents);
}

export function assertCanUnblock(actorId: string, task: TaskView, agents: Agent[]): void {
  if (task.state !== "blocked") {
    throw new DomainError("invalid_transition", `${task.id}: task is not blocked`);
  }
  assertCanMove(actorId, task, agents);
}

export function assertCanPreflight(actorId: string, task: TaskView, agents: Agent[]): void {
  assertReviewerOrHuman(actorId, agents, "preflight");
  if (task.state !== "todo") {
    throw new DomainError("invalid_transition", `${task.id}: preflight only applies to todo tasks`);
  }
}

export function assertCanReview(actorId: string, task: TaskView, agents: Agent[]): void {
  assertReviewerOrHuman(actorId, agents, "review");
  if (task.state !== "in_review") {
    throw new DomainError("invalid_transition", `${task.id}: review only applies to in_review tasks`);
  }
}
