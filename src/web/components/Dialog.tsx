import { useEffect, useRef } from "preact/hooks";
import type { ComponentChildren } from "preact";
import { CloseIcon } from "./icons.js";

interface Props {
  title: string;
  onClose: () => void;
  children: ComponentChildren;
  /** "side" renders a right-hand panel on desktop; full screen on mobile in both modes. */
  variant?: "modal" | "side";
}

export function Dialog({ title, onClose, children, variant = "modal" }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const on = (e: KeyboardEvent) => { if (e.key !== "Escape") return;
      const all = document.querySelectorAll('[role="dialog"]');
      if (all[all.length - 1] === ref.current) onClose(); // only the topmost dialog
    };
    document.addEventListener("keydown", on);
    return () => { document.removeEventListener("keydown", on); prev?.focus?.(); };
  }, []);

  const pos = variant === "side" ? "md:justify-end md:p-0" : "md:items-center md:justify-center md:p-4";
  const box = variant === "side" ? "md:h-full md:max-w-xl md:rounded-none" : "md:max-h-[90vh] md:max-w-lg md:rounded-lg";
  return (
    <div class={`fixed inset-0 z-40 flex bg-black/50 ${pos}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title}
        class={`flex h-full w-full flex-col overflow-hidden bg-white shadow-xl dark:bg-slate-900 ${box}`}>
        <div class="flex items-center justify-between border-b border-slate-200 px-4 py-3 dark:border-slate-700">
          <h2 class="text-base font-bold">{title}</h2>
          <button class="btn !px-2" aria-label="Cerrar" onClick={onClose}><CloseIcon /></button>
        </div>
        <div class="flex-1 overflow-y-auto p-4">{children}</div>
      </div>
    </div>
  );
}
