import { watch, type FSWatcher } from "node:fs";
import { open, stat } from "node:fs/promises";
import { basename, dirname } from "node:path";
import type { KanbanEvent } from "../core/types.js";

type Listener = (event: KanbanEvent) => void;

interface Channel {
  watcher: FSWatcher;
  listeners: Set<Listener>;
  offset: number;
  pending: string;
  reading: Promise<void>;
  again: boolean;
}

/**
 * Tails `events.jsonl` per board with `fs.watch` (so writes made by other processes, e.g. the CLI,
 * are seen) and fans new events out to subscribers. Only lines appended after the first
 * subscription are delivered; a partially written last line is held until its newline arrives.
 */
export class EventsHub {
  private readonly channels = new Map<string, Channel>();

  constructor(private readonly eventsPath: (boardId: string) => string) {}

  async subscribe(boardId: string, listener: Listener): Promise<() => void> {
    let channel = this.channels.get(boardId);
    if (!channel) {
      channel = await this.open(boardId);
      this.channels.set(boardId, channel);
    }
    channel.listeners.add(listener);
    return () => {
      const c = this.channels.get(boardId);
      if (!c) return;
      c.listeners.delete(listener);
      if (c.listeners.size === 0) {
        c.watcher.close();
        this.channels.delete(boardId);
      }
    };
  }

  close(): void {
    for (const c of this.channels.values()) c.watcher.close();
    this.channels.clear();
  }

  private async open(boardId: string): Promise<Channel> {
    const file = this.eventsPath(boardId);
    const offset = await stat(file).then((s) => s.size, () => 0);
    // Watch the directory: the file may not exist yet and editors/rotations may replace it.
    const watcher = watch(dirname(file), (_type, name) => {
      if (name === null || name === basename(file)) this.pump(channel, file);
    });
    watcher.on("error", () => undefined);
    const channel: Channel = { watcher, listeners: new Set(), offset, pending: "", reading: Promise.resolve(), again: false };
    return channel;
  }

  /** Serialises reads so concurrent fs.watch notifications never reorder or duplicate events. */
  private pump(channel: Channel, file: string): void {
    channel.again = true;
    channel.reading = channel.reading.then(async () => {
      while (channel.again) {
        channel.again = false;
        await this.readNew(channel, file).catch(() => undefined);
      }
    });
  }

  private async readNew(channel: Channel, file: string): Promise<void> {
    const size = await stat(file).then((s) => s.size, () => 0);
    if (size < channel.offset) {
      channel.offset = 0; // truncated or replaced
      channel.pending = "";
    }
    if (size === channel.offset) return;
    const handle = await open(file, "r");
    try {
      const buf = Buffer.alloc(size - channel.offset);
      const { bytesRead } = await handle.read(buf, 0, buf.length, channel.offset);
      channel.offset += bytesRead;
      channel.pending += buf.subarray(0, bytesRead).toString("utf8");
    } finally {
      await handle.close();
    }
    const lines = channel.pending.split("\n");
    channel.pending = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      let event: KanbanEvent;
      try {
        event = JSON.parse(line) as KanbanEvent;
      } catch {
        continue;
      }
      for (const l of [...channel.listeners]) l(event);
    }
  }
}
