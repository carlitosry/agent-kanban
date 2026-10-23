import type { Agent, BoardMeta, BoardState, KanbanEvent, TaskSeed, TaskState, TaskView } from "../types.js";

export class ApiError extends Error {
  constructor(public code: string, message: string, public status: number) { super(message); }
}

async function request<T>(method: string, path: string, body?: unknown, actor?: string): Promise<T> {
  const headers: Record<string, string> = {};
  if (body !== undefined) headers["content-type"] = "application/json";
  if (actor) headers["x-actor"] = actor;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  } catch {
    throw new ApiError("network_error", "No se pudo conectar con el servidor", 0);
  }
  if (!res.ok) {
    let code = "error", message = res.statusText;
    try { const j = await res.json(); code = j.error?.code ?? code; message = j.error?.message ?? message; } catch { /* non-JSON */ }
    throw new ApiError(code, message, res.status);
  }
  return (await res.json()) as T;
}

const b = (id: string) => `/boards/${encodeURIComponent(id)}`;
const t = (id: string, task: string) => `${b(id)}/tasks/${encodeURIComponent(task)}`;

export type ReviewVerdict = "approve" | "changes" | "human";

export const api = {
  listBoards: () => request<BoardMeta[]>("GET", "/boards"),
  createBoard: (input: { id: string; title: string; description?: string }) => request<BoardMeta>("POST", "/boards", input),
  getBoard: (id: string) => request<BoardState>("GET", b(id)),
  createTask: (id: string, by: string, task: TaskSeed) => request<TaskView>("POST", `${b(id)}/tasks`, { by, task }),
  updateTask: (id: string, by: string, task: string, patch: Partial<TaskSeed>) => request<TaskView>("PATCH", t(id, task), { by, patch }),
  move: (id: string, by: string, task: string, to: TaskState, note?: string) => request<TaskView>("POST", `${t(id, task)}/move`, { by, to, note }),
  block: (id: string, by: string, task: string, note: string, question?: string) => request<TaskView>("POST", `${t(id, task)}/block`, { by, note, question }),
  unblock: (id: string, by: string, task: string, note?: string) => request<TaskView>("POST", `${t(id, task)}/unblock`, { by, note }),
  comment: (id: string, by: string, task: string, note: string) => request<TaskView>("POST", `${t(id, task)}/comment`, { by, note }),
  review: (id: string, by: string, task: string, verdict: ReviewVerdict, note?: string, question?: string) =>
    request<TaskView>("POST", `${t(id, task)}/review`, { by, verdict, note, question }),
  preflight: (id: string, by: string, task: string, verdict: "approve" | "block", note?: string) =>
    request<TaskView>("POST", `${t(id, task)}/preflight`, { by, verdict, note }),
  addAgent: (id: string, agent: Agent) => request<Agent>("POST", `${b(id)}/agents`, agent),
  updateAgent: (id: string, agentId: string, patch: Partial<Agent>) => request<Agent>("PATCH", `${b(id)}/agents/${encodeURIComponent(agentId)}`, patch),
  evidenceUrl: (id: string, task: string, file: string) => `/api${t(id, task).replace("/tasks/", "/evidence/")}/${encodeURIComponent(file)}`,
  evidenceText: async (url: string): Promise<string> => {
    const res = await fetch(url);
    if (!res.ok) throw new ApiError("not_found", "No se pudo leer el archivo", res.status);
    return res.text();
  },
  /** Opens the SSE stream; returns a close function. */
  subscribe(id: string, onEvent: (e: KanbanEvent) => void, onStatus: (connected: boolean) => void): () => void {
    const es = new EventSource(`/api${b(id)}/events`);
    es.addEventListener("kanban", (m) => {
      try { onEvent(JSON.parse((m as MessageEvent).data) as KanbanEvent); } catch { /* ignore malformed */ }
    });
    es.onopen = () => onStatus(true);
    es.onerror = () => onStatus(false);
    return () => es.close();
  },
};
