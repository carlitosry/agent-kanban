import { DomainError } from "./errors.js";
import type { Agent, TaskSeed } from "./types.js";

function find(agents: Agent[], id: string): Agent | undefined {
  return agents.find((a) => a.id === id);
}

/** Orchestrators, reviewers and humans may act on any task. */
export function isPrivileged(actor: Agent): boolean {
  return actor.kind === "human" || actor.role === "orchestrator" || actor.role === "reviewer";
}

export function isReviewerOrHuman(actor: Agent): boolean {
  return actor.kind === "human" || actor.role === "reviewer";
}

/** The assignee moves their own tasks; privileged roles move any task. */
export function canMove(actorId: string, task: Pick<TaskSeed, "assignee">, agents: Agent[]): boolean {
  const actor = find(agents, actorId);
  if (!actor) return false;
  return actor.id === task.assignee || isPrivileged(actor);
}

export function requireAgent(agents: Agent[], id: string): Agent {
  const actor = find(agents, id);
  if (!actor) throw new DomainError("not_found", `agent not found: ${id}`);
  return actor;
}

export function assertCanMove(actorId: string, task: Pick<TaskSeed, "assignee" | "id">, agents: Agent[]): Agent {
  const actor = requireAgent(agents, actorId);
  if (!canMove(actorId, task, agents)) {
    throw new DomainError("not_assignee", `${actorId} cannot act on task ${task.id}`);
  }
  return actor;
}

/** preflight and review can only be recorded by a reviewer or a human. */
export function assertReviewerOrHuman(actorId: string, agents: Agent[], action: string): Agent {
  const actor = requireAgent(agents, actorId);
  if (!isReviewerOrHuman(actor)) {
    throw new DomainError("not_assignee", `${actorId} cannot record ${action}: reviewer or human required`);
  }
  return actor;
}
