import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { z } from "zod";
import type { BoardService } from "../app/board-service.js";
import { DomainError } from "../core/errors.js";
import { assertValidId } from "../core/ids.js";
import type { Agent, TaskSeed } from "../core/types.js";
import { EventsHub } from "./events-hub.js";
import { mimeFor, readStatic } from "./static.js";

export interface AppOptions {
  service: BoardService;
  /** Directory with the built web app; when absent only the API is served. */
  webDir?: string;
  /** Seconds between SSE `ping` events (default 25). */
  pingSeconds?: number;
  hub?: EventsHub;
}

const note = z.string().optional();
const verdictReview = z.enum(["approve", "changes", "human"]);
const verdictPreflight = z.enum(["approve", "block"]);
const states = z.enum(["todo", "in_progress", "in_review", "done", "blocked"]);

const schemas = {
  board: z.object({ id: z.string(), title: z.string(), description: z.string().optional() }),
  createTask: z.object({ task: z.record(z.unknown()) }),
  patch: z.object({ patch: z.record(z.unknown()) }),
  move: z.object({ to: states, note }),
  block: z.object({ note: z.string(), question: z.string().optional() }),
  unblock: z.object({ note }),
  comment: z.object({ note: z.string() }),
  review: z.object({ verdict: verdictReview, note, question: z.string().optional() }),
  preflight: z.object({ verdict: verdictPreflight, note }),
};

