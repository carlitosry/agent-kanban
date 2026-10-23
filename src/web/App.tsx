import { useCallback, useEffect, useMemo, useState } from "preact/hooks";
import { api, ApiError } from "./api/client.js";
import { Board } from "./components/Board.js";
import { AgentDialog, BoardDialog, NoteDialog, TaskDialog } from "./components/Forms.js";
import { Header } from "./components/Header.js";
import { Sidebar } from "./components/Sidebar.js";
import { TaskDetail } from "./components/TaskDetail.js";
import { useBoard } from "./hooks/useBoard.js";
import { useTheme } from "./hooks/useTheme.js";
import { applyFilters, dropAction, NO_FILTERS, type Filters } from "./lib/board.js";
import { boardFromLocation, hashForBoard } from "./lib/route.js";
import { readStored, writeStored } from "./lib/theme.js";
import type { Agent, BoardMeta, TaskState, TaskView } from "./types.js";

const BOARD_KEY = "ak-board";
const ACTOR_KEY = "ak-actor";

const ERROR_ES: Record<string, string> = {
  not_assignee: "Esa persona o agente no puede mover esta tarea.",
  invalid_transition: "Ese movimiento no está permitido.",
  dependencies_pending: "Hay dependencias que aún no están hechas.",
  preflight_required: "Falta un preflight aprobado.",
  not_found: "No encontrado.",
  network_error: "No se pudo conectar con el servidor.",
};
const errorText = (e: unknown) => (e instanceof ApiError ? `${ERROR_ES[e.code] ?? e.message}` : (e as Error).message);

type Modal =
  | { kind: "board" } | { kind: "agent"; agent?: Agent } | { kind: "task"; task?: TaskView }
  | { kind: "drop-block"; taskId: string };

