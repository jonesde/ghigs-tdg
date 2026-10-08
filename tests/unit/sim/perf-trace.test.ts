import { describe, expect, it } from "vitest";
import {
  createWorkerPerfSink,
  phaseEnd,
  phaseStart,
  resetWorkerPerfSink,
  spanEnd,
  spanStart,
} from "@/sim/perfTrace.js";

describe("perfTrace", () => {
  it("does not read the clock when tracing is off", () => {
    expect(spanStart(false)).toBe(0);
    expect(spanEnd(false, "render.frame", 0)).toBe(0);
    expect(phaseStart(null)).toBe(0);
    const sink = createWorkerPerfSink();
    phaseEnd(null, "physicsMs", 0);
    expect(sink.physicsMs).toBe(0);
  });

  it("accumulates phase time into the attached sink and resets it", () => {
    const sink = createWorkerPerfSink();
    const startedAt = phaseStart(sink);
    phaseEnd(sink, "towersMs", startedAt);
    phaseEnd(sink, "towersMs", startedAt);
    expect(sink.towersMs).toBeGreaterThanOrEqual(0);
    expect(sink.crowdMs).toBe(0);
    resetWorkerPerfSink(sink);
    expect(sink.towersMs).toBe(0);
  });
});
