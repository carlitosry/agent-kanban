import { useEffect, useState } from "preact/hooks";
import { api } from "../api/client.js";
import { agentById, canReview, STATE_LABEL } from "../lib/board.js";
import type { Agent, KanbanEvent, TaskView } from "../types.js";
import { Avatar } from "./Avatar.js";
import { Dialog } from "./Dialog.js";
import { NoteDialog } from "./Forms.js";
import { HandIcon } from "./icons.js";

type Ask = "block" | "changes" | "escalate" | "unblock" | "comment" | "preflight-block" | null;

interface Props {
  boardId: string;
  task: TaskView;
  agents: Agent[];
  actor: Agent | undefined;
  /** Runs an API call as the actor, applies the result and reports errors. */
  run: (fn: (by: string) => Promise<TaskView>) => Promise<boolean>;
  onEdit: () => void;
  onClose: () => void;
}

const isImage = (f: string) => /\.(png|jpe?g|gif|webp|svg)$/i.test(f);
const fmt = (ts: string) => { const d = new Date(ts); return Number.isNaN(+d) ? ts : d.toLocaleString("es-ES", { dateStyle: "short", timeStyle: "short" }); };

function eventText(e: KanbanEvent): string {
  const base: Record<string, string> = {
    board_created: "creó el tablero", task_created: "creó la tarea", task_updated: "editó la tarea", assign: "reasignó la tarea",
    move: `movió ${e.from ? STATE_LABEL[e.from] : "?"} → ${e.to ? STATE_LABEL[e.to] : "?"}`, comment: "comentó",
    preflight: `preflight: ${(e.payload as { verdict?: string } | undefined)?.verdict ?? ""}`,
    review: `revisión: ${(e.payload as { verdict?: string } | undefined)?.verdict ?? ""}`, block: "bloqueó", unblock: "desbloqueó",
  };
  return base[e.type] ?? e.type;
}

function ReviewMd({ boardId, task }: { boardId: string; task: TaskView }) {
  const [text, setText] = useState<string | null>(null);
  const has = task.evidence.includes("review.md");
  useEffect(() => {
    setText(null);
    if (has) api.evidenceText(api.evidenceUrl(boardId, task.id, "review.md")).then(setText).catch(() => setText(null));
  }, [boardId, task.id, has, task.review?.ts]);
  if (!has || text === null) return null;
  return <pre class="mt-2 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-slate-100 p-2 text-xs dark:bg-slate-800" data-testid="review-md">{text}</pre>;
}

