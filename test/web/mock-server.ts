// Dev-only mock of the HTTP API (CONTRACT §6) to develop/verify the UI without the real server.
// Run: npx tsx test/web/mock-server.ts   (listens on 127.0.0.1:4090, or MOCK_PORT)
import { createServer, type ServerResponse } from "node:http";
import type { Agent, BoardState, KanbanEvent, TaskSeed, TaskState, TaskView } from "../../src/web/types.js";

const now = () => new Date().toISOString();
const agents: Agent[] = [
  { id: "ana", name: "Ana", role: "orchestrator", color: "#7c3aed", kind: "agent" },
  { id: "rev", name: "Rita", role: "reviewer", color: "#0f766e", kind: "agent" },
  { id: "fran", name: "Fran", role: "implementer", color: "#b45309", kind: "agent" },
  { id: "carlos", name: "Carlos", role: "human", color: "#1d4ed8", kind: "human" },
];
const seed = (id: string, title: string, wave: number, phase: string, assignee: string, deps: string[] = []): TaskSeed => ({
  id, title, plan: "docs/plan.md", section: "§" + wave, phase, wave, assignee, depends_on: deps, owns_files: [`src/${id}.ts`],
  acceptance: ["Pasa typecheck", "Tests en verde"], verify: ["npm test"], needs_ui_evidence: id === "T4",
});
const tasks = new Map<string, TaskView>();
const mk = (s: TaskSeed, state: TaskState, extra: Partial<TaskView> = {}) =>
  tasks.set(s.id, { ...s, state, review_rounds: 0, evidence: [], history: [{ ts: now(), board: "demo", task: s.id, by: "ana", type: "task_created" }], ready: false, ...extra });
mk(seed("T1", "Domain model", 1, "Phase 1 · Core", "fran"), "done", { evidence: ["review.md"], review: { verdict: "approve", by: "rev", note: "All good", ts: now() } });
mk(seed("T2", "Event store with locking", 1, "Phase 1 · Core", "fran"), "in_progress");
mk(seed("T3", "REST routes", 2, "Phase 2 · Server", "fran", ["T1"]), "in_review", { review_rounds: 1 });
mk(seed("T4", "Board interface", 2, "Phase 2 · Server", "fran", ["T1"]), "blocked", { blocked_from: "in_progress", question: "Should we use the brand color for the Blocked column?", evidence: ["shot-1.svg"] });
mk(seed("T5", "CLI", 3, "Phase 3 · Delivery", "ana", ["T3"]), "todo");
mk(seed("T6", "Documentation", 3, "Phase 3 · Delivery", "ana"), "todo");

const boards = [{ id: "demo", title: "Demo", description: "Sample board", created_at: now(), plans: ["docs/plan.md"] }];
const clients = new Set<ServerResponse>();

function recompute(): void {
  for (const t of tasks.values()) t.ready = t.state === "todo" && t.depends_on.every((d) => tasks.get(d)?.state === "done");
}
function emit(e: Omit<KanbanEvent, "ts" | "board">): void {
  const ev: KanbanEvent = { ts: now(), board: "demo", ...e };
  if (e.task) tasks.get(e.task)?.history.push(ev);
  recompute();
  for (const c of clients) c.write(`event: kanban\ndata: ${JSON.stringify(ev)}\n\n`);
}
const state = (): BoardState => {
  recompute();
  const counts: Record<TaskState, number> = { todo: 0, in_progress: 0, in_review: 0, done: 0, blocked: 0 };
  for (const t of tasks.values()) counts[t.state]++;
  return { board: boards[0]!, agents, tasks: [...tasks.values()], counts };
};

class HttpError extends Error { constructor(public status: number, public code: string, message: string) { super(message); } }

