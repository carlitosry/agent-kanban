import { appendFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventsHub } from "../../src/server/events-hub.js";
import type { KanbanEvent } from "../../src/core/types.js";
import { setupBoard, task, tmpDir } from "../helpers/fixtures.js";
import type { BoardService } from "../../src/app/board-service.js";

let cleanup: () => Promise<void>;
let dir: string;
let svc: BoardService;
let hub: EventsHub;

beforeEach(async () => {
  ({ dir, cleanup } = await tmpDir());
  svc = await setupBoard([task("T1")], dir);
  hub = new EventsHub((id) => svc.eventsPath(id));
});
afterEach(async () => {
  hub.close();
  await cleanup();
});

function waitFor(got: KanbanEvent[], n: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`timeout, got ${got.length}`)), 5000);
    const i = setInterval(() => {
      if (got.length >= n) {
        clearTimeout(t);
        clearInterval(i);
        resolve();
      }
    }, 10);
  });
}

describe("EventsHub", () => {
  it("emits only events appended after subscribing, including external writes", async () => {
    const got: KanbanEvent[] = [];
    const unsub = await hub.subscribe("b1", (e) => got.push(e));
    await svc.comment("b1", "dev", "T1", "one");
    await svc.comment("b1", "dev", "T1", "two");
    await waitFor(got, 2);
    expect(got.map((e) => e.note)).toEqual(["one", "two"]);
    unsub();
  });

  it("buffers a partial line until completed", async () => {
    const got: KanbanEvent[] = [];
    await hub.subscribe("b1", (e) => got.push(e));
    const ev = JSON.stringify({ ts: "t", board: "b1", by: "dev", type: "comment", task: "T1", note: "x" });
    await appendFile(svc.eventsPath("b1"), ev.slice(0, 10));
    await new Promise((r) => setTimeout(r, 150));
    expect(got).toHaveLength(0);
    await appendFile(svc.eventsPath("b1"), ev.slice(10) + "\n");
    await waitFor(got, 1);
    expect(got[0]?.note).toBe("x");
  });

  it("stops delivering after unsubscribe", async () => {
    const got: KanbanEvent[] = [];
    const unsub = await hub.subscribe("b1", (e) => got.push(e));
    unsub();
    await svc.comment("b1", "dev", "T1", "late");
    await new Promise((r) => setTimeout(r, 200));
    expect(got).toHaveLength(0);
  });
});
