import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DomainError } from "../core/errors.js";
import { assertValidId } from "../core/ids.js";
import type { Agent, BoardMeta, TaskSeed } from "../core/types.js";
import { EventStore } from "./event-store.js";

/** File layout: <data-dir>/<board-id>/{board.json,tasks.json,agents.json,events.jsonl,evidence/<task-id>/}. */
export class BoardStore {
  readonly events: EventStore;

  constructor(readonly dataDir: string) {
    this.events = new EventStore(dataDir);
  }

  boardDir(boardId: string): string {
    assertValidId("board", boardId);
    return join(this.dataDir, boardId);
  }

  async listBoardIds(): Promise<string[]> {
    let entries;
    try {
      entries = await readdir(this.dataDir, { withFileTypes: true });
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const ids: string[] = [];
    for (const e of entries) {
      if (!e.isDirectory()) continue;
      try {
        await readFile(join(this.dataDir, e.name, "board.json"));
        ids.push(e.name);
      } catch {
        // not a board
      }
    }
    return ids.sort();
  }

  async exists(boardId: string): Promise<boolean> {
    try {
      await readFile(join(this.boardDir(boardId), "board.json"));
      return true;
    } catch {
      return false;
    }
  }

  async readMeta(boardId: string): Promise<BoardMeta> {
    const meta = await this.readJson<BoardMeta | undefined>(boardId, "board.json", undefined);
    if (!meta) throw new DomainError("not_found", `board not found: ${boardId}`);
    return meta;
  }

  writeMeta(meta: BoardMeta): Promise<void> {
    return this.writeJson(meta.id, "board.json", meta);
  }

  readSeed(boardId: string): Promise<TaskSeed[]> {
    return this.readJson<TaskSeed[]>(boardId, "tasks.json", []);
  }

  writeSeed(boardId: string, tasks: TaskSeed[]): Promise<void> {
    return this.writeJson(boardId, "tasks.json", tasks);
  }

  readAgents(boardId: string): Promise<Agent[]> {
    return this.readJson<Agent[]>(boardId, "agents.json", []);
  }

  writeAgents(boardId: string, agents: Agent[]): Promise<void> {
    return this.writeJson(boardId, "agents.json", agents);
  }

  evidenceDir(boardId: string, taskId: string): string {
    assertValidId("task", taskId);
    return join(this.boardDir(boardId), "evidence", taskId);
  }

  async listEvidence(boardId: string): Promise<Record<string, string[]>> {
    const root = join(this.boardDir(boardId), "evidence");
    const result: Record<string, string[]> = {};
    let dirs;
    try {
      dirs = await readdir(root, { withFileTypes: true });
    } catch {
      return result;
    }
    for (const d of dirs) {
      if (d.isDirectory()) result[d.name] = (await readdir(join(root, d.name))).sort();
    }
    return result;
  }

  async writeEvidence(boardId: string, taskId: string, file: string, data: Buffer): Promise<void> {
    const dir = this.evidenceDir(boardId, taskId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, file), data);
  }

  private async readJson<T>(boardId: string, name: string, fallback: T): Promise<T> {
    try {
      return JSON.parse(await readFile(join(this.boardDir(boardId), name), "utf8")) as T;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
      throw err;
    }
  }

  /** Atomic write (temp file + rename) so readers never see a partial file. */
  private async writeJson(boardId: string, name: string, data: unknown): Promise<void> {
    const dir = this.boardDir(boardId);
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `.${name}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`);
    await writeFile(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
    await rename(tmp, join(dir, name));
  }
}
