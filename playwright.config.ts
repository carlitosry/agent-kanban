import { cpSync, mkdtempSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "@playwright/test";

// The config is evaluated by the runner and by every worker: compute once, share through env.
if (!process.env.AK_E2E_DATA_DIR) {
  const dir = mkdtempSync(join(tmpdir(), "agent-kanban-e2e-"));
  cpSync(join(import.meta.dirname, "examples/demo"), dir, { recursive: true });
  process.env.AK_E2E_DATA_DIR = dir;
}
if (!process.env.AK_E2E_PORT) {
  const port = await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once("error", reject);
    probe.listen(0, "127.0.0.1", () => {
      const { port: p } = probe.address() as { port: number };
      probe.close(() => resolve(p));
    });
  });
  process.env.AK_E2E_PORT = String(port);
}
const dataDir = process.env.AK_E2E_DATA_DIR;
const port = process.env.AK_E2E_PORT;

export default defineConfig({
  testDir: "test/e2e",
  testMatch: "*.spec.ts",
  workers: 1,
  fullyParallel: false,
  reporter: "list",
  outputDir: "test-results",
  globalTeardown: "./test/e2e/teardown.ts",
  use: { baseURL: `http://127.0.0.1:${port}`, locale: "es-ES" },
  webServer: {
    // Runs the built CLI (`npm run build` first) against a COPY of examples/demo.
    command: `node dist/cli/index.js up --data-dir "${dataDir}" --board demo --port ${port} --no-open`,
    url: `http://127.0.0.1:${port}/api/boards`,
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
