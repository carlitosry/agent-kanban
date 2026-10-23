/** Operational CLI failure (exit 1) that is not a DomainError. */
export class CliError extends Error {}

/** Incorrect usage (exit 2). */
export class UsageError extends Error {}
