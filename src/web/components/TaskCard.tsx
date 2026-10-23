import { agentById } from "../lib/board.js";
import type { Agent, TaskView } from "../types.js";
import { Avatar } from "./Avatar.js";
import { CameraIcon, HandIcon } from "./icons.js";

interface Props {
  task: TaskView;
  agents: Agent[];
  onOpen: (id: string) => void;
  onDragStart: (id: string) => void;
}

export function TaskCard({ task, agents, onOpen, onDragStart }: Props) {
  const agent = agentById(agents, task.assignee);
  const waiting = !!task.question;
  return (
    <article
      draggable
      tabIndex={0}
      role="button"
      aria-label={`${task.id}: ${task.title}`}
      onDragStart={(e) => { e.dataTransfer?.setData("text/plain", task.id); onDragStart(task.id); }}
      onClick={() => onOpen(task.id)}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onOpen(task.id); } }}
      class={`cursor-pointer rounded-lg border bg-white p-2.5 shadow-sm hover:shadow dark:bg-slate-800 ${
        waiting ? "border-amber-500 dark:border-amber-400" : "border-slate-200 dark:border-slate-700"
      }`}
    >
      <div class="flex items-start justify-between gap-2">
        <span class="font-mono text-xs font-semibold text-slate-600 dark:text-slate-400">{task.id}</span>
        <span class="flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
          {waiting && <span class="text-amber-700 dark:text-amber-300"><HandIcon /></span>}
          {task.evidence.length > 0 && <CameraIcon />}
        </span>
      </div>
      <h3 class="mt-1 text-sm font-medium leading-snug">{task.title}</h3>
      <div class="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
        <Avatar agent={agent} size={20} />
        <span class="shrink-0 whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 dark:bg-slate-700">Ola {task.wave}</span>
        <span class="truncate" title={task.plan}>{task.plan}</span>
      </div>
      {task.state === "todo" && task.ready && (
        <p class="mt-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">Lista para empezar</p>
      )}
      {task.review_rounds > 0 && (
        <p class="mt-1 text-xs text-slate-600 dark:text-slate-400">Cambios pedidos: {task.review_rounds}</p>
      )}
    </article>
  );
}
