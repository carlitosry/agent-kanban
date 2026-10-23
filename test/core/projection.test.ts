import { describe, expect, it } from "vitest";
import { projectBoard } from "../../src/core/projection.js";
import type { BoardMeta, KanbanEvent } from "../../src/core/types.js";
import { agents, task } from "../helpers/fixtures.js";

const board: BoardMeta = { id: "b", title: "B", created_at: "2026-01-01T00:00:00Z", plans: [] };
const ev = (n: number, e: Partial<KanbanEvent>): KanbanEvent => ({
  ts: `2026-01-01T00:00:${String(n).padStart(2, "0")}Z`,
  board: "b",
  by: "orch",
  type: "comment",
  ...e,
});
const project = (events: KanbanEvent[], seed = [task("A"), task("B", { depends_on: ["A"] })]) =>
  projectBoard({ board, agents, seed, events });
const get = (s: ReturnType<typeof project>, id: string) => s.tasks.find((t) => t.id === id)!;

describe("projectBoard", () => {
  it("starts every seed task in todo; only tasks without pending deps are ready", () => {
    const s = project([]);
    expect(get(s, "A")).toMatchObject({ state: "todo", ready: true, review_rounds: 0 });
    expect(get(s, "B").ready).toBe(false);
    expect(s.counts).toEqual({ todo: 2, in_progress: 0, in_review: 0, done: 0, blocked: 0 });
  });

  it("applies task_created and task_updated on top of the seed", () => {
    const s = project([
      ev(1, { type: "task_created", task: "C", payload: { ...task("C") } }),
      ev(2, { type: "task_updated", task: "C", payload: { title: "New title" } }),
    ]);
    expect(get(s, "C").title).toBe("New title");
    expect(s.tasks).toHaveLength(3);
  });

  it("applies task_updated that arrives before task_created in the file (ts order wins)", () => {
    const s = project([
      ev(2, { type: "task_updated", task: "C", payload: { title: "Later" } }),
      ev(1, { type: "task_created", task: "C", payload: { ...task("C") } }),
    ]);
    expect(get(s, "C").title).toBe("Later");
  });

  it("orders events by ts regardless of file order", () => {
    const s = project([
      ev(3, { type: "move", task: "A", from: "in_progress", to: "in_review" }),
      ev(1, { type: "preflight", task: "A", payload: { verdict: "approve" } }),
      ev(2, { type: "move", task: "A", from: "todo", to: "in_progress" }),
    ]);
    expect(get(s, "A").state).toBe("in_review");
    expect(get(s, "A").history.map((h) => h.type)).toEqual(["preflight", "move", "move"]);
  });

  it("preflight keeps todo and a new preflight replaces the previous one", () => {
    const s = project([
      ev(1, { type: "preflight", task: "A", payload: { verdict: "block" }, note: "no" }),
      ev(2, { type: "preflight", task: "A", payload: { verdict: "approve" } }),
    ]);
    expect(get(s, "A").state).toBe("todo");
    expect(get(s, "A").preflight).toMatchObject({ verdict: "approve", by: "orch" });
  });

  it("review approve -> done, which makes dependants ready", () => {
    const s = project([
      ev(1, { type: "move", task: "A", from: "todo", to: "in_progress" }),
      ev(2, { type: "move", task: "A", from: "in_progress", to: "in_review" }),
      ev(3, { type: "review", task: "A", by: "rev", payload: { verdict: "approve" } }),
    ]);
    expect(get(s, "A")).toMatchObject({ state: "done", review: { verdict: "approve" } });
    expect(get(s, "B").ready).toBe(true);
  });

  it("review changes -> in_progress and increments review_rounds", () => {
    const s = project([
      ev(1, { type: "move", task: "A", from: "todo", to: "in_progress" }),
      ev(2, { type: "move", task: "A", from: "in_progress", to: "in_review" }),
      ev(3, { type: "review", task: "A", by: "rev", payload: { verdict: "changes" } }),
      ev(4, { type: "move", task: "A", from: "in_progress", to: "in_review" }),
      ev(5, { type: "review", task: "A", by: "rev", payload: { verdict: "changes" } }),
    ]);
    expect(get(s, "A")).toMatchObject({ state: "in_progress", review_rounds: 2 });
  });

  it("review human -> blocked with question; unblock restores in_review and clears question", () => {
    const base = [
      ev(1, { type: "move", task: "A", from: "todo", to: "in_progress" }),
      ev(2, { type: "move", task: "A", from: "in_progress", to: "in_review" }),
      ev(3, { type: "review", task: "A", by: "rev", payload: { verdict: "human" }, question: "ok?" }),
    ];
    expect(get(project(base), "A")).toMatchObject({ state: "blocked", blocked_from: "in_review", question: "ok?" });
    const s = project([...base, ev(4, { type: "unblock", task: "A", by: "carlos", note: "yes" })]);
    const a = get(s, "A");
    expect(a.state).toBe("in_review");
    expect(a.question).toBeUndefined();
    expect(a.blocked_from).toBeUndefined();
  });

  it("block remembers the previous state and unblock returns to it", () => {
    const s = project([
      ev(1, { type: "move", task: "A", from: "todo", to: "in_progress" }),
      ev(2, { type: "block", task: "A", from: "in_progress", to: "blocked", question: "why?" }),
    ]);
    expect(get(s, "A")).toMatchObject({ state: "blocked", blocked_from: "in_progress", question: "why?" });
    const u = project([
      ev(1, { type: "move", task: "A", from: "todo", to: "in_progress" }),
      ev(2, { type: "block", task: "A", from: "in_progress", to: "blocked" }),
      ev(3, { type: "unblock", task: "A" }),
    ]);
    expect(get(u, "A").state).toBe("in_progress");
  });

  it("includes evidence file names and ignores events for unknown tasks", () => {
    const s = projectBoard({
      board, agents, seed: [task("A")], events: [ev(1, { type: "comment", task: "ZZ" })],
      evidence: { A: ["shot.png"] },
    });
    expect(get(s, "A").evidence).toEqual(["shot.png"]);
    expect(s.tasks).toHaveLength(1);
  });
});
