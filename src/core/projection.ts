import type { Agent, BoardMeta, BoardState, KanbanEvent, TaskSeed, TaskState, TaskView } from "./types.js";

const STATES: TaskState[] = ["todo", "in_progress", "in_review", "done", "blocked"];

/** Stable sort by `ts`; ties keep file order. */
export function sortEvents(events: KanbanEvent[]): KanbanEvent[] {
  return events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => (a.e.ts < b.e.ts ? -1 : a.e.ts > b.e.ts ? 1 : a.i - b.i))
    .map((x) => x.e);
}

function newView(seed: TaskSeed): TaskView {
  return {
    ...seed,
    depends_on: [...(seed.depends_on ?? [])],
    owns_files: [...(seed.owns_files ?? [])],
    acceptance: [...(seed.acceptance ?? [])],
    verify: [...(seed.verify ?? [])],
    state: "todo",
    review_rounds: 0,
    evidence: [],
    history: [],
    ready: false,
  };
}

function verdictOf(e: KanbanEvent): string | undefined {
  const v = e.payload?.["verdict"];
  return typeof v === "string" ? v : undefined;
}

function applyEvent(t: TaskView, e: KanbanEvent): void {
  t.history.push(e);
  switch (e.type) {
    case "task_updated":
    case "assign": {
      const patch = { ...(e.payload ?? {}) } as Partial<TaskSeed>;
      delete (patch as { id?: string }).id;
      Object.assign(t, patch);
      break;
    }
    case "move": {
      if (!e.to) break;
      if (e.to === "blocked") {
        t.blocked_from = e.from ?? t.state;
        if (e.question) t.question = e.question;
      } else {
        delete t.blocked_from;
        delete t.question;
      }
      t.state = e.to;
      break;
    }
    case "preflight": {
      const verdict = verdictOf(e);
      if (verdict === "approve" || verdict === "block") {
        t.preflight = { verdict, by: e.by, ...(e.note ? { note: e.note } : {}), ts: e.ts };
      }
      break;
    }
    case "review": {
      const verdict = verdictOf(e);
      if (verdict !== "approve" && verdict !== "changes" && verdict !== "human") break;
      t.review = { verdict, by: e.by, ...(e.note ? { note: e.note } : {}), ts: e.ts };
      if (verdict === "approve") {
        t.state = "done";
      } else if (verdict === "changes") {
        t.state = "in_progress";
        t.review_rounds += 1;
      } else {
        t.blocked_from = t.state;
        t.state = "blocked";
        if (e.question) t.question = e.question;
      }
      break;
    }
    case "block":
      t.blocked_from = t.state === "blocked" ? t.blocked_from : t.state;
      t.state = "blocked";
      if (e.question) t.question = e.question;
      break;
    case "unblock":
      t.state = t.blocked_from ?? e.to ?? "todo";
      delete t.blocked_from;
      delete t.question;
      break;
    case "comment":
    case "task_created":
    case "board_created":
      break;
  }
}

export interface ProjectInput {
  board: BoardMeta;
  agents: Agent[];
  seed: TaskSeed[];
  events: KanbanEvent[];
  evidence?: Record<string, string[]>; // task id -> file names
}

/** Effective state = seed + task_created/task_updated + remaining events in ts order. */
export function projectBoard(input: ProjectInput): BoardState {
  const tasks = new Map<string, TaskView>();
  const order: string[] = [];
  const add = (seed: TaskSeed): TaskView => {
    const view = newView(seed);
    if (!tasks.has(seed.id)) order.push(seed.id);
    tasks.set(seed.id, view);
    return view;
  };
  for (const s of input.seed) add(s);

  const sorted = sortEvents(input.events);
  // task_created events first (they extend the seed), then the rest in ts order.
  for (const e of sorted) {
    if (e.type === "task_created" && e.task && e.payload && !tasks.has(e.task)) {
      add(e.payload as unknown as TaskSeed).history.push(e);
    }
  }
  for (const e of sorted) {
    if (e.type === "task_created" || e.type === "board_created" || !e.task) continue;
    const t = tasks.get(e.task);
    if (t) applyEvent(t, e);
  }

  const list = order.map((id) => tasks.get(id)!);
  for (const t of list) {
    t.evidence = input.evidence?.[t.id] ?? [];
    t.ready = t.state === "todo" && t.depends_on.every((d) => tasks.get(d)?.state === "done");
  }
  const counts = Object.fromEntries(STATES.map((s) => [s, 0])) as Record<TaskState, number>;
  for (const t of list) counts[t.state] += 1;
  return { board: input.board, agents: input.agents, tasks: list, counts };
}
