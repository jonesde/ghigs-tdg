import { describe, expect, it } from "vitest";
import type { WaveGraphDot } from "@/sim/SimulationSnapshot.js";
import { mergeWaveGraphDots } from "@/sim/SnapshotStore.js";

function dot(n: number): WaveGraphDot {
  return {
    damage: n,
    peakEnemyHp: n,
    gold: n,
    gems: n,
    baseHealth: n,
    baseHealthColor: "#fff",
    waveStart: n % 5 === 0,
  };
}

function windowOf(...ns: number[]): WaveGraphDot[] {
  return ns.map(dot);
}

describe("mergeWaveGraphDots", () => {
  it("appends only the last dot on a normal contiguous window", () => {
    const accum = windowOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    const merged = mergeWaveGraphDots(accum, windowOf(2, 3, 4, 5, 6, 7, 8, 9, 10));
    expect(merged).toEqual(windowOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  });

  it("appends two dots when exactly one was missed", () => {
    const accum = windowOf(0, 1, 2, 3, 4, 5, 6, 7, 8);
    // sender skipped dot 9, now at dot 10: window is 3..10
    const merged = mergeWaveGraphDots(accum, windowOf(3, 4, 5, 6, 7, 8, 9, 10));
    expect(merged).toEqual(windowOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10));
  });

  it("appends the whole window when nothing overlaps (connection loss)", () => {
    const accum = windowOf(0, 1, 2, 3);
    const merged = mergeWaveGraphDots(accum, windowOf(20, 21, 22, 23, 24, 25, 26, 27));
    expect(merged).toEqual(windowOf(0, 1, 2, 3, 20, 21, 22, 23, 24, 25, 26, 27));
  });

  it("starts fresh from an empty accumulation", () => {
    expect(mergeWaveGraphDots([], windowOf(0, 1, 2))).toEqual(windowOf(0, 1, 2));
  });

  it("appends nothing when the window is already fully contained", () => {
    const accum = windowOf(0, 1, 2, 3, 4, 5, 6, 7);
    expect(mergeWaveGraphDots(accum, windowOf(0, 1, 2, 3, 4, 5, 6, 7))).toEqual(accum);
  });

  it("caps the accumulation at the maximum fill", () => {
    const accum = windowOf(0, 1, 2, 3, 4, 5, 6, 7, 8, 9);
    const merged = mergeWaveGraphDots(accum, windowOf(2, 3, 4, 5, 6, 7, 8, 9, 10));
    // max accum is 10 for these small inputs? cap = waveGraphDotCapacity(waveGraphDotWidth) = 250
    expect(merged.length).toBeLessThanOrEqual(250);
    expect(merged[merged.length - 1]).toEqual(dot(10));
  });

  it("does not mutate the incoming window", () => {
    const incoming = windowOf(5, 6, 7);
    mergeWaveGraphDots(windowOf(0, 1, 2, 3, 4), incoming);
    expect(incoming).toEqual(windowOf(5, 6, 7));
  });

  it("merges an overlapping window whose float values jitter within epsilon", () => {
    const accum = windowOf(0, 1, 2, 3);
    // Same dots as 1,2,3 plus the new dot 4, but with last-bit float drift.
    const jittered = windowOf(1 + 1e-9, 2 - 1e-9, 3 + 1e-12, 4);
    const merged = mergeWaveGraphDots(accum, jittered);
    expect(merged).toEqual(windowOf(0, 1, 2, 3, 4));
  });

  it("does not merge values that differ beyond epsilon", () => {
    const accum = windowOf(0, 1, 2, 3);
    const shifted = windowOf(1.001, 2, 3, 4);
    const merged = mergeWaveGraphDots(accum, shifted);
    expect(merged).toEqual([...accum, ...shifted]);
  });
});
