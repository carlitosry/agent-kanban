import { describe, expect, it } from "vitest";
import {
  applyFilters, canReview, dropAction, groupByPhaseWave, groupByState, initial, summarizeAgents, upsertTask, waveOptions,
} from "../../src/web/lib/board.js";
import { resolveTheme, toggleTheme } from "../../src/web/lib/theme.js";
import { formToTask, emptyTaskForm, slugify, splitLines } from "../../src/web/lib/forms.js";
import type { Agent, BoardState, TaskState, TaskView } from "../../src/web/types.js";

const task = (id: string, o: Partial<TaskView> = {}): TaskView => ({
  id, title: id, plan: "p", section: "s", phase: "F1", wave: 1, assignee: "a", depends_on: [], owns_files: [], acceptance: [],
  verify: [], needs_ui_evidence: false, state: "todo", review_rounds: 0, evidence: [], history: [], ready: false, ...o,
});
const agents: Agent[] = [
  { id: "a", name: "Ana", role: "implementer", color: "#111111", kind: "agent" },
  { id: "h", name: "Hugo", role: "human", color: "#222222", kind: "human" },
];

describe("grouping", () => {
  const ts = [task("1", { state: "done" }), task("2", { phase: "F2", wave: 2 }), task("3", { wave: 2 }), task("4", { wave: 1, phase: "F2" })];
  it("groups by state", () => {
    const g = groupByState(ts);
    expect(g.done.map((t) => t.id)).toEqual(["1"]);
    expect(g.todo).toHaveLength(3);
    expect(g.blocked).toEqual([]);
  });
  it("groups by phase (first-seen) and wave (ascending)", () => {
    const g = groupByPhaseWave(ts);
    expect(g.map((p) => p.phase)).toEqual(["F1", "F2"]);
    expect(g[1]!.waves.map((w) => w.wave)).toEqual([1, 2]);
    expect(g[0]!.waves[1]!.tasks.map((t) => t.id)).toEqual(["3"]);
  });
  it("lists wave options sorted and unique", () => expect(waveOptions(ts)).toEqual([1, 2]));
});

describe("filters", () => {
  const ts = [task("1", { assignee: "a", wave: 1 }), task("2", { assignee: "h", wave: 1 }), task("3", { assignee: "a", wave: 2 })];
  it("filters by agent and wave, combined", () => {
    expect(applyFilters(ts, { agent: "", wave: "" })).toHaveLength(3);
    expect(applyFilters(ts, { agent: "a", wave: "" }).map((t) => t.id)).toEqual(["1", "3"]);
    expect(applyFilters(ts, { agent: "a", wave: "2" }).map((t) => t.id)).toEqual(["3"]);
  });
});

describe("agents and state helpers", () => {
  it("summarizes per agent with current task", () => {
    const s = summarizeAgents(agents, [task("1", { state: "in_progress" }), task("2", { state: "done" }), task("3", { assignee: "h" })]);
    expect(s[0]!.current?.id).toBe("1");
    expect(s[0]!.counts.done).toBe(1);
    expect(s[1]!.current).toBeUndefined();
  });
  it("upserts a task and recomputes counts", () => {
    const base: BoardState = { board: { id: "b", title: "B", created_at: "", plans: [] }, agents, tasks: [task("1")],
      counts: { todo: 1, in_progress: 0, in_review: 0, done: 0, blocked: 0 } };
    const moved = upsertTask(base, task("1", { state: "done" }));
    expect(moved.counts.done).toBe(1);
    expect(moved.counts.todo).toBe(0);
    expect(upsertTask(base, task("2")).tasks).toHaveLength(2);
  });
  it("initial and canReview", () => {
    expect(initial("  ana")).toBe("A");
    expect(canReview(agents[1])).toBe(true);
    expect(canReview(agents[0])).toBe(false);
    expect(canReview({ ...agents[0]!, role: "reviewer" })).toBe(true);
    expect(canReview(undefined)).toBe(false);
  });
});

describe("dropAction", () => {
  const drop = (t: TaskView, to: TaskState) => dropAction(t, to);
  it("ignores same column", () => expect(drop(task("1"), "todo")).toEqual({ kind: "none" }));
  it("moves between normal columns", () => expect(drop(task("1"), "in_progress")).toEqual({ kind: "move", to: "in_progress" }));
  it("asks for a reason when dropping on blocked, never from done", () => {
    expect(drop(task("1"), "blocked")).toEqual({ kind: "block" });
    expect(drop(task("1", { state: "done" }), "blocked")).toEqual({ kind: "none" });
  });
  it("unblocks only to the previous state", () => {
    const b = task("1", { state: "blocked", blocked_from: "in_review" });
    expect(drop(b, "in_review")).toEqual({ kind: "unblock" });
    expect(drop(b, "done")).toEqual({ kind: "none" });
  });
});

describe("theme", () => {
  it("prefers stored value, then system", () => {
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme("garbage", false)).toBe("light");
  });
  it("toggles", () => { expect(toggleTheme("dark")).toBe("light"); expect(toggleTheme("light")).toBe("dark"); });
});

describe("forms", () => {
  it("slugifies accents", () => expect(slugify("Tablero Pérez #1")).toBe("tablero-perez-1"));
  it("splits lines", () => expect(splitLines("a\n\n b \n")).toEqual(["a", "b"]));
  it("reports problems for an empty form", () => {
    const r = formToTask(emptyTaskForm());
    expect("problems" in r && r.problems.length).toBeGreaterThan(0);
  });
  it("builds a seed from a valid form", () => {
    const r = formToTask({ ...emptyTaskForm("a"), id: "T1", title: "x", plan: "p", section: "s", phase: "F", wave: "2", depends_on: "T0, T9", acceptance: "uno\ndos" });
    expect("task" in r && r.task).toMatchObject({ id: "T1", wave: 2, depends_on: ["T0", "T9"], acceptance: ["uno", "dos"] });
  });
});

import { boardFromLocation, hashForBoard } from "../../src/web/lib/route.js";
describe("route", () => {
  it("reads hash form, then query form", () => {
    expect(boardFromLocation("", "#/demo")).toBe("demo");
    expect(boardFromLocation("", "#demo")).toBe("demo");
    expect(boardFromLocation("?board=x", "")).toBe("x");
    expect(boardFromLocation("?board=x", "#/y")).toBe("y");
    expect(boardFromLocation("", "")).toBeNull();
    expect(hashForBoard("a b")).toBe("#/a%20b");
  });
});
