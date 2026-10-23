import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Hono } from "hono";
import { BoardService } from "../../src/app/board-service.js";
import { createApp } from "../../src/server/app.js";
import { setupBoard, task, tmpDir } from "../helpers/fixtures.js";

let cleanup: () => Promise<void>;
let dir: string;
let app: Hono;

beforeEach(async () => {
  ({ dir, cleanup } = await tmpDir());
  const svc = await setupBoard([task("T1"), task("T2", { depends_on: ["T1"] })], dir);
  app = createApp({ service: svc });
});
afterEach(() => cleanup());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("REST API", () => {
  it("lists boards and returns state", async () => {
    const list = await (await app.request("/api/boards")).json();
    expect(list.map((b: { id: string }) => b.id)).toEqual(["b1"]);
    const state = await (await app.request("/api/boards/b1")).json();
    expect(state.tasks).toHaveLength(2);
  });

  it("404 for unknown board", async () => {
    const res = await app.request("/api/boards/nope");
    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe("not_found");
  });

  it("creates a board", async () => {
    const res = await post("/api/boards", { id: "b2", title: "Two" });
    expect(res.status).toBe(201);
    expect((await res.json()).id).toBe("b2");
  });

  it("rejects malformed body with 400", async () => {
    const res = await post("/api/boards", { id: "b2" });
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("validation_error");
    const bad = await app.request("/api/boards", { method: "POST", body: "{nope", headers: { "content-type": "application/json" } });
    expect(bad.status).toBe(400);
  });

  it("move with preflight missing gives 409 preflight_required", async () => {
    const res = await post("/api/boards/b1/tasks/T1/move", { by: "dev", to: "in_progress" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("preflight_required");
  });

  it("dependencies_pending is 409", async () => {
    await post("/api/boards/b1/tasks/T2/preflight", { by: "rev", verdict: "approve" });
    const res = await post("/api/boards/b1/tasks/T2/move", { by: "dev", to: "in_progress" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("dependencies_pending");
  });

  it("full flow via routes, actor from body or x-actor header", async () => {
    expect((await post("/api/boards/b1/tasks/T1/preflight", { by: "rev", verdict: "approve" })).status).toBe(200);
    const moved = await post("/api/boards/b1/tasks/T1/move", { to: "in_progress" }, { "x-actor": "dev" });
    expect(moved.status).toBe(200);
    expect((await moved.json()).state).toBe("in_progress");
    await post("/api/boards/b1/tasks/T1/move", { by: "dev", to: "in_review" });
    const rev = await post("/api/boards/b1/tasks/T1/review", { by: "rev", verdict: "approve", note: "ok" });
    expect((await rev.json()).state).toBe("done");
    const c = await post("/api/boards/b1/tasks/T2/comment", { by: "dev", note: "hi" });
    expect(c.status).toBe(200);
  });

  it("missing actor is 400; wrong actor is 403", async () => {
    expect((await post("/api/boards/b1/tasks/T1/move", { to: "in_progress" })).status).toBe(400);
    const res = await post("/api/boards/b1/tasks/T1/move", { by: "dev2", to: "in_progress" });
    expect(res.status).toBe(403);
  });

  it("block and unblock", async () => {
    const b = await post("/api/boards/b1/tasks/T1/block", { by: "dev", note: "stuck", question: "why?" });
    expect((await b.json()).state).toBe("blocked");
    const u = await post("/api/boards/b1/tasks/T1/unblock", { by: "carlos", note: "because" });
    expect((await u.json()).state).toBe("todo");
  });

  it("creates and patches tasks", async () => {
    const created = await post("/api/boards/b1/tasks", { by: "orch", task: task("T3") });
    expect(created.status).toBe(201);
    const patched = await app.request("/api/boards/b1/tasks/T3", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ by: "orch", patch: { title: "New" } }),
    });
    expect((await patched.json()).title).toBe("New");
  });

  it("adds and patches agents", async () => {
    const add = await post("/api/boards/b1/agents", { id: "x", name: "X", role: "implementer", color: "#fff", kind: "agent" });
    expect(add.status).toBe(201);
    const patch = await app.request("/api/boards/b1/agents/x", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Y" }),
    });
    expect((await patch.json()).name).toBe("Y");
  });

  it("serves evidence and blocks traversal", async () => {
    const evDir = join(dir, "b1", "evidence", "T1");
    await mkdir(evDir, { recursive: true });
    await writeFile(join(evDir, "shot.png"), Buffer.from([1, 2, 3]));
    await writeFile(join(evDir, "notes.md"), "# hi");
    const png = await app.request("/api/boards/b1/evidence/T1/shot.png");
    expect(png.status).toBe(200);
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(new Uint8Array(await png.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
    expect((await app.request("/api/boards/b1/evidence/T1/notes.md")).headers.get("content-type")).toContain("text/markdown");
    expect((await app.request("/api/boards/b1/evidence/T1/missing.png")).status).toBe(404);
    expect((await app.request("/api/boards/b1/evidence/T1/..%2F..%2Fboard.json")).status).toBeGreaterThanOrEqual(400);
    expect((await app.request("/api/boards/b1/evidence/..%2F..%2F/x.png")).status).toBeGreaterThanOrEqual(400);
  });
});

describe("static files", () => {
  it("serves dist/web with SPA fallback, never for /api or traversal", async () => {
    const web = join(dir, "web");
    await mkdir(join(web, "assets"), { recursive: true });
    await writeFile(join(web, "index.html"), "<html>app</html>");
    await writeFile(join(web, "assets", "a.js"), "x=1");
    await writeFile(join(dir, "secret.txt"), "secret");
    const svc = new BoardService(dir);
    const a = createApp({ service: svc, webDir: web });
    expect(await (await a.request("/")).text()).toBe("<html>app</html>");
    const js = await a.request("/assets/a.js");
    expect(js.headers.get("content-type")).toContain("javascript");
    expect(await (await a.request("/some/route")).text()).toBe("<html>app</html>");
    expect((await a.request("/api/unknown")).status).toBe(404);
    expect(await (await a.request("/..%2Fsecret.txt")).text()).not.toBe("secret");
  });
});

describe("SSE", () => {
  it("streams new events as `event: kanban`, 404 for unknown board", async () => {
    expect((await app.request("/api/boards/nope/events")).status).toBe(404);
    const ctrl = new AbortController();
    const res = await app.request("/api/boards/b1/events", { signal: ctrl.signal });
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let text = "";
    const readUntil = async (needle: string) => {
      const deadline = Date.now() + 5000;
      while (!text.includes(needle) && Date.now() < deadline) {
        const { value, done } = await reader.read();
        if (done) break;
        text += dec.decode(value);
      }
    };
    await readUntil("event: ping");
    await post("/api/boards/b1/tasks/T1/comment", { by: "dev", note: "live" });
    await readUntil("event: kanban");
    expect(text).toContain("event: kanban");
    expect(text).toContain('"note":"live"');
    await reader.cancel();
    ctrl.abort();
  });
});

describe("request guards (CSRF / DNS rebinding)", () => {
  const body = JSON.stringify({ id: "b3", title: "T" });
  const json = { "content-type": "application/json" };
  const send = (headers: Record<string, string>, url = "http://127.0.0.1:4090/api/boards", method = "POST") =>
    app.request(url, { method, headers, body: method === "GET" ? undefined : body });

  it("requires application/json on body-carrying requests", async () => {
    for (const ct of [{ "content-type": "text/plain" }, { "content-type": "application/x-www-form-urlencoded" }, {} as Record<string, string>]) {
      const res = await send(ct);
      expect(res.status).toBe(415);
      expect((await res.json()).error.code).toBe("validation_error");
    }
    expect((await send({ "content-type": "application/json; charset=utf-8" })).status).toBe(201);
  });

  it("rejects non-local Host with 403 forbidden_origin", async () => {
    const res = await send({ ...json, host: "evil.example.com" }, "http://evil.example.com/api/boards");
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("forbidden_origin");
    expect((await send({ ...json, host: "localhost:4090" }, "http://localhost:4090/api/boards")).status).toBe(201);
  });

  it("rejects non-local Origin, allows local or absent", async () => {
    for (const origin of ["https://evil.example.com", "null", "http://127.0.0.1.evil.com"]) {
      const res = await send({ ...json, origin });
      expect(res.status).toBe(403);
      expect((await res.json()).error.code).toBe("forbidden_origin");
    }
    expect((await send({ ...json, origin: "http://localhost:5173" })).status).toBe(201);
  });

  it("also guards GETs that carry a foreign Origin, but allows GETs without Origin", async () => {
    expect((await send({ origin: "https://evil.example.com" }, "http://127.0.0.1:4090/api/boards", "GET")).status).toBe(403);
    expect((await send({}, "http://127.0.0.1:4090/api/boards", "GET")).status).toBe(200);
    const sse = await send({}, "http://127.0.0.1:4090/api/boards/b1/events", "GET");
    expect(sse.status).toBe(200);
    await sse.body?.cancel();
  });
});
