import { DomainError } from "./errors.js";

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

export function isValidId(id: unknown): id is string {
  return typeof id === "string" && ID_PATTERN.test(id) && !id.includes("..");
}

/** Validates board and task ids (prevents path traversal). */
export function assertValidId(kind: string, id: unknown): asserts id is string {
  if (!isValidId(id)) {
    throw new DomainError("validation_error", `invalid ${kind} id: ${JSON.stringify(id)}`);
  }
}
