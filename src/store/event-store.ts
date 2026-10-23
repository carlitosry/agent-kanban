import { appendFile, mkdir, link, open, readFile, rename, stat, unlink } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { assertValidId } from "../core/ids.js";
import type { KanbanEvent } from "../core/types.js";

const LOCK_RETRY_MS = 5;
const LOCK_TIMEOUT_MS = 15_000;
const LOCK_STALE_MS = 10_000;

export type AppendFn = (event: KanbanEvent) => Promise<void>;

export interface EventStoreOptions {
  /** A lock older than this is considered abandoned. */
  staleMs?: number;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Append-only event log with cross-process locking (`events.jsonl.lock`, exclusive creation + retry). */
export class EventStore {
  private readonly staleMs: number;

  constructor(
    private readonly dataDir: string,
    options: EventStoreOptions = {},
  ) {
    this.staleMs = options.staleMs ?? LOCK_STALE_MS;
  }

  eventsPath(boardId: string): string {
    assertValidId("board", boardId);
    return join(this.dataDir, boardId, "events.jsonl");
  }

  async append(boardId: string, event: KanbanEvent): Promise<void> {
    await this.transaction(boardId, (append) => append(event));
  }

  /**
   * Runs `fn` holding the board lock (shared by every writer process). Read state, validate and
   * append inside `fn` so that rule checks and writes are atomic. The lock is not reentrant:
   * use the provided `append`, never `EventStore.append`, inside `fn`.
   */
  async transaction<T>(boardId: string, fn: (append: AppendFn) => Promise<T>): Promise<T> {
    const file = this.eventsPath(boardId);
    await mkdir(join(this.dataDir, boardId), { recursive: true });
    return this.withLock(file + ".lock", () =>
      fn((event) => appendFile(file, JSON.stringify(event) + "\n", "utf8")),
    );
  }

  /** Reads all events; a malformed line (e.g. a torn write) is skipped. */
  async readAll(boardId: string): Promise<KanbanEvent[]> {
    let raw: string;
    try {
      raw = await readFile(this.eventsPath(boardId), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }
    const events: KanbanEvent[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as KanbanEvent);
      } catch {
        // skip corrupt line
      }
    }
    return events;
  }

  private async withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
      try {
        const handle = await open(lockPath, "wx");
        await handle.close();
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        await this.breakIfStale(lockPath);
        if (Date.now() > deadline) throw new Error(`timeout acquiring lock ${lockPath}`);
        await sleep(LOCK_RETRY_MS + Math.random() * 10);
      }
    }
    try {
      return await fn();
    } finally {
      await unlink(lockPath).catch(() => undefined);
    }
  }

  /**
   * Breaks an abandoned lock. Breakers are serialized by `<lock>.break` (exclusive creation), the
   * lock is then renamed to a unique name (atomic, so nobody else can unlink it), and if what was
   * renamed turns out to be fresh (its owner released and someone re-acquired in between) it is
   * linked back instead of being destroyed.
   */
  private async breakIfStale(lockPath: string): Promise<void> {
    const guard = lockPath + ".break";
    try {
      await (await open(guard, "wx")).close();
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      await this.removeIfOlderThan(guard); // a crashed breaker must not wedge the board
      return;
    }
    try {
      if (!(await this.isStale(lockPath))) return;
      const moved = `${lockPath}.stale.${process.pid}.${randomUUID()}`;
      try {
        await rename(lockPath, moved);
      } catch {
        return; // released meanwhile
      }
      if (await this.isStale(moved)) {
        await unlink(moved).catch(() => undefined);
      } else {
        await link(moved, lockPath).catch(() => undefined); // restore a fresh lock we grabbed by mistake
        await unlink(moved).catch(() => undefined);
      }
    } finally {
      await unlink(guard).catch(() => undefined);
    }
  }

  private async isStale(path: string): Promise<boolean> {
    try {
      return Date.now() - (await stat(path)).mtimeMs > this.staleMs;
    } catch {
      return false;
    }
  }

  private async removeIfOlderThan(path: string): Promise<void> {
    if (await this.isStale(path)) await unlink(path).catch(() => undefined);
  }
}