export function createApp(options: AppOptions): Hono {
  const { service } = options;
  const hub = options.hub ?? new EventsHub((id) => service.eventsPath(id));
  const app = new Hono();

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json(err.toJSON(), err.status as 400);
    if (err instanceof SyntaxError) return c.json(new DomainError("validation_error", "malformed JSON body").toJSON(), 400);
    console.error(err);
    return c.json({ error: { code: "internal_error", message: "internal server error" } }, 500);
  });

  app.use("*", async (c, next) => {
    const forbidden = (message: string) =>
      c.json({ error: { code: "forbidden_origin", message } }, 403);
    if (!isLocalHost(c.req.header("host") ?? new URL(c.req.url).host)) return forbidden("Host must be 127.0.0.1 or localhost");
    const origin = c.req.header("origin");
    if (origin !== undefined && !isLocalOrigin(origin)) return forbidden("Origin must be a localhost origin");
    if (BODY_METHODS.has(c.req.method) && !/^application\/json\s*(;|$)/i.test(c.req.header("content-type") ?? "")) {
      return c.json({ error: { code: "validation_error", message: "Content-Type must be application/json" } }, 415);
    }
    await next();
  });

  /** Parses the JSON body with Zod and extracts the actor (`by` in body, else `x-actor` header). */
  async function input<S extends z.ZodTypeAny>(c: Context, schema: S): Promise<{ by: string; data: z.infer<S> }> {
    const raw = (await c.req.json()) as unknown;
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
      throw new DomainError("validation_error", "body must be a JSON object");
    }
    const { by: bodyBy, ...rest } = raw as Record<string, unknown>;
    const by = typeof bodyBy === "string" && bodyBy ? bodyBy : c.req.header("x-actor");
    if (!by) throw new DomainError("validation_error", "actor required: `by` in body or x-actor header");
    return { by, data: zodParse(schema, rest) };
  }

  const board = (c: Context) => c.req.param("id") ?? "";
  const taskId = (c: Context) => c.req.param("taskId") ?? "";

  app.get("/api/boards", async (c) => c.json(await service.listBoards()));

  app.post("/api/boards", async (c) => {
    const body = zodParse(schemas.board, await c.req.json());
    const { description, ...rest } = body;
    return c.json(await service.createBoard({ ...rest, ...(description ? { description } : {}) }), 201);
  });

  app.get("/api/boards/:id", async (c) => c.json(await service.getState(board(c))));

  app.post("/api/boards/:id/tasks", async (c) => {
    const { by, data } = await input(c, schemas.createTask);
    return c.json(await service.createTask(board(c), by, data.task as unknown as TaskSeed), 201);
  });

  app.patch("/api/boards/:id/tasks/:taskId", async (c) => {
    const { by, data } = await input(c, schemas.patch);
    return c.json(await service.updateTask(board(c), by, taskId(c), data.patch as Partial<TaskSeed>));
  });

  app.post("/api/boards/:id/tasks/:taskId/move", async (c) => {
    const { by, data } = await input(c, schemas.move);
    return c.json(await service.move(board(c), by, taskId(c), data.to, data.note));
  });

  app.post("/api/boards/:id/tasks/:taskId/block", async (c) => {
    const { by, data } = await input(c, schemas.block);
    return c.json(await service.block(board(c), by, taskId(c), data.note, data.question));
  });

  app.post("/api/boards/:id/tasks/:taskId/unblock", async (c) => {
    const { by, data } = await input(c, schemas.unblock);
    return c.json(await service.unblock(board(c), by, taskId(c), data.note));
  });

  app.post("/api/boards/:id/tasks/:taskId/comment", async (c) => {
    const { by, data } = await input(c, schemas.comment);
    return c.json(await service.comment(board(c), by, taskId(c), data.note));
  });

  app.post("/api/boards/:id/tasks/:taskId/review", async (c) => {
    const { by, data } = await input(c, schemas.review);
    return c.json(await service.review(board(c), by, taskId(c), data.verdict, data.note, data.question));
  });

  app.post("/api/boards/:id/tasks/:taskId/preflight", async (c) => {
    const { by, data } = await input(c, schemas.preflight);
    return c.json(await service.preflight(board(c), by, taskId(c), data.verdict, data.note));
  });

  app.post("/api/boards/:id/agents", async (c) => {
    return c.json(await service.addAgent(board(c), (await c.req.json()) as Agent), 201);
  });

  app.patch("/api/boards/:id/agents/:agentId", async (c) => {
    const patch = (await c.req.json()) as Partial<Agent>;
    return c.json(await service.updateAgent(board(c), c.req.param("agentId") ?? "", patch));
  });

  app.get("/api/boards/:id/events", async (c) => {
    const id = board(c);
    await service.getState(id); // 404 for unknown boards
    return streamSSE(c, async (stream) => {
      const queue: string[] = [];
      let wake: (() => void) | undefined;
      const unsubscribe = await hub.subscribe(id, (event) => {
        queue.push(JSON.stringify(event));
        wake?.();
      });
      let closed = false;
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const ping = setInterval(() => wake?.(), (options.pingSeconds ?? 25) * 1000);
      let lastPing = Date.now();
      try {
        await stream.writeSSE({ event: "ping", data: "" });
        while (!closed) {
          const next = queue.shift();
          if (next !== undefined) {
            await stream.writeSSE({ event: "kanban", data: next });
            continue;
          }
          if (Date.now() - lastPing >= (options.pingSeconds ?? 25) * 1000) {
            await stream.writeSSE({ event: "ping", data: "" });
            lastPing = Date.now();
          }
          await new Promise<void>((resolveWake) => {
            wake = resolveWake;
          });
          wake = undefined;
        }
      } finally {
        clearInterval(ping);
        unsubscribe();
      }
    });
  });

  app.get("/api/boards/:id/evidence/:taskId/:file", async (c) => {
    const id = board(c);
    const task = taskId(c);
    const file = c.req.param("file") ?? "";
    assertValidId("board", id);
    assertValidId("task", task);
    assertValidId("evidence file", file);
    const path = join(dirname(service.eventsPath(id)), "evidence", task, file);
    const data = await readFile(path).catch(() => null);
    if (!data) throw new DomainError("not_found", `evidence not found: ${file}`);
    return new Response(new Uint8Array(data), { headers: { "content-type": mimeFor(file) } });
  });

  app.all("/api/*", (c) => c.json(new DomainError("not_found", "route not found").toJSON(), 404));

  if (options.webDir) {
    const root = resolve(options.webDir);
    app.get("*", async (c) => {
      const file = await readStatic(root, new URL(c.req.url).pathname);
      if (!file) return c.json(new DomainError("not_found", "not found").toJSON(), 404);
      return new Response(new Uint8Array(file.body), { headers: { "content-type": file.type } });
    });
  }

  return app;
}

const BODY_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);
const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]"]);

function isLocalHost(host: string): boolean {
  try {
    return LOCAL_HOSTNAMES.has(new URL(`http://${host}`).hostname);
  } catch {
    return false;
  }
}

function isLocalOrigin(origin: string): boolean {
  try {
    const u = new URL(origin);
    return (u.protocol === "http:" || u.protocol === "https:") && LOCAL_HOSTNAMES.has(u.hostname);
  } catch {
    return false;
  }
}

function zodParse<S extends z.ZodTypeAny>(schema: S, value: unknown): z.infer<S> {
  const r = schema.safeParse(value);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("; ");
    throw new DomainError("validation_error", msg);
  }
  return r.data;
}
