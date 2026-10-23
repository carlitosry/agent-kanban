import { useState } from "preact/hooks";
import { COLUMNS, groupByState } from "../lib/board.js";
import type { Agent, TaskState, TaskView } from "../types.js";
import { TaskCard } from "./TaskCard.js";

interface Props {
  tasks: TaskView[];
  counts: Record<TaskState, number>;
  agents: Agent[];
  filtered: boolean;
  onOpen: (id: string) => void;
  onDrop: (taskId: string, to: TaskState) => void;
}

const HEAD: Record<TaskState, string> = {
  todo: "bg-slate-200 text-slate-900 dark:bg-slate-700 dark:text-slate-100",
  in_progress: "bg-sky-200 text-sky-950 dark:bg-sky-900 dark:text-sky-100",
  in_review: "bg-violet-200 text-violet-950 dark:bg-violet-900 dark:text-violet-100",
  done: "bg-emerald-200 text-emerald-950 dark:bg-emerald-900 dark:text-emerald-100",
  blocked: "bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-100",
};

export function Board({ tasks, counts, agents, filtered, onOpen, onDrop }: Props) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [over, setOver] = useState<TaskState | null>(null);
  const groups = groupByState(tasks);

  return (
    <div class="flex h-full snap-x snap-mandatory gap-3 overflow-x-auto p-3 md:snap-none" data-testid="board">
      {COLUMNS.map((col) => (
        <section
          key={col.state}
          aria-label={col.label}
          data-testid={`col-${col.state}`}
          onDragOver={(e) => { e.preventDefault(); setOver(col.state); }}
          onDragLeave={() => setOver((o) => (o === col.state ? null : o))}
          onDrop={(e) => {
            e.preventDefault();
            const id = dragId ?? e.dataTransfer?.getData("text/plain");
            setOver(null); setDragId(null);
            if (id) onDrop(id, col.state);
          }}
          class={`flex w-[82vw] max-w-80 shrink-0 snap-center flex-col rounded-lg border bg-slate-50 md:w-auto md:min-w-40 md:max-w-none md:flex-1 md:basis-0 md:shrink dark:bg-slate-900 ${
            over === col.state ? "border-indigo-600 ring-2 ring-indigo-500 dark:border-indigo-300" : "border-slate-200 dark:border-slate-700"
          }`}
        >
          <header class={`flex items-center justify-between rounded-t-lg px-3 py-2 text-sm font-semibold ${HEAD[col.state]}`}>
            <span>{col.label}</span>
            <span class="rounded-full bg-white/70 px-2 text-xs dark:bg-black/30" aria-label={`${counts[col.state]} tareas`}>
              {filtered ? `${groups[col.state].length}/${counts[col.state]}` : counts[col.state]}
            </span>
          </header>
          <div class="flex min-h-24 flex-1 flex-col gap-2 overflow-y-auto p-2">
            {groups[col.state].map((t) => (
              <TaskCard key={t.id} task={t} agents={agents} onOpen={onOpen} onDragStart={setDragId} />
            ))}
            {groups[col.state].length === 0 && (
              <p class="p-2 text-center text-xs text-slate-600 dark:text-slate-400">Sin tareas</p>
            )}
          </div>
        </section>
      ))}
    </div>
  );
}
