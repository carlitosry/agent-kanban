import type { Agent, TaskSeed } from "../types.js";

export const splitLines = (s: string): string[] => s.split("\n").map((l) => l.trim()).filter(Boolean);
export const splitCsv = (s: string): string[] => s.split(",").map((l) => l.trim()).filter(Boolean);

export interface TaskFormValues {
  id: string; title: string; description: string; plan: string; section: string; phase: string; wave: string;
  assignee: string; depends_on: string; owns_files: string; acceptance: string; verify: string; needs_ui_evidence: boolean;
}

export function emptyTaskForm(assignee = ""): TaskFormValues {
  return { id: "", title: "", description: "", plan: "", section: "", phase: "", wave: "1", assignee,
    depends_on: "", owns_files: "", acceptance: "", verify: "", needs_ui_evidence: false };
}

export function taskToForm(t: TaskSeed): TaskFormValues {
  return { id: t.id, title: t.title, description: t.description ?? "", plan: t.plan, section: t.section, phase: t.phase,
    wave: String(t.wave), assignee: t.assignee, depends_on: t.depends_on.join(", "), owns_files: t.owns_files.join("\n"),
    acceptance: t.acceptance.join("\n"), verify: t.verify.join("\n"), needs_ui_evidence: t.needs_ui_evidence };
}

/** Returns a seed or the list of validation problems (Spanish, shown to the user). */
export function formToTask(v: TaskFormValues): { task: TaskSeed } | { problems: string[] } {
  const problems: string[] = [];
  const wave = Number(v.wave);
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(v.id)) problems.push("El id solo admite letras, números, punto, guion y guion bajo.");
  if (!v.title.trim()) problems.push("El título es obligatorio.");
  if (!v.assignee) problems.push("Elige un responsable.");
  if (!v.plan.trim() || !v.section.trim() || !v.phase.trim()) problems.push("Plan, sección y fase son obligatorios.");
  if (!Number.isInteger(wave) || wave < 0) problems.push("La ola debe ser un número entero.");
  if (problems.length) return { problems };
  return {
    task: {
      id: v.id.trim(), title: v.title.trim(), ...(v.description.trim() ? { description: v.description.trim() } : {}),
      plan: v.plan.trim(), section: v.section.trim(), phase: v.phase.trim(), wave, assignee: v.assignee,
      depends_on: splitCsv(v.depends_on), owns_files: splitLines(v.owns_files),
      acceptance: splitLines(v.acceptance), verify: splitLines(v.verify), needs_ui_evidence: v.needs_ui_evidence,
    },
  };
}

export function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function validateAgent(a: Agent): string[] {
  const p: string[] = [];
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(a.id)) p.push("El id solo admite letras, números, punto, guion y guion bajo.");
  if (!a.name.trim()) p.push("El nombre es obligatorio.");
  if (!a.role.trim()) p.push("El rol es obligatorio.");
  if (!/^#[0-9a-fA-F]{6}$/.test(a.color)) p.push("El color debe tener formato #rrggbb.");
  return p;
}
