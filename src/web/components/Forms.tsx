import { useState } from "preact/hooks";
import { emptyTaskForm, formToTask, slugify, taskToForm, validateAgent, type TaskFormValues } from "../lib/forms.js";
import type { Agent, TaskSeed } from "../types.js";
import { Dialog } from "./Dialog.js";

function Problems({ list }: { list: string[] }) {
  if (!list.length) return null;
  return <ul role="alert" class="mb-3 list-disc rounded-md bg-red-50 p-2 pl-6 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">{list.map((p) => <li key={p}>{p}</li>)}</ul>;
}

/** Prompt for a note (and optionally a question): block, request changes, answer, comment. */
export function NoteDialog(p: {
  title: string; submit: string; noteLabel: string; noteRequired?: boolean; questionLabel?: string; hint?: string;
  danger?: boolean; onSubmit: (note: string, question?: string) => void; onClose: () => void;
}) {
  const [note, setNote] = useState("");
  const [question, setQuestion] = useState("");
  const invalid = !!p.noteRequired && !note.trim();
  return (
    <Dialog title={p.title} onClose={p.onClose}>
      <form onSubmit={(e) => { e.preventDefault(); if (!invalid) p.onSubmit(note.trim(), question.trim() || undefined); }}>
        {p.hint && <p class="mb-3 rounded-md bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-100">{p.hint}</p>}
        <label class="label" for="note">{p.noteLabel}</label>
        <textarea id="note" class="field mb-3" rows={4} value={note} onInput={(e) => setNote(e.currentTarget.value)} />
        {p.questionLabel && (<>
          <label class="label" for="q">{p.questionLabel}</label>
          <input id="q" class="field mb-3" value={question} onInput={(e) => setQuestion(e.currentTarget.value)} />
        </>)}
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={p.onClose}>Cancelar</button>
          <button type="submit" class={`btn ${p.danger ? "btn-danger" : "btn-primary"}`} disabled={invalid}>{p.submit}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function BoardDialog({ onSubmit, onClose }: { onSubmit: (v: { id: string; title: string; description?: string }) => void; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [id, setId] = useState("");
  const [description, setDescription] = useState("");
  const [problems, setProblems] = useState<string[]>([]);
  const finalId = id || slugify(title);
  return (
    <Dialog title="Nuevo tablero" onClose={onClose}>
      <form onSubmit={(e) => {
        e.preventDefault();
        const p: string[] = [];
        if (!title.trim()) p.push("El título es obligatorio.");
        if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(finalId)) p.push("El id solo admite letras, números, punto, guion y guion bajo.");
        setProblems(p);
        if (!p.length) onSubmit({ id: finalId, title: title.trim(), ...(description.trim() ? { description: description.trim() } : {}) });
      }}>
        <Problems list={problems} />
        <label class="label" for="bt">Título</label>
        <input id="bt" class="field mb-3" value={title} onInput={(e) => setTitle(e.currentTarget.value)} />
        <label class="label" for="bi">Id (opcional)</label>
        <input id="bi" class="field mb-3" placeholder={slugify(title)} value={id} onInput={(e) => setId(e.currentTarget.value)} />
        <label class="label" for="bd">Descripción</label>
        <textarea id="bd" class="field mb-3" rows={3} value={description} onInput={(e) => setDescription(e.currentTarget.value)} />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" class="btn btn-primary">Crear tablero</button>
        </div>
      </form>
    </Dialog>
  );
}

export function AgentDialog({ agent, onSubmit, onClose }: { agent?: Agent; onSubmit: (a: Agent) => void; onClose: () => void }) {
  const [a, setA] = useState<Agent>(agent ?? { id: "", name: "", role: "implementer", color: "#4f46e5", kind: "agent" });
  const [problems, setProblems] = useState<string[]>([]);
  const set = (patch: Partial<Agent>) => setA((x) => ({ ...x, ...patch }));
  return (
    <Dialog title={agent ? `Editar agente ${agent.name}` : "Nuevo agente"} onClose={onClose}>
      <form onSubmit={(e) => { e.preventDefault(); const p = validateAgent(a); setProblems(p); if (!p.length) onSubmit(a); }}>
        <Problems list={problems} />
        <label class="label" for="ai">Id</label>
        <input id="ai" class="field mb-3" disabled={!!agent} value={a.id} onInput={(e) => set({ id: e.currentTarget.value })} />
        <label class="label" for="an">Nombre</label>
        <input id="an" class="field mb-3" value={a.name} onInput={(e) => set({ name: e.currentTarget.value })} />
        <div class="mb-3 grid grid-cols-2 gap-3">
          <div>
            <label class="label" for="ar">Rol</label>
            <input id="ar" class="field" list="roles" value={a.role} onInput={(e) => set({ role: e.currentTarget.value })} />
            <datalist id="roles"><option value="orchestrator" /><option value="reviewer" /><option value="implementer" /><option value="human" /></datalist>
          </div>
          <div>
            <label class="label" for="ak">Tipo</label>
            <select id="ak" class="field" value={a.kind} onChange={(e) => set({ kind: e.currentTarget.value as Agent["kind"] })}>
              <option value="agent">Agente</option><option value="human">Persona</option>
            </select>
          </div>
        </div>
        <label class="label" for="ac">Color</label>
        <input id="ac" type="color" class="mb-4 h-9 w-16 rounded border border-slate-300 dark:border-slate-600" value={a.color} onInput={(e) => set({ color: e.currentTarget.value })} />
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" class="btn btn-primary">{agent ? "Guardar" : "Añadir agente"}</button>
        </div>
      </form>
    </Dialog>
  );
}

export function TaskDialog({ task, agents, actorId, onSubmit, onClose }: {
  task?: TaskSeed; agents: Agent[]; actorId: string; onSubmit: (t: TaskSeed) => void; onClose: () => void;
}) {
  const [v, setV] = useState<TaskFormValues>(task ? taskToForm(task) : emptyTaskForm(actorId));
  const [problems, setProblems] = useState<string[]>([]);
  const set = (patch: Partial<TaskFormValues>) => setV((x) => ({ ...x, ...patch }));
  const text = (key: keyof TaskFormValues, label: string, opts: { disabled?: boolean; type?: string } = {}) => (
    <div>
      <label class="label" for={`t-${key}`}>{label}</label>
      <input id={`t-${key}`} class="field" type={opts.type ?? "text"} disabled={opts.disabled} value={String(v[key])}
        onInput={(e) => set({ [key]: e.currentTarget.value } as Partial<TaskFormValues>)} />
    </div>
  );
  const area = (key: keyof TaskFormValues, label: string, rows = 3) => (
    <div>
      <label class="label" for={`t-${key}`}>{label}</label>
      <textarea id={`t-${key}`} class="field" rows={rows} value={String(v[key])}
        onInput={(e) => set({ [key]: e.currentTarget.value } as Partial<TaskFormValues>)} />
    </div>
  );
  return (
    <Dialog title={task ? `Editar ${task.id}` : "Nueva tarea"} onClose={onClose}>
      <form class="flex flex-col gap-3" onSubmit={(e) => {
        e.preventDefault();
        const r = formToTask(v);
        if ("problems" in r) setProblems(r.problems); else { setProblems([]); onSubmit(r.task); }
      }}>
        <Problems list={problems} />
        <div class="grid grid-cols-2 gap-3">{text("id", "Id", { disabled: !!task })}{text("wave", "Ola", { type: "number" })}</div>
        {text("title", "Título")}
        {area("description", "Descripción", 2)}
        <div class="grid grid-cols-2 gap-3">{text("plan", "Plan (fichero)")}{text("section", "Sección")}</div>
        <div class="grid grid-cols-2 gap-3">
          {text("phase", "Fase")}
          <div>
            <label class="label" for="t-assignee">Responsable</label>
            <select id="t-assignee" class="field" value={v.assignee} onChange={(e) => set({ assignee: e.currentTarget.value })}>
              <option value="">Elegir…</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>
        {text("depends_on", "Depende de (ids separados por comas)")}
        {area("owns_files", "Ficheros que posee (uno por línea)")}
        {area("acceptance", "Criterios de aceptación (uno por línea)")}
        {area("verify", "Verificación (un comando por línea)")}
        <label class="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={v.needs_ui_evidence} onChange={(e) => set({ needs_ui_evidence: e.currentTarget.checked })} />
          Requiere capturas de la interfaz
        </label>
        <div class="flex justify-end gap-2">
          <button type="button" class="btn" onClick={onClose}>Cancelar</button>
          <button type="submit" class="btn btn-primary">{task ? "Guardar" : "Crear tarea"}</button>
        </div>
      </form>
    </Dialog>
  );
}
