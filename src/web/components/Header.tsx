import type { Agent, BoardMeta } from "../types.js";
import { MenuIcon, MoonIcon, SunIcon } from "./icons.js";
import type { Theme } from "../lib/theme.js";

interface Props {
  boards: BoardMeta[];
  boardId: string | null;
  onBoard: (id: string) => void;
  onNewBoard: () => void;
  agents: Agent[];
  actor: string;
  onActor: (id: string) => void;
  theme: Theme;
  onToggleTheme: () => void;
  connected: boolean;
  onMenu: () => void;
}

export function Header(p: Props) {
  return (
    <header class="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-white px-3 py-2 dark:border-slate-700 dark:bg-slate-900">
      <button class="btn md:hidden" aria-label="Abrir panel lateral" onClick={p.onMenu}><MenuIcon /></button>
      <h1 class="mr-1 text-base font-bold">Kanban</h1>
      <label class="flex items-center gap-1 text-sm">
        <span class="sr-only md:not-sr-only">Tablero</span>
        <select class="field !w-auto max-w-40" aria-label="Tablero" value={p.boardId ?? ""} onChange={(e) => p.onBoard(e.currentTarget.value)}>
          {p.boards.length === 0 && <option value="">Sin tableros</option>}
          {p.boards.map((b) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select>
      </label>
      <button class="btn" onClick={p.onNewBoard}>Nuevo tablero</button>
      <div class="ml-auto flex items-center gap-2">
        <span class={`hidden items-center gap-1 text-xs sm:inline-flex ${p.connected ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}`}
          role="status" data-testid="sse-status">
          <span class={`h-2 w-2 rounded-full ${p.connected ? "bg-emerald-600" : "bg-red-600"}`} />
          {p.connected ? "En vivo" : "Sin conexión"}
        </span>
        <label class="flex items-center gap-1 text-sm">
          <span class="hidden sm:inline">Actúo como…</span>
          <select class="field !w-auto max-w-36" aria-label="Actúo como" value={p.actor} onChange={(e) => p.onActor(e.currentTarget.value)}>
            <option value="">Elegir…</option>
            {p.agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </label>
        <button class="btn" onClick={p.onToggleTheme} aria-label={p.theme === "dark" ? "Cambiar a tema claro" : "Cambiar a tema oscuro"}>
          {p.theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
      </div>
    </header>
  );
}