export function TaskDetail({ boardId, task, agents, actor, run, onEdit, onClose }: Props) {
  const [ask, setAsk] = useState<Ask>(null);
  const [zoom, setZoom] = useState<string | null>(null);
  const assignee = agentById(agents, task.assignee);
  const reviewer = canReview(actor);
  const can = !!actor;
  const done = async (p: Promise<boolean>) => { if (await p) setAsk(null); };

  const btn = (label: string, fn: () => void, cls = "") => <button class={`btn ${cls}`} disabled={!can} onClick={fn}>{label}</button>;
  const images = task.evidence.filter(isImage);

  return (
    <Dialog variant="side" title={`${task.id} · ${task.title}`} onClose={onClose}>
      <div class="flex flex-col gap-4 text-sm">
        <div class="flex flex-wrap items-center gap-2">
          <Avatar agent={assignee} size={28} />
          <span>{assignee?.name ?? task.assignee}</span>
          <span class="rounded bg-slate-200 px-2 py-0.5 text-xs font-semibold dark:bg-slate-700" data-testid="detail-state">{STATE_LABEL[task.state]}</span>
          <span class="text-xs text-slate-600 dark:text-slate-400">{task.phase} · Ola {task.wave}</span>
          <button class="btn ml-auto" onClick={onEdit}>Editar</button>
        </div>

        {task.question && (
          <div class="rounded-md border border-amber-500 bg-amber-50 p-3 text-amber-950 dark:bg-amber-950 dark:text-amber-100" role="alert">
            <p class="flex items-center gap-1.5 font-semibold"><HandIcon label="Pregunta abierta" /> Espera respuesta humana</p>
            <p class="mt-1">{task.question}</p>
          </div>
        )}

        {task.description && <p>{task.description}</p>}
        <p class="text-xs">
          Plan: <span class="font-mono">{task.plan}</span> · Sección: <span class="font-mono">{task.section}</span>
        </p>

        <section aria-label="Acciones" class="flex flex-wrap gap-2">
          {!can && <p class="w-full text-xs text-slate-600 dark:text-slate-400">Elige «Actúo como…» en la cabecera para actuar.</p>}
          {task.state === "todo" && (<>
            {btn("Iniciar", () => void run((by) => api.move(boardId, by, task.id, "in_progress")), "btn-primary")}
            {reviewer && btn("Preflight: aprobar", () => void run((by) => api.preflight(boardId, by, task.id, "approve")))}
            {reviewer && btn("Preflight: bloquear", () => setAsk("preflight-block"))}
          </>)}
          {task.state === "in_progress" && btn("Enviar a revisión", () => void run((by) => api.move(boardId, by, task.id, "in_review")), "btn-primary")}
          {task.state === "in_review" && reviewer && (<>
            {btn("Aprobar", () => void run((by) => api.review(boardId, by, task.id, "approve")), "btn-primary")}
            {btn("Pedir cambios", () => setAsk("changes"))}
            {btn("Escalar a una persona", () => setAsk("escalate"))}
          </>)}
          {task.state === "in_review" && !reviewer && btn("Devolver a En progreso", () => void run((by) => api.move(boardId, by, task.id, "in_progress")))}
          {task.state === "blocked" && btn(task.question ? "Responder y desbloquear" : "Desbloquear", () => setAsk("unblock"), "btn-primary")}
          {task.state !== "blocked" && task.state !== "done" && btn("Bloquear", () => setAsk("block"), "")}
          {btn("Comentar", () => setAsk("comment"))}
        </section>

        {task.preflight && (
          <p>Preflight: <strong>{task.preflight.verdict === "approve" ? "aprobado" : "bloqueado"}</strong> por {task.preflight.by}
            {task.preflight.note ? ` — ${task.preflight.note}` : ""}</p>
        )}
        {task.depends_on.length > 0 && <p>Depende de: <span class="font-mono">{task.depends_on.join(", ")}</span></p>}

        <section aria-label="Ficheros que posee">
          <h3 class="font-bold">Ficheros que posee</h3>
          {task.owns_files.length ? <ul class="mt-1 list-disc pl-5 font-mono text-xs">{task.owns_files.map((f) => <li key={f}>{f}</li>)}</ul> : <p class="text-xs">Ninguno.</p>}
        </section>

        <section aria-label="Criterios de aceptación">
          <h3 class="font-bold">Criterios de aceptación</h3>
          <ul class="mt-1 list-disc pl-5">{task.acceptance.map((a, i) => <li key={i}>{a}</li>)}</ul>
        </section>

        {task.verify.length > 0 && (
          <section aria-label="Verificación">
            <h3 class="font-bold">Verificación</h3>
            <ul class="mt-1 list-disc pl-5 font-mono text-xs">{task.verify.map((v, i) => <li key={i}>{v}</li>)}</ul>
          </section>
        )}

        {task.review && (
          <section aria-label="Veredicto de la revisora">
            <h3 class="font-bold">Veredicto de la revisora</h3>
            <p>
              <strong>{{ approve: "Aprobada", changes: "Cambios pedidos", human: "Requiere persona" }[task.review.verdict]}</strong> por {task.review.by}
              {task.review.note ? ` — ${task.review.note}` : ""} <span class="text-xs text-slate-600 dark:text-slate-400">({task.review_rounds} rondas de cambios)</span>
            </p>
            <ReviewMd boardId={boardId} task={task} />
          </section>
        )}

        <section aria-label="Capturas">
          <h3 class="font-bold">Capturas {task.needs_ui_evidence && <span class="text-xs font-normal">(requeridas)</span>}</h3>
          {images.length === 0 ? <p class="text-xs">Sin capturas.</p> : (
            <div class="mt-1 grid grid-cols-2 gap-2">
              {images.map((f) => (
                <button key={f} class="overflow-hidden rounded-md border border-slate-300 dark:border-slate-600" onClick={() => setZoom(f)} aria-label={`Ver captura ${f}`}>
                  <img src={api.evidenceUrl(boardId, task.id, f)} alt={f} loading="lazy" class="h-28 w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </section>

        <section aria-label="Historial">
          <h3 class="font-bold">Historial</h3>
          <ol class="mt-1 flex flex-col gap-1.5 border-l-2 border-slate-300 pl-3 dark:border-slate-600">
            {[...task.history].reverse().map((e, i) => (
              <li key={i} class="text-xs">
                <span class="text-slate-600 dark:text-slate-400">{fmt(e.ts)}</span> <strong>{agentById(agents, e.by)?.name ?? e.by}</strong> {eventText(e)}
                {e.note && <p class="text-slate-800 dark:text-slate-200">«{e.note}»</p>}
                {e.question && <p class="text-amber-800 dark:text-amber-300">Pregunta: {e.question}</p>}
              </li>
            ))}
          </ol>
        </section>
      </div>

      {zoom && (
        <Dialog title={zoom} onClose={() => setZoom(null)}>
          <img src={api.evidenceUrl(boardId, task.id, zoom)} alt={zoom} class="max-h-[70vh] w-full object-contain" />
        </Dialog>
      )}
      {ask === "block" && <NoteDialog title="Bloquear tarea" submit="Bloquear" danger noteRequired noteLabel="Motivo del bloqueo"
        questionLabel="Pregunta para una persona (opcional)" onClose={() => setAsk(null)}
        onSubmit={(n, q) => void done(run((by) => api.block(boardId, by, task.id, n, q)))} />}
      {ask === "changes" && <NoteDialog title="Pedir cambios" submit="Pedir cambios" noteRequired noteLabel="Qué hay que cambiar" onClose={() => setAsk(null)}
        onSubmit={(n) => void done(run((by) => api.review(boardId, by, task.id, "changes", n)))} />}
      {ask === "escalate" && <NoteDialog title="Escalar a una persona" submit="Escalar" noteLabel="Contexto" questionLabel="Pregunta para la persona"
        onClose={() => setAsk(null)} onSubmit={(n, q) => void done(run((by) => api.review(boardId, by, task.id, "human", n || undefined, q)))} />}
      {ask === "unblock" && <NoteDialog title={task.question ? "Responder y desbloquear" : "Desbloquear tarea"} submit="Desbloquear"
        noteRequired={!!task.question} noteLabel={task.question ? "Tu respuesta" : "Nota (opcional)"} hint={task.question ? `Pregunta: ${task.question}` : undefined}
        onClose={() => setAsk(null)} onSubmit={(n) => void done(run((by) => api.unblock(boardId, by, task.id, n || undefined)))} />}
      {ask === "comment" && <NoteDialog title="Comentar" submit="Enviar" noteRequired noteLabel="Comentario" onClose={() => setAsk(null)}
        onSubmit={(n) => void done(run((by) => api.comment(boardId, by, task.id, n)))} />}
      {ask === "preflight-block" && <NoteDialog title="Preflight: bloquear" submit="Bloquear" danger noteRequired noteLabel="Motivo" onClose={() => setAsk(null)}
        onSubmit={(n) => void done(run((by) => api.preflight(boardId, by, task.id, "block", n)))} />}
    </Dialog>
  );
}
