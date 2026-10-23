import { DomainError } from "../core/errors.js";
import { assertValidId } from "../core/ids.js";
import { assertCanMove } from "../core/permissions.js";
import { projectBoard } from "../core/projection.js";
import { validateSeed } from "../core/seed.js";
import {
  assertCanBlock,
  assertCanPreflight,
  assertCanReview,
  assertCanUnblock,
  assertMove,
} from "../core/transitions.js";
import type {
  Agent,
  BoardMeta,
  BoardState,
  KanbanEvent,
  TaskSeed,
  TaskState,
  TaskView,
} from "../core/types.js";
import { BoardStore } from "../store/board-store.js";
import type { AppendFn } from "../store/event-store.js";
import { agentSchema, parse, taskSeedSchema } from "./schemas.js";

export interface BoardServiceOptions {
  now?: () => Date;
}

const EVIDENCE_FILE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Use-case layer shared by the CLI and the server; the only place where rules meet storage. */
export class BoardService {
  private readonly store: BoardStore;
  private readonly now: () => Date;

  constructor(dataDir: string, options: BoardServiceOptions = {}) {
    this.store = new BoardStore(dataDir);
    this.now = options.now ?? (() => new Date());
  }

  eventsPath(boardId: string): string {
    return this.store.events.eventsPath(boardId);
  }

  async listBoards(): Promise<BoardMeta[]> {
    const ids = await this.store.listBoardIds();
    return Promise.all(ids.map((id) => this.store.readMeta(id)));
  }

  async createBoard(input: { id: string; title: string; description?: string; plans?: string[] }): Promise<BoardMeta> {
    assertValidId("board", input.id);
    if (!input.title || input.title.trim() === "") throw new DomainError("validation_error", "title is required");
    return this.store.events.transaction(input.id, async (append) => {
      if (await this.store.exists(input.id)) {
        throw new DomainError("validation_error", `board already exists: ${input.id}`);
      }
      const meta: BoardMeta = {
        id: input.id,
        title: input.title,
        ...(input.description ? { description: input.description } : {}),
        created_at: this.ts(),
        plans: input.plans ?? [],
      };
      await this.store.writeMeta(meta);
      await this.store.writeSeed(meta.id, []);
      await this.store.writeAgents(meta.id, []);
      await append(this.event(meta.id, { by: "system", type: "board_created" }));
      return meta;
    });
  }

  async importSeed(
    boardId: string,
    seed: { tasks: TaskSeed[]; agents?: Agent[]; plans?: string[] },
  ): Promise<{ problems: string[] }> {
    await this.store.readMeta(boardId);
    return this.store.events.transaction(boardId, async () => {
      const meta = await this.store.readMeta(boardId);
      const agents = mergeAgents(await this.store.readAgents(boardId), seed.agents ?? []);
      const problems = validateSeed(seed.tasks, agents);
      if (problems.length > 0) return { problems };
      await this.store.writeAgents(boardId, agents);
      await this.store.writeSeed(boardId, seed.tasks);
      if (seed.plans) await this.store.writeMeta({ ...meta, plans: [...new Set([...meta.plans, ...seed.plans])] });
      return { problems: [] };
    });
  }

  async validate(boardId: string): Promise<string[]> {
    const state = await this.getState(boardId);
    return validateSeed(state.tasks.map(toSeed), state.agents);
  }

  async getState(boardId: string): Promise<BoardState> {
    const [board, agents, seed, events, evidence] = await Promise.all([
      this.store.readMeta(boardId),
      this.store.readAgents(boardId),
      this.store.readSeed(boardId),
      this.store.events.readAll(boardId),
      this.store.listEvidence(boardId),
    ]);
    return projectBoard({ board, agents, seed, events, evidence });
  }

  async next(boardId: string): Promise<TaskView[]> {
    return (await this.getState(boardId)).tasks.filter((t) => t.ready);
  }

  async createTask(boardId: string, by: string, input: TaskSeed): Promise<TaskView> {
    const task = parse(taskSeedSchema, input, "task") as TaskSeed;
    assertValidId("task", task.id);
    return this.mutate(boardId, task.id, async (state, emit) => {
      assertCanMove(by, task, state.agents); // actor must exist and be assignee or privileged
      if (state.tasks.some((t) => t.id === task.id)) {
        throw new DomainError("validation_error", `duplicate task id: ${task.id}`);
      }
      this.assertNoNewProblems(state, [...state.tasks.map(toSeed), task]);
      await emit({ by, type: "task_created", task: task.id, payload: { ...task } });
    });
  }

