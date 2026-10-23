import type { Agent, TaskSeed } from "./types.js";

const REQUIRED_STRINGS = ["id", "title", "plan", "section", "phase", "assignee"] as const;

/** Returns a list of problems found in a set of task seeds (empty when valid). */
export function validateSeed(tasks: TaskSeed[], agents: Agent[]): string[] {
  const problems: string[] = [];
  const agentIds = new Set(agents.map((a) => a.id));
  const seen = new Set<string>();
  const ids = new Set(tasks.map((t) => t.id));

  for (const t of tasks) {
    if (seen.has(t.id)) problems.push(`duplicate task id: ${t.id}`);
    seen.add(t.id);

    for (const field of REQUIRED_STRINGS) {
      const v = t[field];
      if (typeof v !== "string" || v.trim() === "") problems.push(`${t.id}: empty field ${field}`);
    }
    if (!Number.isInteger(t.wave)) problems.push(`${t.id}: wave must be an integer`);
    if (!t.acceptance || t.acceptance.length === 0) problems.push(`${t.id}: empty field acceptance`);
    if (!t.verify || t.verify.length === 0) problems.push(`${t.id}: empty field verify`);

    if (t.assignee && !agentIds.has(t.assignee)) {
      problems.push(`${t.id}: assignee does not exist: ${t.assignee}`);
    }
    for (const dep of t.depends_on ?? []) {
      if (!ids.has(dep)) problems.push(`${t.id}: dependency does not exist: ${dep}`);
    }
  }

  problems.push(...findCycles(tasks));
  problems.push(...findFileConflicts(tasks));
  return problems;
}

function findCycles(tasks: TaskSeed[]): string[] {
  const deps = new Map(tasks.map((t) => [t.id, t.depends_on ?? []]));
  const color = new Map<string, 0 | 1 | 2>(); // 1 = visiting, 2 = done
  const reported = new Set<string>();
  const problems: string[] = [];

  const visit = (id: string, path: string[]): void => {
    color.set(id, 1);
    for (const dep of deps.get(id) ?? []) {
      if (!deps.has(dep)) continue;
      const c = color.get(dep);
      if (c === 1) {
        const cycle = [...path.slice(path.indexOf(dep)), dep];
        const key = [...cycle].sort().join(",");
        if (!reported.has(key)) {
          reported.add(key);
          problems.push(`dependency cycle: ${cycle.join(" -> ")}`);
        }
      } else if (c === undefined) {
        visit(dep, [...path, dep]);
      }
    }
    color.set(id, 2);
  };

  for (const t of tasks) if (!color.has(t.id)) visit(t.id, [t.id]);
  return problems;
}

function findFileConflicts(tasks: TaskSeed[]): string[] {
  const owners = new Map<string, string[]>(); // "wave|file" -> task ids
  for (const t of tasks) {
    for (const file of new Set(t.owns_files ?? [])) {
      const key = `${t.wave}|${file}`;
      owners.set(key, [...(owners.get(key) ?? []), t.id]);
    }
  }
  const problems: string[] = [];
  for (const [key, ids] of owners) {
    if (ids.length < 2) continue;
    const [wave, file] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)];
    problems.push(`wave ${wave}: file ${file} owned by several tasks: ${ids.join(", ")}`);
  }
  return problems;
}
