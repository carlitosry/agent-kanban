import { rmSync } from "node:fs";

/** Removes the temporary copy of the demo data created by playwright.config.ts. */
export default function teardown(): void {
  const dir = process.env.AK_E2E_DATA_DIR;
  if (dir?.includes("agent-kanban-e2e-")) rmSync(dir, { recursive: true, force: true });
}
