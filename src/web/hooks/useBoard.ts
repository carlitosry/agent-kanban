import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api/client.js";
import { upsertTask } from "../lib/board.js";
import type { BoardState, TaskView } from "../types.js";

/** Loads a board once and keeps it fresh exclusively through SSE (refetch on each event). */
export function useBoard(boardId: string | null) {
  const [state, setState] = useState<BoardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  const reload = useCallback(async () => {
    if (!boardId) return;
    try { setState(await api.getBoard(boardId)); setError(null); }
    catch (e) { setError((e as Error).message); }
  }, [boardId]);

  useEffect(() => {
    setState(null);
    if (!boardId) return;
    void reload();
    let wasDown = false;
    const close = api.subscribe(
      boardId,
      () => { window.clearTimeout(timer.current); timer.current = window.setTimeout(() => void reload(), 120); },
      (ok) => { setConnected(ok); if (!ok) wasDown = true; else if (wasDown) { wasDown = false; void reload(); } },
    );
    return () => { close(); window.clearTimeout(timer.current); setConnected(false); };
  }, [boardId, reload]);

  /** Optimistically reflect an API response; the SSE refetch reconciles. */
  const applyTask = useCallback((t: TaskView) => setState((s) => (s ? upsertTask(s, t) : s)), []);

  return { state, error, connected, reload, applyTask };
}
