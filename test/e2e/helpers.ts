import { execFileSync } from "node:child_process";
import { join } from "node:path";

const CLI = join(import.meta.dirname, "../../dist/cli/index.js");

/** Runs the real CLI against the e2e data dir (same files the server watches). */
export function cli(...args: string[]): string {
  return execFileSync("node", [CLI, "--data-dir", process.env.AK_E2E_DATA_DIR ?? "", "--board", "demo", ...args], {
    encoding: "utf8",
  });
}