export function App() {
  const { theme, toggle } = useTheme();
  const [boards, setBoards] = useState<BoardMeta[]>([]);
  const [boardId, setBoardId] = useState<string | null>(() => boardFromLocation(location.search, location.hash) ?? readStored(BOARD_KEY));
  const [actorId, setActorId] = useState<string>(() => readStored(ACTOR_KEY) ?? "");
  const [filters, setFilters] = useState<Filters>(NO_FILTERS);
  const [openTask, setOpenTask] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [menu, setMenu] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const { state, error, connected, reload, applyTask } = useBoard(boardId);

  const fail = useCallback((e: unknown) => { setToast(errorText(e)); window.setTimeout(() => setToast(null), 6000); }, []);

  const loadBoards = useCallback(async () => {
    try {
      const list = await api.listBoards();
      setBoards(list);
      setBoardId((cur) => (cur && list.some((b) => b.id === cur) ? cur : (list[0]?.id ?? null)));
    } catch (e) { fail(e); }
  }, [fail]);
  useEffect(() => { void loadBoards(); }, [loadBoards]);

  useEffect(() => {
    if (!boardId) return;
    writeStored(BOARD_KEY, boardId);
    if (boardFromLocation("", location.hash) !== boardId) history.replaceState(null, "", location.pathname + hashForBoard(boardId));
  }, [boardId]);
  useEffect(() => {
    const on = () => { const id = boardFromLocation(location.search, location.hash); if (id) setBoardId(id); };
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  useEffect(() => { setFilters(NO_FILTERS); setOpenTask(null); }, [boardId]);

  const actor = state?.agents.find((a) => a.id === actorId);
  useEffect(() => {
    // Default the actor to the first human of the board the first time.
    if (state && !actorId) { const h = state.agents.find((a) => a.kind === "human"); if (h) pickActor(h.id); }
  }, [state?.board.id]);
  function pickActor(id: string) { setActorId(id); writeStored(ACTOR_KEY, id); }

  const run = useCallback(async (fn: (by: string) => Promise<TaskView>): Promise<boolean> => {
    if (!actorId) { fail(new Error("Elige «Actúo como…» primero.")); return false; }
    try { applyTask(await fn(actorId)); return true; } catch (e) { fail(e); void reload(); return false; }
  }, [actorId, applyTask, fail, reload]);

  const visible = useMemo(() => (state ? applyFilters(state.tasks, filters) : []), [state, filters]);
  const selected = state?.tasks.find((t) => t.id === openTask);

  const onDrop = (taskId: string, to: TaskState) => {
    const task = state?.tasks.find((t) => t.id === taskId);
    if (!task || !boardId) return;
    const a = dropAction(task, to);
    if (a.kind === "move") void run((by) => api.move(boardId, by, taskId, a.to));
    else if (a.kind === "unblock") void run((by) => api.unblock(boardId, by, taskId));
    else if (a.kind === "block") setModal({ kind: "drop-block", taskId });
    else if (task.state === "blocked") fail(new Error("Para salir de Bloqueada usa «Desbloquear» en el detalle."));
  };

  const close = () => setModal(null);
  const sidebar = state && (
    <Sidebar state={state} filters={filters} onFilters={setFilters} onOpen={(id) => { setOpenTask(id); setMenu(false); }}
      onNewAgent={() => setModal({ kind: "agent" })} onEditAgent={(agent) => setModal({ kind: "agent", agent })} />
  );

  return (
    <div class="flex h-dvh flex-col">
      <Header boards={boards} boardId={boardId} onBoard={setBoardId} onNewBoard={() => setModal({ kind: "board" })}
        agents={state?.agents ?? []} actor={actorId} onActor={pickActor} theme={theme} onToggleTheme={toggle}
        connected={connected} onMenu={() => setMenu((m) => !m)} />

      {toast && (
        <div role="alert" class="flex items-center justify-between gap-2 bg-red-700 px-3 py-2 text-sm text-white dark:bg-red-300 dark:text-red-950">
          <span>{toast}</span><button class="underline" onClick={() => setToast(null)}>Cerrar</button>
        </div>
      )}

      <main class="flex min-h-0 flex-1">
        <div class="min-w-0 flex-1">
          {!boardId && (
            <div class="p-8 text-center">
              <p class="mb-3">No hay tableros todavía.</p>
              <button class="btn btn-primary" onClick={() => setModal({ kind: "board" })}>Crear el primer tablero</button>
            </div>
          )}
          {boardId && !state && <p class="p-6 text-sm">{error ? `Error: ${error}` : "Cargando…"}</p>}
          {state && (
            <div class="flex h-full flex-col">
              <div class="flex items-center justify-between gap-2 px-3 pt-2">
                <div class="min-w-0">
                  <h2 class="truncate text-lg font-bold">{state.board.title}</h2>
                  {state.board.description && <p class="truncate text-xs text-slate-600 dark:text-slate-400">{state.board.description}</p>}
                </div>
                <button class="btn btn-primary shrink-0" onClick={() => setModal({ kind: "task" })}>Nueva tarea</button>
              </div>
              <div class="min-h-0 flex-1">
                <Board tasks={visible} counts={state.counts} agents={state.agents} filtered={!!(filters.agent || filters.wave)}
                  onOpen={setOpenTask} onDrop={onDrop} />
              </div>
            </div>
          )}
        </div>
        <aside class="hidden w-64 shrink-0 lg:w-72 overflow-y-auto border-l border-slate-200 bg-slate-50 md:block dark:border-slate-700 dark:bg-slate-950" aria-label="Panel lateral">
          {sidebar}
        </aside>
      </main>

      {menu && state && (
        <div class="fixed inset-0 z-30 flex md:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) setMenu(false); }}>
          <aside class="ml-auto h-full w-[90vw] max-w-sm overflow-y-auto bg-slate-50 shadow-xl dark:bg-slate-950" aria-label="Panel lateral">
            <button class="btn m-3 mb-0" onClick={() => setMenu(false)}>Cerrar panel</button>
            {sidebar}
          </aside>
        </div>
      )}

      {selected && boardId && state && (
        <TaskDetail boardId={boardId} task={selected} agents={state.agents} actor={actor} run={run}
          onEdit={() => setModal({ kind: "task", task: selected })} onClose={() => setOpenTask(null)} />
      )}

      {modal?.kind === "board" && (
        <BoardDialog onClose={close} onSubmit={async (input) => {
          try { await api.createBoard(input); await loadBoards(); setBoardId(input.id); close(); } catch (e) { fail(e); }
        }} />
      )}
      {modal?.kind === "agent" && boardId && (
        <AgentDialog agent={modal.agent} onClose={close} onSubmit={async (a) => {
          try { if (modal.agent) await api.updateAgent(boardId, a.id, a); else await api.addAgent(boardId, a); await reload(); close(); } catch (e) { fail(e); }
        }} />
      )}
      {modal?.kind === "task" && boardId && state && (
        <TaskDialog task={modal.task} agents={state.agents} actorId={actorId} onClose={close} onSubmit={async (t) => {
          const edit = modal.task;
          const ok = await run((by) => edit ? api.updateTask(boardId, by, edit.id, (({ id: _id, ...patch }) => patch)(t)) : api.createTask(boardId, by, t));
          if (ok) close();
        }} />
      )}
      {modal?.kind === "drop-block" && boardId && (
        <NoteDialog title="Bloquear tarea" submit="Bloquear" danger noteRequired noteLabel="Motivo del bloqueo"
          questionLabel="Pregunta para una persona (opcional)" onClose={close}
          onSubmit={async (n, q) => { if (await run((by) => api.block(boardId, by, modal.taskId, n, q))) close(); }} />
      )}
    </div>
  );
}
