import { describe, expect, it } from "vitest";
import { validateSeed } from "../../src/core/seed.js";
import { agents, task } from "../helpers/fixtures.js";

describe("validateSeed", () => {
  it("accepts a valid seed", () => {
    expect(validateSeed([task("A"), task("B", { depends_on: ["A"] })], agents)).toEqual([]);
  });

  it("reports duplicate ids", () => {
    expect(validateSeed([task("A"), task("A", { owns_files: ["x"] })], agents).join()).toMatch(/duplicate task id: A/);
  });

  it("reports nonexistent assignee", () => {
    expect(validateSeed([task("A", { assignee: "ghost" })], agents).join()).toMatch(/assignee does not exist: ghost/);
  });

  it("reports nonexistent dependency", () => {
    expect(validateSeed([task("A", { depends_on: ["Z"] })], agents).join()).toMatch(/dependency does not exist: Z/);
  });

  it("reports dependency cycles", () => {
    const p = validateSeed([task("A", { depends_on: ["B"] }), task("B", { depends_on: ["A"] })], agents);
    expect(p.filter((x) => x.startsWith("dependency cycle"))).toHaveLength(1);
  });

  it("reports a self dependency as a cycle", () => {
    expect(validateSeed([task("A", { depends_on: ["A"] })], agents).join()).toMatch(/dependency cycle/);
  });

  it("reports empty fields", () => {
    const p = validateSeed([task("A", { title: " ", acceptance: [], verify: [] })], agents).join();
    expect(p).toMatch(/empty field title/);
    expect(p).toMatch(/empty field acceptance/);
    expect(p).toMatch(/empty field verify/);
  });

  describe("wave file ownership", () => {
    it("rejects two tasks in the same wave owning the same file", () => {
      const p = validateSeed([task("A", { owns_files: ["f.ts"] }), task("B", { owns_files: ["f.ts"] })], agents);
      expect(p.join()).toMatch(/wave 1: file f\.ts owned by several tasks: A, B/);
    });

    it("allows the same file in different waves", () => {
      const p = validateSeed([task("A", { owns_files: ["f.ts"] }), task("B", { wave: 2, owns_files: ["f.ts"] })], agents);
      expect(p).toEqual([]);
    });
  });
});
