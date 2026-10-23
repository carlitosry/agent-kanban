import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { BoardService } from "../app/board-service.js";
import { DomainError } from "../core/errors.js";
import type { Agent, TaskSeed, TaskState } from "../core/types.js";
import { CliError, UsageError } from "./errors.js";
import { DEFAULT_PORT, runDown, runUp } from "./up.js";

export interface CliIo {
  out(text: string): void;
  err(text: string): void;
  env: Record<string, string | undefined>;
  cwd: string;
  /** Test hook: replaces the browser opener used by `up`. */
  openUrl?: (url: string) => void;
}

const OPTIONS = {
  "data-dir": { type: "string" },
  by: { type: "string" },
  board: { type: "string" },
  json: { type: "boolean" },
  note: { type: "string" },
  question: { type: "string" },
  title: { type: "string" },
  description: { type: "string" },
  name: { type: "string" },
  role: { type: "string" },
  color: { type: "string" },
  kind: { type: "string" },
  port: { type: "string" },
  "web-dir": { type: "string" },
  "no-open": { type: "boolean" },
  help: { type: "boolean", short: "h" },
} as const;

const USAGE = `agent-kanban <command> [args] [--data-dir <dir>] [--board <id>] [--by <agent>] [--json]

  init <board> --title <t> [--description <d>]
  import <board> <tasks.json>      tasks (+ agents, plans) into the board
  validate <board> | status <board> | next <board>
  move <board> <task> <state> [--note n]
  block <board> <task> --note n [--question q]
  unblock <board> <task> [--note n]
  comment <board> <task> <text...>
  review <board> <task> approve|changes|human [--note n] [--question q]
  preflight <board> <task> approve|block [--note n]
  agents <board> add <id> --name n --role r [--color c] [--kind agent|human]
  up <board> [--port ${DEFAULT_PORT}] [--no-open] [--web-dir d]   down

<board> may be omitted when --board / AGENT_KANBAN_BOARD is set or the data dir has exactly one board.
Env: KANBAN_DATA_DIR (default ./docs/kanban), KANBAN_PORT (default ${DEFAULT_PORT}), AGENT_KANBAN_BOARD, AGENT_KANBAN_BY. Exit: 0 ok, 1 domain error, 2 usage.
`;

type Values = ReturnType<typeof parseArgs<{ options: typeof OPTIONS; allowPositionals: true }>>["values"];

interface Ctx {
  io: CliIo;
  values: Values;
  args: string[];
  /** Board given positionally (`<command> <board> ...`); wins over --board and the environment. */
  positionalBoard?: string;
  service: BoardService;
  dataDir: string;
}

export async function run(argv: string[], io: CliIo): Promise<number> {
  try {
    return await dispatch(argv, io);
  } catch (err) {
    if (err instanceof UsageError) {
      io.err(`usage error: ${err.message}\n`);
      return 2;
    }
    const json = argv.includes("--json");
    if (err instanceof DomainError) {
      if (json) io.out(JSON.stringify(err.toJSON()) + "\n");
      else io.err(`error [${err.code}]: ${err.message}\n`);
      return 1;
    }
    if (err instanceof CliError) {
      io.err(`error: ${err.message}\n`);
      return 1;
    }
    throw err;
  }
}

async function dispatch(argv: string[], io: CliIo): Promise<number> {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTIONS, allowPositionals: true });
  } catch (err) {
    throw new UsageError((err as Error).message);
  }
  const { values, positionals } = parsed;
  const [command, ...args] = positionals;
  if (values.help || !command) {
    io.err(USAGE);
    return values.help ? 0 : 2;
  }
  const dataDir = resolve(
    io.cwd,
    values["data-dir"] ?? io.env.KANBAN_DATA_DIR ?? io.env.AGENT_KANBAN_DATA_DIR ?? "docs/kanban",
  );
  const ctx: Ctx = { io, values, args, service: new BoardService(dataDir), dataDir };
  const handler = HANDLERS[command];
  if (!handler) throw new UsageError(`unknown command: ${command}`);
  await takePositionalBoard(command, ctx);
  return handler(ctx);
}

const BOARD_FIRST = new Set(["validate", "status", "next", "up"]);
const TASK_COMMANDS = new Set(["move", "block", "unblock", "comment", "review", "preflight"]);

/**
 * `<command> <board> ...` is the primary form; the old forms (board via --board/env/only board) still work.
 * Task commands are ambiguous with free text, so their first argument counts as a board only when such a board exists.
 */
async function takePositionalBoard(command: string, c: Ctx): Promise<void> {
  const { args } = c;
  if (BOARD_FIRST.has(command)) {
    if (args.length > 0) c.positionalBoard = args.shift();
  } else if (command === "import") {
    if (args.length >= 2) c.positionalBoard = args.shift();
  } else if (command === "agents") {
    if (args.length > 0 && args[0] !== "add") c.positionalBoard = args.shift();
  } else if (TASK_COMMANDS.has(command) && args.length >= 2 && !c.values.board) {
    const boards = await c.service.listBoards();
    if (boards.some((b) => b.id === args[0])) c.positionalBoard = args.shift();
  }
}

// --- helpers ---

const need = (value: string | undefined, what: string): string => {
  if (!value) throw new UsageError(`${what} is required`);
  return value;
};

function by(c: Ctx): string {
  return need(c.values.by ?? c.io.env.AGENT_KANBAN_BY, "--by <agent> (or AGENT_KANBAN_BY)");
}

async function boardId(c: Ctx): Promise<string> {
  const given = c.positionalBoard ?? c.values.board ?? c.io.env.AGENT_KANBAN_BOARD;
  if (given) return given;
  const boards = await c.service.listBoards();
  if (boards.length === 1 && boards[0]) return boards[0].id;
  throw new UsageError("--board <id> is required (or AGENT_KANBAN_BOARD)");
}

