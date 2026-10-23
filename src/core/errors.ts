export type DomainErrorCode =
  | "validation_error"
  | "not_assignee"
  | "not_found"
  | "invalid_transition"
  | "dependencies_pending"
  | "preflight_required";

export const HTTP_STATUS: Record<DomainErrorCode, number> = {
  validation_error: 400,
  not_assignee: 403,
  not_found: 404,
  invalid_transition: 409,
  dependencies_pending: 409,
  preflight_required: 409,
};

export class DomainError extends Error {
  readonly code: DomainErrorCode;

  constructor(code: DomainErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DomainError";
    this.code = code;
  }

  get status(): number {
    return HTTP_STATUS[this.code];
  }

  toJSON(): { error: { code: string; message: string } } {
    return { error: { code: this.code, message: this.message } };
  }
}
