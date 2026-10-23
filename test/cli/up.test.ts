import { createServer } from "node:net";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isPortFree, pidFilePath, runDown, runUp } from "../../src/cli/up.js";
import { BoardService } from "../../src/app/board-service.js";
import { tmpDir } from "../helpers/fixtures.js";

let dir: string;
let cleanup: () => Promise<void>;
beforeEach(async () => {
  ({ dir, cleanup } = await tmpDir());
});
afterEach(() => cleanup());

describe("port check", () => {
  it("detects an occupied port", async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    expect(await isPortFree(port)).toBe(false);
    await new Promise((r) => srv.close(r));
    expect(await isPortFree(port)).toBe(true);
  });
});

describe("up / down", () => {
  it("up writes the pid file, serves, refuses a second up, and close removes the pid file", async () => {
    const service = new BoardService(dir);
    await service.createBoard({ id: "b1", title: "B" });
    const opened: string[] = [];
    const handle = await runUp({ service, dataDir: dir, port: 0, open: true, openUrl: (u) => opened.push(u), signals: false });
    expect((await readFile(pidFilePath(dir), "utf8")).trim()).toBe(String(process.pid));
    const res = await fetch(`http://127.0.0.1:${handle.port}/api/boards`);
    expect(res.status).toBe(200);
    expect(opened).toEqual([`http://127.0.0.1:${handle.port}`]);
    await expect(runUp({ service, dataDir: dir, port: 0, open: false, signals: false })).rejects.toThrow(/already running/);
    await handle.close();
    await expect(readFile(pidFilePath(dir))).rejects.toThrow();
  });

  it("up with a board opens the browser at that board", async () => {
    const opened: string[] = [];
    const h = await runUp({ service: new BoardService(dir), dataDir: dir, port: 0, board: "my board", open: true, openUrl: (u) => opened.push(u), signals: false });
    expect(opened).toEqual([`http://127.0.0.1:${h.port}/#/my%20board`]);
    await h.close();
  });

  it("up fails when the port is busy", async () => {
    const srv = createServer();
    await new Promise<void>((r) => srv.listen(0, "127.0.0.1", r));
    const port = (srv.address() as { port: number }).port;
    await expect(runUp({ service: new BoardService(dir), dataDir: dir, port, open: false, signals: false })).rejects.toThrow(/in use/);
    await new Promise((r) => srv.close(r));
  });

  it("up does not open the browser with open=false", async () => {
    const opened: string[] = [];
    const h = await runUp({ service: new BoardService(dir), dataDir: dir, port: 0, open: false, openUrl: (u) => opened.push(u), signals: false });
    expect(opened).toEqual([]);
    await h.close();
  });

  it("down reports not running and cleans stale pid files", async () => {
    expect(await runDown(dir)).toEqual({ status: "not_running" });
    await mkdir(dir, { recursive: true });
    await writeFile(pidFilePath(dir), "999999\n");
    expect(await runDown(dir)).toEqual({ status: "stale" });
    await expect(readFile(pidFilePath(dir))).rejects.toThrow();
  });
});