function print(c: Ctx, data: unknown, text: string): number {
  c.io.out((c.values.json ? JSON.stringify(data, null, 2) : text) + "\n");
  return 0;
}

const taskLine = (t: { id: string; state: string; title: string; assignee: string }) =>
  `[${t.state}] ${t.id} ${t.title} (@${t.assignee})`;

type Handler = (c: Ctx) => Promise<number>;

const taskAction =
  (call: (c: Ctx, board: string, actor: string, task: string) => Promise<{ id: string; state: string; title: string; assignee: string }>): Handler =>
  async (c) => {
    const task = need(c.args[0], "<task>");
    const view = await call(c, await boardId(c), by(c), task);
    return print(c, view, taskLine(view));
  };

const HANDLERS: Record<string, Handler> = {
  async init(c) {
    const id = need(c.args[0], "<board-id>");
    const meta = await c.service.createBoard({
      id,
      title: need(c.values.title, "--title"),
      ...(c.values.description ? { description: c.values.description } : {}),
    });
    return print(c, meta, `created board ${meta.id}`);
  },

  async import(c) {
    const file = resolve(c.io.cwd, need(c.args[0], "<seed.json>"));
    let data: unknown;
    try {
      data = JSON.parse(await readFile(file, "utf8"));
    } catch (err) {
      throw new CliError(`cannot read ${file}: ${(err as Error).message}`);
    }
    const seed = (Array.isArray(data) ? { tasks: data } : data) as { tasks: TaskSeed[]; agents?: Agent[]; plans?: string[] };
    if (!Array.isArray(seed.tasks)) throw new CliError("seed must contain a `tasks` array");
    const { problems } = await c.service.importSeed(await boardId(c), seed);
    if (problems.length > 0) {
      if (c.values.json) c.io.out(JSON.stringify({ problems }) + "\n");
      else c.io.err(problems.map((p) => `problem: ${p}\n`).join(""));
      return 1;
    }
    return print(c, { imported: seed.tasks.length }, `imported ${seed.tasks.length} tasks`);
  },

  async validate(c) {
    const problems = await c.service.validate(await boardId(c));
    if (problems.length === 0) return print(c, { problems }, "ok");
    if (c.values.json) c.io.out(JSON.stringify({ problems }) + "\n");
    else c.io.err(problems.map((p) => `problem: ${p}\n`).join(""));
    return 1;
  },

  async status(c) {
    const id = await boardId(c);
    if (c.values.json) return print(c, await c.service.getState(id), "");
    return print(c, null, await c.service.statusText(id));
  },

  async next(c) {
    const ready = await c.service.next(await boardId(c));
    return print(c, ready, ready.length ? ready.map(taskLine).join("\n") : "no ready tasks");
  },

  move: taskAction((c, b, who, task) => {
    const to = need(c.args[1], "<state>") as TaskState;
    return c.service.move(b, who, task, to, c.values.note);
  }),

  block: taskAction((c, b, who, task) => {
    const note = c.values.note ?? c.args.slice(1).join(" ");
    return c.service.block(b, who, task, need(note, "--note"), c.values.question);
  }),

  unblock: taskAction((c, b, who, task) => c.service.unblock(b, who, task, c.values.note ?? (c.args.slice(1).join(" ") || undefined))),

  comment: taskAction((c, b, who, task) => {
    const note = c.values.note ?? c.args.slice(1).join(" ");
    return c.service.comment(b, who, task, need(note, "<text>"));
  }),

  review: taskAction((c, b, who, task) => {
    const verdict = need(c.args[1], "<verdict>") as "approve" | "changes" | "human";
    return c.service.review(b, who, task, verdict, c.values.note, c.values.question);
  }),

  preflight: taskAction((c, b, who, task) => {
    const verdict = need(c.args[1], "<verdict>") as "approve" | "block";
    return c.service.preflight(b, who, task, verdict, c.values.note);
  }),

  async agents(c) {
    if (c.args[0] !== "add") throw new UsageError("usage: agents add <id> --name n --role r");
    const kind = c.values.kind ?? "agent";
    if (kind !== "agent" && kind !== "human") throw new UsageError("--kind must be agent or human");
    const agent = await c.service.addAgent(await boardId(c), {
      id: need(c.args[1], "<id>"),
      name: need(c.values.name, "--name"),
      role: need(c.values.role, "--role"),
      color: c.values.color ?? "#64748b",
      kind,
    });
    return print(c, agent, `added agent ${agent.id}`);
  },

  async up(c) {
    const raw = c.values.port ?? c.io.env.KANBAN_PORT;
    const port = raw === undefined ? DEFAULT_PORT : Number(raw);
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new UsageError("--port / KANBAN_PORT must be 0-65535");
    const board = c.positionalBoard ?? c.values.board ?? c.io.env.AGENT_KANBAN_BOARD;
    if (board) await c.service.getState(board); // fail early (not_found) before starting
    await runUp({
      ...(board ? { board } : {}),
      service: c.service,
      dataDir: c.dataDir,
      port,
      open: !c.values["no-open"],
      ...(c.values["web-dir"] ? { webDir: resolve(c.io.cwd, c.values["web-dir"]) } : {}),
      ...(c.io.openUrl ? { openUrl: c.io.openUrl } : {}),
      log: (line) => c.io.out(line + "\n"),
    });
    return 0; // the listening server keeps the process alive
  },

  async down(c) {
    const r = await runDown(c.dataDir);
    if (r.status === "stopped") return print(c, r, `stopped pid ${r.pid}`);
    c.io.err(r.status === "stale" ? "stale pid file removed; not running\n" : "not running\n");
    return 1;
  },
};
