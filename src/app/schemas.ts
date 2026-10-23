import { z } from "zod";
import { DomainError } from "../core/errors.js";

export const taskSeedSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  plan: z.string().min(1),
  section: z.string().min(1),
  phase: z.string().min(1),
  wave: z.number().int(),
  assignee: z.string().min(1),
  depends_on: z.array(z.string()),
  owns_files: z.array(z.string()),
  acceptance: z.array(z.string()),
  verify: z.array(z.string()),
  needs_ui_evidence: z.boolean(),
});

export const agentSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  role: z.string().min(1),
  color: z.string().min(1),
  kind: z.enum(["agent", "human"]),
});

export function parse<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, input: unknown, what: string): T {
  const r = schema.safeParse(input);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join(".") || what}: ${i.message}`).join("; ");
    throw new DomainError("validation_error", msg);
  }
  return r.data;
}
