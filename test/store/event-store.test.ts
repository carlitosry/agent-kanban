import { appendFile, readFile, utimes, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventStore } from "../../src/store/event-store.js";
import type { KanbanEvent } from "../../src/core/types.js";
import { tmpDir } from "../helpers/fixtures.js";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");

const mk = (n: number, by = "w"): KanbanEvent => ({
  ts: new Date(Date.UTC(2026, 0, 1, 0, 0, 0, n)).toISOString(),
  board: "b",
  by,
  type: "comment",
  task: "T",
  note: `note ${n} ` + "x".repeat(2000), // large lines make torn writes visible
});

let ctx: Awaited<ReturnType<typeof tmpDir>>;
beforeEach(async () => {
  ctx = await tmpDir();
});
afterEach(() => ctx.cleanup());

describe("EventStore", () => {
  it("appends one event per line and reads them back", async () => {
    const s = new EventStore(ctx.dir);
    await s.append("b", mk(1));
    await s.append("b", mk(2));
    const lines = (await readFile(s.eventsPath("b"), "utf8")).trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect((await s.readAll("b")).map((e) => e.ts)).toEqual([mk(1).ts, mk(2).ts]);
  });

  it("returns [] when the log does not exist and skips a corrupt line", async () => {
    const s = new EventStore(ctx.dir);
    expect(await s.readAll("b")).toEqual([]);
    await s.append("b", mk(1));
    await appendFile(s.eventsPath("b"), "{not json\n");
    await s.append("b", mk(2));
    expect(await s.readAll("b")).toHaveLength(2);
  });

  it("rejects path traversal in the board id", async () => {
    const s = new EventStore(ctx.dir);
    await expect(s.append("../evil", mk(1))).rejects.toMatchObject({ code: "validation_error" });
  });

  it("does not corrupt the log with concurrent writers in one process", async () => {
    const s = new EventStore(ctx.dir);
    const n = 100;
    await Promise.all(Array.from({ length: n }, (_, i) => s.append("b", mk(i, `w${i % 2}`))));
    const events = await s.readAll("b");
    expect(events).toHaveLength(n);
    const raw = (await readFile(s.eventsPath("b"), "utf8")).trimEnd().split("\n");
    expect(raw).toHaveLength(n);
    expect(new Set(events.map((e) => e.ts)).size).toBe(n);
  });

  it("does not corrupt the log with two concurrent writer processes", async () => {
    const script = join(here, "writer.ts");
    const per = 60;
    const spawn = (id: string) =>
      run(process.execPath, ["--import", "tsx", script, ctx.dir, "b", id, String(per)], { cwd: root });
    await Promise.all([spawn("A"), spawn("B")]);

    const raw = (await readFile(join(ctx.dir, "b", "events.jsonl"), "utf8")).trimEnd().split("\n");
    expect(raw).toHaveLength(per * 2);
    const parsed = raw.map((l) => JSON.parse(l) as KanbanEvent); // throws on any torn/interleaved line
    for (const w of ["A", "B"]) {
      expect(parsed.filter((e) => e.by === w).map((e) => e.note?.split(" ")[1])).toHaveLength(per);
    }
  });

  it("transaction runs critical sections one at a time and appends via the provided function", async () => {
    const s = new EventStore(ctx.dir);
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        s.transaction("b", async (append) => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 2));
          await append(mk(i));
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
    expect(await s.readAll("b")).toHaveLength(20);
  });

  it("breaks a stale lock safely: waiters never overlap and never delete a fresh lock", async () => {
    const s = new EventStore(ctx.dir, { staleMs: 200 });
    await mkdir(join(ctx.dir, "b"), { recursive: true });
    const lock = join(ctx.dir, "b", "events.jsonl.lock");
    await writeFile(lock, "dead-owner");
    const old = new Date(Date.now() - 60_000);
    await utimes(lock, old, old);
    let inside = 0;
    let maxInside = 0;
    await Promise.all(
      Array.from({ length: 25 }, (_, i) =>
        s.transaction("b", async (append) => {
          inside++;
          maxInside = Math.max(maxInside, inside);
          await new Promise((r) => setTimeout(r, 15)); // longer than staleMs/… keeps the lock fresh via heartbeat
          await append(mk(i));
          inside--;
        }),
      ),
    );
    expect(maxInside).toBe(1);
    expect(await s.readAll("b")).toHaveLength(25);
  });
});
