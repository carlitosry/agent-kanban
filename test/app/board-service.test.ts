import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BoardService } from "../../src/app/board-service.js";
import { agents, setupBoard, task, tmpDir } from "../helpers/fixtures.js";

const B = "b1";
let ctx: Awaited<ReturnType<typeof tmpDir>>;
beforeEach(async () => {
  ctx = await tmpDir();
});
afterEach(() => ctx.cleanup());

const code = (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e: { code?: string }) => e.code ?? "other",
  );

/** Drives A through preflight -> in_progress -> in_review. */
async function toReview(svc: BoardService, id: string, assignee = "dev") {
  await svc.preflight(B, "rev", id, "approve");
  await svc.move(B, assignee, id, "in_progress");
  await svc.move(B, assignee, id, "in_review");
}

describe("boards", () => {
  it("creates, lists and rejects duplicates and bad ids", async () => {
    const svc = new BoardService(ctx.dir);
    const meta = await svc.createBoard({ id: "x", title: "X", plans: ["p.md"] });
    expect(meta.plans).toEqual(["p.md"]);
    expect((await svc.listBoards()).map((b) => b.id)).toEqual(["x"]);
    expect(await code(svc.createBoard({ id: "x", title: "X" }))).toBe("validation_error");
    expect(await code(svc.createBoard({ id: "../x", title: "X" }))).toBe("validation_error");
    expect(await code(svc.getState("nope"))).toBe("not_found");
    expect(svc.eventsPath("x")).toBe(join(ctx.dir, "x", "events.jsonl"));
  });

  it("importSeed returns problems and writes nothing when the seed is invalid", async () => {
    const svc = new BoardService(ctx.dir);
    await svc.createBoard({ id: B, title: "B" });
    const res = await svc.importSeed(B, {
      tasks: [task("A", { owns_files: ["f"] }), task("B", { owns_files: ["f"] })],
      agents,
    });
    expect(res.problems.join()).toMatch(/owned by several tasks/);
    expect((await svc.getState(B)).tasks).toEqual([]);
  });

  it("importSeed stores tasks, agents and plans; validate is clean", async () => {
    const svc = await setupBoard([task("A"), task("B", { depends_on: ["A"] })], ctx.dir);
    const s = await svc.getState(B);
    expect(s.tasks.map((t) => t.id)).toEqual(["A", "B"]);
    expect(s.agents).toHaveLength(agents.length);
    expect(await svc.validate(B)).toEqual([]);
    expect((await svc.next(B)).map((t) => t.id)).toEqual(["A"]);
  });
});

