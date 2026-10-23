import { initial } from "../lib/board.js";
import type { Agent } from "../types.js";

export function Avatar({ agent, size = 24 }: { agent?: Agent; size?: number }) {
  const bg = agent?.color ?? "#64748b";
  return (
    <span
      class="inline-flex shrink-0 items-center justify-center rounded-full font-bold text-white"
      style={{ width: size, height: size, background: bg, fontSize: size * 0.5, textShadow: "0 0 2px rgba(0,0,0,.6)" }}
      title={agent?.name ?? "Sin asignar"}
      role="img"
      aria-label={agent ? `Asignada a ${agent.name}` : "Sin asignar"}
    >
      {initial(agent?.name ?? "?")}
    </span>
  );
}