  async updateTask(boardId: string, by: string, taskId: string, patch: Partial<TaskSeed>): Promise<TaskView> {
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertCanMove(by, task, state.agents);
      const clean = parse(taskSeedSchema.partial().strict(), patch, "patch") as Partial<TaskSeed>;
      if (clean.id !== undefined && clean.id !== taskId) {
        throw new DomainError("validation_error", "task id cannot be changed");
      }
      delete clean.id;
      const merged = state.tasks.map((t) => (t.id === taskId ? { ...toSeed(t), ...clean } : toSeed(t)));
      this.assertNoNewProblems(state, merged);
      const type = Object.keys(clean).length === 1 && clean.assignee !== undefined ? "assign" : "task_updated";
      await emit({ by, type, task: taskId, payload: { ...clean } });
    });
  }

  async move(boardId: string, by: string, taskId: string, to: TaskState, note?: string): Promise<TaskView> {
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertMove(by, task, to, state.tasks, state.agents);
      if (to === "blocked" && (!note || note.trim() === "")) {
        throw new DomainError("validation_error", "a reason (note) is required to block a task");
      }
      await emit({ by, type: "move", task: taskId, from: task.state, to, ...(note ? { note } : {}) });
    });
  }

  async block(boardId: string, by: string, taskId: string, note: string, question?: string): Promise<TaskView> {
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertCanBlock(by, task, state.agents);
      await emit({
        by,
        type: "block",
        task: taskId,
        from: task.state,
        to: "blocked",
        note,
        ...(question ? { question } : {}),
      });
    });
  }

  async unblock(boardId: string, by: string, taskId: string, note?: string): Promise<TaskView> {
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertCanUnblock(by, task, state.agents);
      await emit({
        by,
        type: "unblock",
        task: taskId,
        from: "blocked",
        to: task.blocked_from ?? "todo",
        ...(note ? { note } : {}),
      });
    });
  }

  async comment(boardId: string, by: string, taskId: string, note: string): Promise<TaskView> {
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      if (!state.agents.some((a) => a.id === by)) throw new DomainError("not_found", `agent not found: ${by}`);
      if (!note || note.trim() === "") throw new DomainError("validation_error", "note is required");
      await emit({ by, type: "comment", task: task.id, note });
    });
  }

  async preflight(
    boardId: string,
    by: string,
    taskId: string,
    verdict: "approve" | "block",
    note?: string,
  ): Promise<TaskView> {
    if (verdict !== "approve" && verdict !== "block") throw new DomainError("validation_error", "invalid verdict");
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertCanPreflight(by, task, state.agents);
      await emit({ by, type: "preflight", task: taskId, payload: { verdict }, ...(note ? { note } : {}) });
    });
  }

  async review(
    boardId: string,
    by: string,
    taskId: string,
    verdict: "approve" | "changes" | "human",
    note?: string,
    question?: string,
  ): Promise<TaskView> {
    if (!["approve", "changes", "human"].includes(verdict)) throw new DomainError("validation_error", "invalid verdict");
    return this.mutate(boardId, taskId, async (state, emit) => {
      const task = findTask(state, taskId);
      assertCanReview(by, task, state.agents);
      const to: TaskState = verdict === "approve" ? "done" : verdict === "changes" ? "in_progress" : "blocked";
      await emit({
        by,
        type: "review",
        task: taskId,
        from: "in_review",
        to,
        payload: { verdict },
        ...(note ? { note } : {}),
        ...(verdict === "human" && question ? { question } : {}),
      });
    });
  }

  async addAgent(boardId: string, input: Agent): Promise<Agent> {
    const agent = parse(agentSchema, input, "agent") as Agent;
    assertValidId("agent", agent.id);
    await this.store.readMeta(boardId);
    return this.store.events.transaction(boardId, async () => {
      const agents = await this.store.readAgents(boardId);
      if (agents.some((a) => a.id === agent.id)) {
        throw new DomainError("validation_error", `agent already exists: ${agent.id}`);
      }
      await this.store.writeAgents(boardId, [...agents, agent]);
      return agent;
    });
  }

  async updateAgent(boardId: string, agentId: string, patch: Partial<Agent>): Promise<Agent> {
    await this.store.readMeta(boardId);
    return this.store.events.transaction(boardId, async () => {
      const agents = await this.store.readAgents(boardId);
      const current = agents.find((a) => a.id === agentId);
      if (!current) throw new DomainError("not_found", `agent not found: ${agentId}`);
      const clean = parse(agentSchema.partial().strict(), patch, "patch") as Partial<Agent>;
      if (clean.id !== undefined && clean.id !== agentId) {
        throw new DomainError("validation_error", "agent id cannot be changed");
      }
      const updated: Agent = { ...current, ...clean, id: agentId };
      await this.store.writeAgents(boardId, agents.map((a) => (a.id === agentId ? updated : a)));
      return updated;
    });
  }

  async addEvidence(boardId: string, taskId: string, file: string, data: Buffer): Promise<void> {
    if (!EVIDENCE_FILE.test(file) || file.includes("..")) {
      throw new DomainError("validation_error", `invalid evidence file name: ${file}`);
    }
    await this.mutate(boardId, taskId, async (state, emit) => {
      findTask(state, taskId);
      await this.store.writeEvidence(boardId, taskId, file, data);
      await emit({ by: "system", type: "comment", task: taskId, note: `evidence: ${file}`, evidence: [file] });
    });
  }

  async statusText(boardId: string): Promise<string> {
    const s = await this.getState(boardId);
    const c = s.counts;
    const lines = [
      `${s.board.title} (${s.board.id})`,
      `todo ${c.todo} | in_progress ${c.in_progress} | in_review ${c.in_review} | done ${c.done} | blocked ${c.blocked}`,
    ];
    for (const t of s.tasks.filter((x) => x.state !== "done")) {
      const flags = [t.ready ? "ready" : "", t.question ? `question: ${t.question}` : ""].filter(Boolean).join("; ");
      lines.push(`- [${t.state}] ${t.id} ${t.title} (@${t.assignee})${flags ? ` — ${flags}` : ""}`);
    }
    return lines.join("\n");
  }

  // --- helpers ---

  private ts(): string {
    return this.now().toISOString();
  }

  private event(boardId: string, partial: Omit<KanbanEvent, "ts" | "board">): KanbanEvent {
    return { ts: this.ts(), board: boardId, ...partial };
  }

  /**
   * Reads state, validates and appends inside one board lock, so rule checks are atomic across
   * processes. Returns the task view after the change.
   */
  private async mutate(
    boardId: string,
    taskId: string,
    fn: (state: BoardState, emit: (e: Omit<KanbanEvent, "ts" | "board">) => Promise<void>) => Promise<void>,
  ): Promise<TaskView> {
    await this.store.readMeta(boardId); // not_found before creating any lock file
    await this.store.events.transaction(boardId, async (append: AppendFn) => {
      const state = await this.getState(boardId);
      await fn(state, (e) => append(this.event(boardId, e)));
    });
    return this.view(boardId, taskId);
  }

  private async view(boardId: string, taskId: string): Promise<TaskView> {
    return findTask(await this.getState(boardId), taskId);
  }

  /** Throws only for problems introduced by the change, not for pre-existing ones. */
  private assertNoNewProblems(state: BoardState, next: TaskSeed[]): void {
    const before = new Set(validateSeed(state.tasks.map(toSeed), state.agents));
    const added = validateSeed(next, state.agents).filter((p) => !before.has(p));
    if (added.length > 0) throw new DomainError("validation_error", added.join("; "));
  }
}

function findTask(state: BoardState, taskId: string): TaskView {
  const task = state.tasks.find((t) => t.id === taskId);
  if (!task) throw new DomainError("not_found", `task not found: ${taskId}`);
  return task;
}

function mergeAgents(current: Agent[], incoming: Agent[]): Agent[] {
  const map = new Map(current.map((a) => [a.id, a]));
  for (const a of incoming) map.set(a.id, a);
  return [...map.values()];
}

function toSeed(t: TaskView): TaskSeed {
  return {
    id: t.id,
    title: t.title,
    ...(t.description !== undefined ? { description: t.description } : {}),
    plan: t.plan,
    section: t.section,
    phase: t.phase,
    wave: t.wave,
    assignee: t.assignee,
    depends_on: t.depends_on,
    owns_files: t.owns_files,
    acceptance: t.acceptance,
    verify: t.verify,
    needs_ui_evidence: t.needs_ui_evidence,
  };
}
