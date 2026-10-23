import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BoardService } from "../../src/app/board-service.js";
import type { Agent, TaskSeed } from "../../src/core/types.js";

export const agents: Agent[] = [
  { id: "orch", name: "Orchestrator", role: "orchestrator", color: "#111", kind: "agent" },
  { id: "rev", name: "Reviewer", role: "reviewer", color: "#222", kind: "agent" },
  { id: "dev", name: "Dev", role: "implementer", color: "#333", kind: "agent" },
  { id: "dev2", name: "Dev 2", role: "implementer", color: "#444", kind: "agent" },
  { id: "carlos", name: "Carlos", role: "human", color: "#555", kind: "human" },
];

export function task(id: string, over: Partial<TaskSeed> = {}): TaskSeed {
  return {
    id,
    title: `Task ${id}`,
    plan: "plan.md",
    section: "S1",
    phase: "P1",
    wave: 1,
    assignee: "dev",
    depends_on: [],
    owns_files: [`src/${id}.ts`],
    acceptance: ["works"],
    verify: ["npm test"],
    needs_ui_evidence: false,
    ...over,
  };
}

export async function tmpDir(): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "agent-kanban-"));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** Service with a board, the standard agents and the given seed tasks imported. */
export async function setupBoard(tasks: TaskSeed[], dir: string, board = "b1"): Promise<BoardService> {
  let tick = 0;
  const svc = new BoardService(dir, { now: () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)) });
  await svc.createBoard({ id: board, title: "Board" });
  const res = await svc.importSeed(board, { tasks, agents });
  if (res.problems.length) throw new Error(res.problems.join("; "));
  return svc;
}
