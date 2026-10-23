import { describe, expect, it } from "vitest";
import { canMove } from "../../src/core/permissions.js";
import { agents, task } from "../helpers/fixtures.js";

describe("canMove", () => {
  const t = task("A", { assignee: "dev" });
  it("lets the assignee move their task", () => expect(canMove("dev", t, agents)).toBe(true));
  it("blocks another implementer", () => expect(canMove("dev2", t, agents)).toBe(false));
  it("lets the orchestrator move any task", () => expect(canMove("orch", t, agents)).toBe(true));
  it("lets the reviewer move any task", () => expect(canMove("rev", t, agents)).toBe(true));
  it("lets a human move any task", () => expect(canMove("carlos", t, agents)).toBe(true));
  it("rejects unknown actors", () => expect(canMove("ghost", t, agents)).toBe(false));
});