function handle(method: string, path: string, body: any): unknown {
  let m: RegExpMatchArray | null;
  if (method === "GET" && path === "/api/boards") return boards;
  if (method === "POST" && path === "/api/boards") { const b = { ...body, created_at: now(), plans: [] }; boards.push(b); return b; }
  if (method === "GET" && path === "/api/boards/demo") return state();
  if (method === "POST" && path === "/api/boards/demo/tasks") {
    mk(body.task, "todo"); emit({ task: body.task.id, by: body.by, type: "task_created" }); return tasks.get(body.task.id);
  }
  if (method === "POST" && path === "/api/boards/demo/agents") { agents.push(body); return body; }
  if ((m = path.match(/^\/api\/boards\/demo\/agents\/([^/]+)$/)) && method === "PATCH") {
    const a = agents.find((x) => x.id === m![1]); if (!a) throw new HttpError(404, "not_found", "Agent not found");
    Object.assign(a, body); return a;
  }
  if ((m = path.match(/^\/api\/boards\/demo\/tasks\/([^/]+)(?:\/(\w+))?$/))) {
    const t = tasks.get(m[1]!); if (!t) throw new HttpError(404, "not_found", "Task not found");
    const by: string = body.by;
    switch (`${method} ${m[2] ?? ""}`) {
      case "PATCH ": Object.assign(t, body.patch); emit({ task: t.id, by, type: "task_updated", payload: body.patch }); break;
      case "POST move": {
        const ok = (t.state === "todo" && body.to === "in_progress") || (t.state === "in_progress" && body.to === "in_review")
          || (t.state === "in_review" && ["in_progress", "done"].includes(body.to));
        if (!ok) throw new HttpError(409, "invalid_transition", `No se puede pasar de ${t.state} a ${body.to}`);
        if (t.state === "todo" && !t.ready) throw new HttpError(409, "dependencies_pending", "Dependencias pendientes");
        const from = t.state; t.state = body.to; emit({ task: t.id, by, type: "move", from, to: body.to, note: body.note }); break;
      }
      case "POST block": { const from = t.state; t.blocked_from = from; t.state = "blocked"; t.question = body.question; emit({ task: t.id, by, type: "block", from, to: "blocked", note: body.note, question: body.question }); break; }
      case "POST unblock": { const to = t.blocked_from ?? "todo"; t.state = to; delete t.question; emit({ task: t.id, by, type: "unblock", from: "blocked", to, note: body.note }); break; }
      case "POST comment": emit({ task: t.id, by, type: "comment", note: body.note }); break;
      case "POST preflight": t.preflight = { verdict: body.verdict, by, note: body.note, ts: now() }; emit({ task: t.id, by, type: "preflight", note: body.note, payload: { verdict: body.verdict } }); break;
      case "POST review": {
        t.review = { verdict: body.verdict, by, note: body.note, ts: now() };
        const from = t.state;
        if (body.verdict === "approve") t.state = "done"; else if (body.verdict === "changes") { t.state = "in_progress"; t.review_rounds++; } else { t.state = "blocked"; t.blocked_from = from; t.question = body.question; }
        emit({ task: t.id, by, type: "review", from, to: t.state, note: body.note, question: body.question, payload: { verdict: body.verdict } }); break;
      }
      default: throw new HttpError(404, "not_found", "Ruta no existe");
    }
    return t;
  }
  throw new HttpError(404, "not_found", "Ruta no existe");
}

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="240"><rect width="400" height="240" fill="#e0e7ff"/><text x="200" y="125" text-anchor="middle" font-size="22" fill="#312e81">Captura de ejemplo</text></svg>`;

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/api/boards/demo/events") {
    res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
    res.write("event: ping\ndata: {}\n\n"); clients.add(res); req.on("close", () => clients.delete(res)); return;
  }
  if (url.pathname.startsWith("/api/boards/demo/evidence/")) {
    const f = url.pathname.split("/").pop()!;
    if (f.endsWith(".md")) { res.writeHead(200, { "content-type": "text/markdown" }); res.end("# Review\n\n- Criteria met\n- No findings"); }
    else { res.writeHead(200, { "content-type": "image/svg+xml" }); res.end(SVG); }
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      const out = handle(req.method ?? "GET", url.pathname, raw ? JSON.parse(raw) : {});
      res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(out));
    } catch (e) {
      const err = e instanceof HttpError ? e : new HttpError(500, "error", String(e));
      res.writeHead(err.status, { "content-type": "application/json" }); res.end(JSON.stringify({ error: { code: err.code, message: err.message } }));
    }
  });
}).listen(Number(process.env.MOCK_PORT ?? 4090), "127.0.0.1", () => console.log("mock API on :4090"));

setInterval(() => { for (const c of clients) c.write("event: ping\ndata: {}\n\n"); }, 25000).unref();