describe("workflow", () => {
  it("full happy path todo -> done with review approve, history recorded", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    await toReview(svc, "A");
    const done = await svc.review(B, "rev", "A", "approve", "lgtm");
    expect(done.state).toBe("done");
    expect(done.review).toMatchObject({ verdict: "approve", by: "rev", note: "lgtm" });
    expect(done.history.map((h) => h.type)).toEqual(["preflight", "move", "move", "review"]);
  });

  it("dependencies_pending, then ready once the dependency is done", async () => {
    const svc = await setupBoard([task("A"), task("B", { depends_on: ["A"] })], ctx.dir);
    await svc.preflight(B, "rev", "B", "approve");
    expect(await code(svc.move(B, "dev", "B", "in_progress"))).toBe("dependencies_pending");
    await toReview(svc, "A");
    await svc.review(B, "rev", "A", "approve");
    expect((await svc.next(B)).map((t) => t.id)).toEqual(["B"]);
    expect((await svc.move(B, "dev", "B", "in_progress")).state).toBe("in_progress");
  });

  it("preflight_required without preflight, after a blocking preflight, and again after replacement", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.move(B, "dev", "A", "in_progress"))).toBe("preflight_required");
    const blocked = await svc.preflight(B, "rev", "A", "block", "unclear");
    expect(blocked.state).toBe("todo");
    expect(blocked.preflight?.verdict).toBe("block");
    expect(await code(svc.move(B, "dev", "A", "in_progress"))).toBe("preflight_required");
    await svc.preflight(B, "rev", "A", "approve");
    expect(await code(svc.move(B, "dev", "A", "in_progress"))).toBe("ok");
  });

  it("invalid transitions are rejected", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.move(B, "orch", "A", "done"))).toBe("invalid_transition");
    expect(await code(svc.move(B, "orch", "A", "in_review"))).toBe("invalid_transition");
    await toReview(svc, "A");
    await svc.review(B, "rev", "A", "approve");
    expect(await code(svc.move(B, "rev", "A", "in_progress"))).toBe("invalid_transition");
    expect(await code(svc.block(B, "rev", "A", "x"))).toBe("invalid_transition");
  });

  it("review changes sends back and counts rounds; review human blocks with question", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    await toReview(svc, "A");
    let t = await svc.review(B, "rev", "A", "changes", "fix it");
    expect(t).toMatchObject({ state: "in_progress", review_rounds: 1 });
    await svc.move(B, "dev", "A", "in_review");
    t = await svc.review(B, "rev", "A", "human", "need decision", "Ship it?");
    expect(t).toMatchObject({ state: "blocked", blocked_from: "in_review", question: "Ship it?" });
    t = await svc.unblock(B, "carlos", "A", "yes ship");
    expect(t).toMatchObject({ state: "in_review" });
    expect(t.question).toBeUndefined();
    expect(t.history.at(-1)).toMatchObject({ type: "unblock", note: "yes ship" });
  });

  it("the reviewer can send back via move in_review -> in_progress; the assignee cannot", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    await toReview(svc, "A");
    expect(await code(svc.move(B, "dev", "A", "in_progress"))).toBe("not_assignee");
    expect((await svc.move(B, "orch", "A", "in_progress", "return")).state).toBe("in_progress");
  });

  it("block / unblock restores the previous state and cannot unblock a non-blocked task", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.unblock(B, "dev", "A"))).toBe("invalid_transition");
    await svc.preflight(B, "rev", "A", "approve");
    await svc.move(B, "dev", "A", "in_progress");
    const b = await svc.block(B, "dev", "A", "stuck", "Which API?");
    expect(b).toMatchObject({ state: "blocked", blocked_from: "in_progress", question: "Which API?" });
    expect(await code(svc.block(B, "dev", "A", "again"))).toBe("invalid_transition");
    expect(await code(svc.move(B, "dev", "A", "in_review"))).toBe("invalid_transition");
    expect((await svc.unblock(B, "carlos", "A")).state).toBe("in_progress");
  });

  it("comment adds history without changing state", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const t = await svc.comment(B, "dev2", "A", "hello");
    expect(t.state).toBe("todo");
    expect(t.history.at(-1)).toMatchObject({ type: "comment", note: "hello", by: "dev2" });
    expect(await code(svc.comment(B, "ghost", "A", "x"))).toBe("not_found");
  });
});

describe("permissions", () => {
  it("only the assignee, orchestrator, reviewer or human can move a task", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    await svc.preflight(B, "rev", "A", "approve");
    expect(await code(svc.move(B, "dev2", "A", "in_progress"))).toBe("not_assignee");
    expect(await code(svc.block(B, "dev2", "A", "x"))).toBe("not_assignee");
    expect(await code(svc.move(B, "ghost", "A", "in_progress"))).toBe("not_found");
    expect((await svc.move(B, "orch", "A", "in_progress")).state).toBe("in_progress");
  });

  it("done only by reviewer or human via move", async () => {
    const svc = await setupBoard([task("A"), task("C")], ctx.dir);
    await toReview(svc, "A");
    await toReview(svc, "C");
    expect(await code(svc.move(B, "dev", "A", "done"))).toBe("not_assignee");
    expect((await svc.move(B, "rev", "A", "done")).state).toBe("done");
    expect((await svc.move(B, "carlos", "C", "done")).state).toBe("done");
  });

  it("preflight and review require a reviewer or a human", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.preflight(B, "dev", "A", "approve"))).toBe("not_assignee");
    expect(await code(svc.preflight(B, "orch", "A", "approve"))).toBe("not_assignee");
    expect(await code(svc.preflight(B, "carlos", "A", "approve"))).toBe("ok");
    await svc.move(B, "dev", "A", "in_progress");
    await svc.move(B, "dev", "A", "in_review");
    expect(await code(svc.review(B, "dev", "A", "approve"))).toBe("not_assignee");
    expect(await code(svc.review(B, "orch", "A", "approve"))).toBe("not_assignee");
    expect(await code(svc.review(B, "carlos", "A", "approve"))).toBe("ok");
  });

  it("review only applies to in_review and preflight only to todo", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.review(B, "rev", "A", "approve"))).toBe("invalid_transition");
    await toReview(svc, "A");
    expect(await code(svc.preflight(B, "rev", "A", "approve"))).toBe("invalid_transition");
  });
});

