import { describe, expect, it } from "vitest";
import { perfRequested } from "@/perfSession.js";

describe("perfRequested", () => {
  it("is true only for perf=1", () => {
    expect(perfRequested("?perf=1")).toBe(true);
    expect(perfRequested("perf=1")).toBe(true);
    expect(perfRequested("?x=1&perf=1")).toBe(true);
    expect(perfRequested("?perf=0")).toBe(false);
    expect(perfRequested("?perf")).toBe(false);
    expect(perfRequested("")).toBe(false);
  });
});
