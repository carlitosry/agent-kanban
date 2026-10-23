import { useState } from "preact/hooks";
import { COLUMNS, groupByPhaseWave, summarizeAgents, waveOptions, type Filters } from "../lib/board.js";
import type { Agent, BoardState } from "../types.js";
import { Avatar } from "./Avatar.js";

interface Props {
  state: BoardState;
  filters: Filters;
  onFilters: (f: Filters) => void;
  onOpen: (id: string) => void;
  onNewAgent: () => void;
  onEditAgent: (a: Agent) => void;
}

const STATE_DOT: Record<string, string> = {
  todo: "bg-slate-500", in_progress: "bg-sky-600", in_review: "bg-violet-600", done: "bg-emerald-600", blocked: "bg-amber-600",
};

function Section({ title, children, action }: { title: string; children: preact.ComponentChildren; action?: preact.ComponentChildren }) {
  return (
    <section class="panel p-3">
      <div class="mb-2 flex items-center justify-between">
        <h2 class="text-sm font-bold">{title}</h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function Sidebar({ state, filters, onFilters, onOpen, onNewAgent, onEditAgent }: Props) {
  const [closed, setClosed] = useState<Record<string, boolean>>({});
  const summaries = summarizeAgents(state.agents, state.tasks);
  const phases = groupByPhaseWave(state.tasks);

  return (
    <div class="flex flex-col gap-3 p-3">
      <Section title="Filtros">
        <div class="grid grid-cols-2 gap-2">
          <label>
            <span class="label">Agente</span>
            <select class="field" value={filters.agent} onChange={(e) => onFilters({ ...filters, agent: e.currentTarget.value })}>
              <option value="">Todos</option>
              {state.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            <span class="label">Ola</span>
            <select class="field" value={filters.wave} onChange={(e) => onFilters({ ...filters, wave: e.currentTarget.value })}>
              <option value="">Todas</option>
              {waveOptions(state.tasks).map((w) => <option key={w} value={String(w)}>Ola {w}</option>)}
            </select>
          </label>
        </div>
      </Section>

      <Section title="Agentes" action={<button class="btn !min-h-0 !py-0.5 text-xs" onClick={onNewAgent}>Añadir</button>}>
        <ul class="flex flex-col gap-2">
          {summaries.map(({ agent, current, counts, total }) => (
            <li key={agent.id} class="text-sm">
              <div class="flex items-center gap-2">
                <Avatar agent={agent} size={24} />
                <div class="min-w-0 flex-1">
                  <div class="truncate font-medium">{agent.name}</div>
                  <div class="truncate text-xs text-slate-600 dark:text-slate-400">{agent.role} · {agent.kind === "human" ? "persona" : "agente"}</div>
                </div>
                <button class="text-xs text-indigo-700 underline dark:text-indigo-300" onClick={() => onEditAgent(agent)}>Editar</button>
              </div>
              <div class="ml-8 mt-1 text-xs text-slate-700 dark:text-slate-300">
                {current ? (
                  <button class="truncate text-left underline" onClick={() => onOpen(current.id)}>Ahora: {current.id}</button>
                ) : <span class="text-slate-600 dark:text-slate-400">Sin tarea en curso</span>}
                <div class="mt-0.5 flex flex-wrap gap-x-2" aria-label={`${total} tareas`}>
                  {COLUMNS.map((c) => counts[c.state] > 0 && (
                    <span key={c.state} class="inline-flex items-center gap-1" title={c.label}>
                      <span class={`h-2 w-2 rounded-full ${STATE_DOT[c.state]}`} />{counts[c.state]}
                    </span>
                  ))}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Tareas por fase y ola">
        {phases.length === 0 && <p class="text-xs text-slate-600 dark:text-slate-400">Sin tareas todavía.</p>}
        {phases.map((p) => (
          <details key={p.phase} open={!closed[p.phase]} onToggle={(e) => {
            const open = (e.currentTarget as HTMLDetailsElement).open;
            setClosed((c) => (c[p.phase] === !open ? c : { ...c, [p.phase]: !open }));
          }} class="mb-1">
            <summary class="cursor-pointer py-1 text-sm font-semibold">{p.phase}</summary>
            {p.waves.map((w) => (
              <details key={w.wave} open class="ml-2">
                <summary class="cursor-pointer py-0.5 text-xs font-medium text-slate-700 dark:text-slate-300">Ola {w.wave} ({w.tasks.length})</summary>
                <ul class="ml-3">
                  {w.tasks.map((t) => (
                    <li key={t.id} class="py-0.5">
                      <button class="flex w-full items-center gap-1.5 text-left text-xs" onClick={() => onOpen(t.id)}>
                        <span class={`h-2 w-2 shrink-0 rounded-full ${STATE_DOT[t.state]}`} aria-hidden="true" />
                        <span class="font-mono">{t.id}</span>
                        <span class="truncate">{t.title}</span>
                      </button>
                      {t.acceptance.length > 0 && (
                        <ul class="ml-4 list-disc text-xs text-slate-600 dark:text-slate-400">
                          {t.acceptance.map((a, i) => <li key={i}>{a}</li>)}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </details>
            ))}
          </details>
        ))}
      </Section>
    </div>
  );
}