describe("tasks and agents", () => {
  it("createTask appends a task_created event and the task shows up in state", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const t = await svc.createTask(B, "orch", task("N"));
    expect(t).toMatchObject({ id: "N", state: "todo" });
    expect((await svc.getState(B)).tasks.map((x) => x.id)).toEqual(["A", "N"]);
  });

  it("createTask rejects duplicates, bad deps, wave file conflicts and malformed input", async () => {
    const svc = await setupBoard([task("A", { owns_files: ["f.ts"] })], ctx.dir);
    expect(await code(svc.createTask(B, "orch", task("A")))).toBe("validation_error");
    expect(await code(svc.createTask(B, "orch", task("N", { depends_on: ["Z"] })))).toBe("validation_error");
    expect(await code(svc.createTask(B, "orch", task("N", { owns_files: ["f.ts"] })))).toBe("validation_error");
    expect(await code(svc.createTask(B, "orch", task("N", { assignee: "ghost" })))).toBe("validation_error");
    expect(await code(svc.createTask(B, "orch", { id: "N" } as never))).toBe("validation_error");
    expect(await code(svc.createTask(B, "orch", task("../N")))).toBe("validation_error");
    expect(await code(svc.createTask(B, "dev", task("N2", { assignee: "dev2" })))).toBe("not_assignee");
  });

  it("updateTask patches fields; reassigning emits assign; rejects id change and conflicts", async () => {
    const svc = await setupBoard([task("A"), task("C")], ctx.dir);
    const t = await svc.updateTask(B, "orch", "A", { title: "Renamed" });
    expect(t.title).toBe("Renamed");
    const r = await svc.updateTask(B, "orch", "A", { assignee: "dev2" });
    expect(r.assignee).toBe("dev2");
    expect(r.history.at(-1)?.type).toBe("assign");
    expect(await code(svc.updateTask(B, "orch", "A", { id: "X" }))).toBe("validation_error");
    expect(await code(svc.updateTask(B, "orch", "A", { owns_files: ["src/C.ts"] }))).toBe("validation_error");
    expect(await code(svc.updateTask(B, "dev", "A", { title: "x" }))).toBe("not_assignee");
    expect(await code(svc.updateTask(B, "orch", "ZZ", { title: "x" }))).toBe("not_found");
  });

  it("addAgent / updateAgent", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const a = await svc.addAgent(B, { id: "new", name: "New", role: "implementer", color: "#fff", kind: "agent" });
    expect(a.id).toBe("new");
    expect(await code(svc.addAgent(B, a))).toBe("validation_error");
    expect((await svc.updateAgent(B, "new", { name: "Renamed" })).name).toBe("Renamed");
    expect(await code(svc.updateAgent(B, "ghost", { name: "x" }))).toBe("not_found");
    expect(await code(svc.updateAgent(B, "new", { id: "other" }))).toBe("validation_error");
  });

  it("addEvidence stores the file, lists it in the task and rejects traversal", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    await svc.addEvidence(B, "A", "shot.png", Buffer.from("png"));
    expect((await svc.getState(B)).tasks[0]!.evidence).toEqual(["shot.png"]);
    expect((await readFile(join(ctx.dir, B, "evidence", "A", "shot.png"))).toString()).toBe("png");
    expect(await code(svc.addEvidence(B, "A", "../x.png", Buffer.from("")))).toBe("validation_error");
    expect(await code(svc.addEvidence(B, "Z", "x.png", Buffer.from("")))).toBe("not_found");
  });

  it("statusText summarizes counts and open tasks", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const text = await svc.statusText(B);
    expect(text).toMatch(/todo 1 \| in_progress 0/);
    expect(text).toMatch(/\[todo\] A Task A \(@dev\) — ready/);
  });
});

