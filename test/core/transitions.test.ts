import { describe, expect, it } from "vitest";
import { DomainError } from "../../src/core/errors.js";
import { projectBoard } from "../../src/core/projection.js";
import { assertMove, isValidTransition } from "../../src/core/transitions.js";
import type { TaskState, TaskView } from "../../src/core/types.js";
import { agents, task } from "../helpers/fixtures.js";

const STATES: TaskState[] = ["todo", "in_progress", "in_review", "done", "blocked"];

function view(state: TaskState, over: Partial<TaskView> = {}): TaskView {
  const base = projectBoard({
    board: { id: "b", title: "B", created_at: "", plans: [] },
    agents,
    seed: [task("T")],
    events: [],
  }).tasks[0]!;
  return { ...base, state, ...over };
}

describe("isValidTransition", () => {
  const valid: Array<[TaskState, TaskState]> = [
    ["todo", "in_progress"],
    ["in_progress", "in_review"],
    ["in_review", "done"],
    ["in_review", "in_progress"],
    ["todo", "blocked"],
    ["in_progress", "blocked"],
    ["in_review", "blocked"],
  ];
  const validSet = new Set(valid.map(([a, b]) => `${a}>${b}`));

  for (const from of STATES) {
    for (const to of STATES) {
      if (from === "blocked") continue; // covered below
      const expected = validSet.has(`${from}>${to}`);
      it(`${from} -> ${to} is ${expected ? "valid" : "invalid"}`, () => {
        expect(isValidTransition({ state: from }, to)).toBe(expected);
      });
    }
  }

  it("blocked only returns to blocked_from", () => {
    expect(isValidTransition({ state: "blocked", blocked_from: "in_progress" }, "in_progress")).toBe(true);
    expect(isValidTransition({ state: "blocked", blocked_from: "in_progress" }, "todo")).toBe(false);
    expect(isValidTransition({ state: "blocked", blocked_from: "in_progress" }, "done")).toBe(false);
    expect(isValidTransition({ state: "blocked", blocked_from: "in_progress" }, "blocked")).toBe(false);
    expect(isValidTransition({ state: "blocked" }, "todo")).toBe(false);
  });
});

describe("assertMove", () => {
  const codeOf = (fn: () => void) => {
    try {
      fn();
    } catch (e) {
      return (e as DomainError).code;
    }
    return "ok";
  };
  const approved = { verdict: "approve" as const, by: "rev", ts: "t" };
  const dep = (state: TaskState) => view(state, { id: "D" });

  it("example: dependency in_progress -> dependencies_pending", () => {
    const t = view("todo", { depends_on: ["D"], preflight: approved });
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t, dep("in_progress")], agents))).toBe("dependencies_pending");
  });

  it("missing preflight -> preflight_required", () => {
    const t = view("todo");
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t], agents))).toBe("preflight_required");
  });

  it("blocking preflight -> preflight_required", () => {
    const t = view("todo", { preflight: { ...approved, verdict: "block" } });
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t], agents))).toBe("preflight_required");
  });

  it("deps done and preflight approved -> ok", () => {
    const t = view("todo", { depends_on: ["D"], preflight: approved });
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t, dep("done")], agents))).toBe("ok");
  });

  it("dependencies are checked before preflight", () => {
    const t = view("todo", { depends_on: ["D"] });
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t, dep("todo")], agents))).toBe("dependencies_pending");
  });

  it("a non-assignee implementer gets not_assignee", () => {
    const t = view("in_progress");
    expect(codeOf(() => assertMove("dev2", t, "in_review", [t], agents))).toBe("not_assignee");
  });

  it("unknown actor gets not_found", () => {
    const t = view("in_progress");
    expect(codeOf(() => assertMove("ghost", t, "in_review", [t], agents))).toBe("not_found");
  });

  it("the assignee cannot set done; reviewer and human can", () => {
    const t = view("in_review");
    expect(codeOf(() => assertMove("dev", t, "done", [t], agents))).toBe("not_assignee");
    expect(codeOf(() => assertMove("orch", t, "done", [t], agents))).toBe("not_assignee");
    expect(codeOf(() => assertMove("rev", t, "done", [t], agents))).toBe("ok");
    expect(codeOf(() => assertMove("carlos", t, "done", [t], agents))).toBe("ok");
  });

  it("send back (in_review -> in_progress): reviewer, orchestrator and human only", () => {
    const t = view("in_review");
    expect(codeOf(() => assertMove("dev", t, "in_progress", [t], agents))).toBe("not_assignee");
    for (const who of ["rev", "orch", "carlos"]) {
      expect(codeOf(() => assertMove(who, t, "in_progress", [t], agents))).toBe("ok");
    }
  });

  it("invalid transitions raise invalid_transition (also from done)", () => {
    const t = view("done");
    expect(codeOf(() => assertMove("rev", t, "blocked", [t], agents))).toBe("invalid_transition");
    expect(codeOf(() => assertMove("rev", t, "in_progress", [t], agents))).toBe("invalid_transition");
    const todo = view("todo");
    expect(codeOf(() => assertMove("rev", todo, "done", [todo], agents))).toBe("invalid_transition");
  });
});
