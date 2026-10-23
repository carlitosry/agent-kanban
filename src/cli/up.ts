import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { BoardService } from "../app/board-service.js";
import { startServer } from "../server/index.js";
import { CliError } from "./errors.js";

export const DEFAULT_PORT = 4090;

export function pidFilePath(dataDir: string): string {
  return join(dataDir, ".agent-kanban.pid");
}

export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(false));
    probe.listen(port, "127.0.0.1", () => probe.close(() => resolve(true)));
  });
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function readPid(dataDir: string): Promise<number | null> {
  const raw = await readFile(pidFilePath(dataDir), "utf8").catch(() => null);
  const pid = raw === null ? NaN : Number.parseInt(raw.trim(), 10);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

/** Looks for the built web app next to the compiled CLI (dist/cli -> dist/web) or the repo's dist/web. */
export function defaultWebDir(): string | undefined {
  const candidates = ["../web", "../../dist/web", "./web"].map((rel) => fileURLToPath(new URL(rel, import.meta.url)));
  return candidates.find((dir) => existsSync(join(dir, "index.html")));
}

export function openInBrowser(url: string): void {
  const [cmd, args]: [string, string[]] =
    process.platform === "darwin" ? ["open", [url]] : process.platform === "win32" ? ["cmd", ["/c", "start", "", url]] : ["xdg-open", [url]];
  const child = spawn(cmd, args, { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

export interface UpOptions {
  service: BoardService;
  dataDir: string;
  port: number;
  /** Board to open in the browser (`/#/<id>`). */
  board?: string;
  open: boolean;
  webDir?: string;
  openUrl?: (url: string) => void;
  /** Install SIGINT/SIGTERM handlers that clean up and exit (default true). */
  signals?: boolean;
  log?: (line: string) => void;
}

export interface UpHandle {
  port: number;
  close(): Promise<void>;
}

export async function runUp(options: UpOptions): Promise<UpHandle> {
  const existing = await readPid(options.dataDir);
  if (existing !== null && isAlive(existing)) {
    throw new CliError(`agent-kanban already running (pid ${existing}); use \`agent-kanban down\``);
  }
  if (options.port !== 0 && !(await isPortFree(options.port))) {
    throw new CliError(`port ${options.port} is in use; pick another with --port`);
  }
  const webDir = options.webDir ?? defaultWebDir();
  const server = await startServer({ service: options.service, port: options.port, ...(webDir ? { webDir } : {}) });
  await mkdir(options.dataDir, { recursive: true });
  await writeFile(pidFilePath(options.dataDir), `${process.pid}\n`, "utf8");
  const url = `http://127.0.0.1:${server.port}`;
  options.log?.(`agent-kanban listening on ${url} (pid ${process.pid})${webDir ? "" : " [no web build found: API only]"}`);

  let closed = false;
  const close = async (): Promise<void> => {
    if (closed) return;
    closed = true;
    if ((await readPid(options.dataDir)) === process.pid) await unlink(pidFilePath(options.dataDir)).catch(() => undefined);
    await server.close();
  };
  if (options.signals !== false) {
    const stop = () => void close().finally(() => process.exit(0));
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
  }
  if (options.open) {
    (options.openUrl ?? openInBrowser)(options.board ? `${url}/#/${encodeURIComponent(options.board)}` : url);
  }
  return { port: server.port, close };
}

export type DownResult = { status: "stopped"; pid: number } | { status: "not_running" } | { status: "stale" };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function runDown(dataDir: string, timeoutMs = 5000): Promise<DownResult> {
  const pid = await readPid(dataDir);
  if (pid === null) return { status: "not_running" };
  if (!isAlive(pid)) {
    await unlink(pidFilePath(dataDir)).catch(() => undefined);
    return { status: "stale" };
  }
  process.kill(pid, "SIGTERM");
  const deadline = Date.now() + timeoutMs;
  while (isAlive(pid) && Date.now() < deadline) await sleep(50);
  if (isAlive(pid)) throw new CliError(`process ${pid} did not exit after SIGTERM`);
  await unlink(pidFilePath(dataDir)).catch(() => undefined);
  return { status: "stopped", pid };
}