describe("state from events", () => {
  it("a fresh service instance reconstructs the same state from disk", async () => {
    const svc = await setupBoard([task("A"), task("B", { depends_on: ["A"] })], ctx.dir);
    await toReview(svc, "A");
    await svc.review(B, "rev", "A", "approve");
    const again = new BoardService(ctx.dir);
    const s = await again.getState(B);
    expect(s.counts).toMatchObject({ done: 1, todo: 1 });
    expect(s.tasks.find((t) => t.id === "B")?.ready).toBe(true);
  });
});

describe("concurrent writers", () => {
  it("two services writing through the same log keep every event intact", async () => {
    const tasks = Array.from({ length: 10 }, (_, i) => task(`T${i}`));
    const s1 = await setupBoard(tasks, ctx.dir);
    const s2 = new BoardService(ctx.dir);
    await Promise.all(
      tasks.flatMap((t, i) => [
        (i % 2 ? s1 : s2).comment(B, "dev", t.id, `c-${t.id}`),
        (i % 2 ? s2 : s1).preflight(B, "rev", t.id, "approve"),
      ]),
    );
    const lines = (await readFile(s1.eventsPath(B), "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(1 + 20); // board_created + 20 events
    lines.forEach((l) => JSON.parse(l));
    const state = await s1.getState(B);
    expect(state.tasks.every((t) => t.preflight?.verdict === "approve" && t.history.length === 2)).toBe(true);
  });
});

describe("atomic rule checks under contention", () => {
  const fulfilled = (r: PromiseSettledResult<unknown>) => r.status === "fulfilled";

  it("two racing moves to in_progress: exactly one wins", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const other = new BoardService(ctx.dir);
    await svc.preflight(B, "rev", "A", "approve");
    const res = await Promise.allSettled([svc.move(B, "dev", "A", "in_progress"), other.move(B, "orch", "A", "in_progress")]);
    expect(res.filter(fulfilled)).toHaveLength(1);
    const moves = (await svc.getState(B)).tasks[0]!.history.filter((h) => h.type === "move");
    expect(moves).toHaveLength(1);
  });

  it("racing review approve vs changes: exactly one is recorded", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const other = new BoardService(ctx.dir);
    await toReview(svc, "A");
    const res = await Promise.allSettled([svc.review(B, "rev", "A", "approve"), other.review(B, "carlos", "A", "changes")]);
    expect(res.filter(fulfilled)).toHaveLength(1);
    expect((await svc.getState(B)).tasks[0]!.history.filter((h) => h.type === "review")).toHaveLength(1);
  });

  it("move vs block race always yields a replayable sequence (each from matches the previous state)", async () => {
    for (let round = 0; round < 5; round++) {
      const svc = await setupBoard([task("A")], ctx.dir, `r${round}`);
      const other = new BoardService(ctx.dir);
      await svc.preflight(`r${round}`, "rev", "A", "approve");
      await svc.move(`r${round}`, "dev", "A", "in_progress");
      await Promise.allSettled([
        svc.move(`r${round}`, "dev", "A", "in_review"),
        other.block(`r${round}`, "orch", "A", "stop"),
        svc.block(`r${round}`, "dev", "A", "stop too"),
      ]);
      let cur = "todo";
      for (const h of (await svc.getState(`r${round}`)).tasks[0]!.history) {
        if (h.type !== "move" && h.type !== "block") continue;
        expect(h.from).toBe(cur);
        cur = h.to!;
      }
    }
  });

  it("concurrent addAgent from two services keeps both agents", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    const other = new BoardService(ctx.dir);
    const mk = (id: string) => ({ id, name: id, role: "implementer", color: "#000", kind: "agent" as const });
    await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? svc : other).addAgent(B, mk(`n${i}`))));
    const ids = (await svc.getState(B)).agents.map((a) => a.id);
    for (let i = 0; i < 10; i++) expect(ids).toContain(`n${i}`);
  });

  it("a generic move to blocked requires a note", async () => {
    const svc = await setupBoard([task("A")], ctx.dir);
    expect(await code(svc.move(B, "dev", "A", "blocked"))).toBe("validation_error");
    expect(await code(svc.move(B, "dev", "A", "blocked", "  "))).toBe("validation_error");
    expect((await svc.move(B, "dev", "A", "blocked", "waiting")).state).toBe("blocked");
  });
});
