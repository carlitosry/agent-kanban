import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { run, type CliIo } from "../../src/cli/commands.js";
import { agents, task, tmpDir } from "../helpers/fixtures.js";

let dir: string;
let cleanup: () => Promise<void>;
let out: string[];
let err: string[];

const io = (env: Record<string, string> = {}): CliIo => ({
  out: (s) => out.push(s),
  err: (s) => err.push(s),
  env,
  cwd: dir,
});
const cli = (...argv: string[]) => run([...argv, "--data-dir", join(dir, "data")], io());
const dirEnv = () => ({ KANBAN_DATA_DIR: join(dir, "data") });

beforeEach(async () => {
  ({ dir, cleanup } = await tmpDir());
  out = [];
  err = [];
});
afterEach(() => cleanup());

async function seeded(): Promise<void> {
  const seed = join(dir, "seed.json");
  await writeFile(seed, JSON.stringify({ tasks: [task("T1"), task("T2", { depends_on: ["T1"] })], agents }));
  expect(await cli("init", "b1", "--title", "Board")).toBe(0);
  expect(await cli("import", seed, "--board", "b1")).toBe(0);
}

describe("cli", () => {
  it("init, import, validate, status, next", async () => {
    await seeded();
    expect(await cli("validate", "--board", "b1")).toBe(0);
    out.length = 0;
    expect(await cli("next", "--board", "b1")).toBe(0);
    expect(out.join("")).toContain("T1");
    expect(out.join("")).not.toContain("T2");
    out.length = 0;
    expect(await cli("status", "--board", "b1")).toBe(0);
    expect(out.join("")).toContain("todo 2");
  });

  it("infers the only board when --board is missing", async () => {
    await seeded();
    expect(await cli("status")).toBe(0);
  });

  it("move happy path and --json", async () => {
    await seeded();
    expect(await cli("preflight", "T1", "approve", "--by", "rev", "--board", "b1")).toBe(0);
    out.length = 0;
    expect(await cli("move", "T1", "in_progress", "--by", "dev", "--board", "b1", "--json")).toBe(0);
    expect(JSON.parse(out.join("")).state).toBe("in_progress");
  });

  it("domain error: exit 1 with code on stderr", async () => {
    await seeded();
    expect(await cli("move", "T1", "in_progress", "--by", "dev", "--board", "b1")).toBe(1);
    expect(err.join("")).toContain("preflight_required");
  });

  it("domain error with --json prints the error object to stdout", async () => {
    await seeded();
    out.length = 0;
    expect(await cli("move", "T1", "in_progress", "--by", "dev", "--board", "b1", "--json")).toBe(1);
    expect(JSON.parse(out.join("")).error.code).toBe("preflight_required");
  });

  it("usage errors give exit 2", async () => {
    await seeded();
    expect(await cli("bogus")).toBe(2);
    expect(await cli("move", "T1", "in_progress", "--board", "b1")).toBe(2); // no --by
    expect(await cli("move", "T1", "--by", "dev", "--board", "b1")).toBe(2); // no target
    expect(await cli("status", "--nope")).toBe(2);
    expect(await cli()).toBe(2);
  });

  it("--by can come from env", async () => {
    await seeded();
    await cli("preflight", "T1", "approve", "--by", "rev", "--board", "b1");
    const code = await run(["move", "T1", "in_progress", "--board", "b1", "--data-dir", join(dir, "data")], io({ AGENT_KANBAN_BY: "dev" }));
    expect(code).toBe(0);
  });

  it("block, unblock, comment, review and agents add", async () => {
    await seeded();
    expect(await cli("block", "T1", "--note", "stuck", "--question", "why", "--by", "dev", "--board", "b1")).toBe(0);
    expect(await cli("unblock", "T1", "--note", "because", "--by", "carlos", "--board", "b1")).toBe(0);
    expect(await cli("comment", "T1", "hello", "world", "--by", "dev", "--board", "b1")).toBe(0);
    expect(await cli("agents", "add", "zed", "--name", "Zed", "--role", "implementer", "--board", "b1")).toBe(0);
    expect(await cli("review", "T1", "approve", "--by", "rev", "--board", "b1")).toBe(1); // not in review
    expect(await cli("review", "T1", "maybe", "--by", "rev", "--board", "b1")).toBe(1); // bad verdict -> validation_error
  });

  it("import reports seed problems with exit 1", async () => {
    await cli("init", "b1", "--title", "B");
    const seed = join(dir, "bad.json");
    await writeFile(seed, JSON.stringify({ tasks: [task("T1", { assignee: "ghost" })], agents }));
    expect(await cli("import", seed, "--board", "b1")).toBe(1);
    expect(err.join("")).toContain("ghost");
  });

  it("missing file on import is exit 1 not a crash", async () => {
    await cli("init", "b1", "--title", "B");
    expect(await cli("import", join(dir, "nope.json"), "--board", "b1")).toBe(1);
  });

  it("positional board form for every command", async () => {
    const seed = join(dir, "seed.json");
    await writeFile(seed, JSON.stringify({ tasks: [task("T1")], agents }));
    expect(await cli("init", "b1", "--title", "B")).toBe(0);
    expect(await cli("init", "b2", "--title", "B2")).toBe(0); // two boards: no implicit board
    expect(await cli("import", "b1", seed)).toBe(0);
    expect(await cli("validate", "b1")).toBe(0);
    expect(await cli("status", "b1")).toBe(0);
    expect(await cli("next", "b1")).toBe(0);
    expect(await cli("status")).toBe(2);
    expect(await cli("preflight", "b1", "T1", "approve", "--by", "rev")).toBe(0);
    expect(await cli("move", "b1", "T1", "in_progress", "--by", "dev")).toBe(0);
    expect(await cli("comment", "b1", "T1", "a", "note", "--by", "dev")).toBe(0);
    expect(await cli("block", "b1", "T1", "--note", "x", "--question", "q", "--by", "dev")).toBe(0);
    expect(await cli("unblock", "b1", "T1", "--note", "a", "--by", "carlos")).toBe(0);
    expect(await cli("agents", "b1", "add", "zed", "--name", "Z", "--role", "implementer")).toBe(0);
    expect(await cli("move", "b1", "T1", "in_review", "--by", "dev")).toBe(0);
    expect(await cli("review", "b1", "T1", "approve", "--by", "rev")).toBe(0);
    expect(await cli("status", "b9")).toBe(1); // unknown board -> not_found
  });

  it("KANBAN_DATA_DIR and its legacy alias select the data dir; default is ./docs/kanban", async () => {
    await cli("init", "b1", "--title", "B");
    expect(await run(["status", "b1"], io(dirEnv()))).toBe(0);
    expect(await run(["status", "b1"], io({ AGENT_KANBAN_DATA_DIR: join(dir, "data") }))).toBe(0);
    expect(await run(["init", "d1", "--title", "D"], io())).toBe(0);
    expect(await run(["status", "d1"], io())).toBe(0);
    const { existsSync } = await import("node:fs");
    expect(existsSync(join(dir, "docs", "kanban", "d1", "board.json"))).toBe(true);
  });
});

describe("cli up args", () => {
  it("up <unknown board> fails before starting; bad KANBAN_PORT is a usage error", async () => {
    const o = { ...io(), env: { KANBAN_PORT: "abc" } };
    expect(await run(["up", "b1", "--no-open", "--data-dir", join(dir, "data")], o)).toBe(2);
    expect(await cli("up", "ghost", "--no-open", "--port", "0")).toBe(1);
  });
});
