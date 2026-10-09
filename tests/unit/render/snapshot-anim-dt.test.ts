/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { isNewSnapshotRendered, snapshotAnimDt } from "@/render/svg/snapshotAnimDt.js";
import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";
import { fixedDeltaSeconds } from "@/sim/stepBudget.js";

function snap(frameId: number, lastScaledDt: number, workerGeneration?: number): SimulationSnapshot {
  return { frameId, meta: { lastScaledDt, workerGeneration } } as unknown as SimulationSnapshot;
}

describe("snapshotAnimDt", () => {
  it("returns 0 when the same (frameId, workerGeneration) snapshot renders again", () => {
    const snapshot = snap(42, fixedDeltaSeconds, 1);
    expect(snapshotAnimDt(snapshot, 42, 1)).toBe(0);
  });

  it("returns lastScaledDt for a new frameId in the same generation", () => {
    const snapshot = snap(43, fixedDeltaSeconds, 1);
    expect(snapshotAnimDt(snapshot, 42, 1)).toBe(fixedDeltaSeconds);
  });

  it("returns lastScaledDt for a new generation whose frameId counter restarted", () => {
    const snapshot = snap(1, fixedDeltaSeconds, 2);
    expect(snapshotAnimDt(snapshot, 1, 1)).toBe(fixedDeltaSeconds);
  });

  it("returns 0 for a paused snapshot whose lastScaledDt is 0", () => {
    const snapshot = snap(43, 0, 1);
    expect(snapshotAnimDt(snapshot, 42, 1)).toBe(0);
  });

  it("returns lastScaledDt on the first rendered frame (no prior snapshot rendered)", () => {
    const snapshot = snap(1, fixedDeltaSeconds, 1);
    expect(snapshotAnimDt(snapshot, null, null)).toBe(fixedDeltaSeconds);
  });

  it("treats an unstamped workerGeneration as null for both sides", () => {
    const snapshot = snap(7, fixedDeltaSeconds);
    expect(snapshotAnimDt(snapshot, 7, null)).toBe(0);
    expect(snapshotAnimDt(snapshot, 6, null)).toBe(fixedDeltaSeconds);
  });
});

describe("isNewSnapshotRendered", () => {
  it("is false when the same (frameId, workerGeneration) snapshot renders again", () => {
    expect(isNewSnapshotRendered(snap(42, fixedDeltaSeconds, 1), 42, 1)).toBe(false);
  });

  it("is true for a new frameId in the same generation", () => {
    expect(isNewSnapshotRendered(snap(43, fixedDeltaSeconds, 1), 42, 1)).toBe(true);
  });

  it("is true for a new generation whose frameId counter restarted", () => {
    expect(isNewSnapshotRendered(snap(1, fixedDeltaSeconds, 2), 1, 1)).toBe(true);
  });

  it("is true on the first rendered frame (no prior snapshot rendered)", () => {
    expect(isNewSnapshotRendered(snap(1, fixedDeltaSeconds, 1), null, null)).toBe(true);
  });

  it("treats an unstamped workerGeneration as null for both sides", () => {
    expect(isNewSnapshotRendered(snap(7, fixedDeltaSeconds), 7, null)).toBe(false);
    expect(isNewSnapshotRendered(snap(6, fixedDeltaSeconds), 7, null)).toBe(true);
  });

  it("is true for a paused-command post (dt 0) so its effects still spawn", () => {
    expect(isNewSnapshotRendered(snap(43, 0, 1), 42, 1)).toBe(true);
  });
});
