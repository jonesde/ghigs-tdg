import type { SimulationSnapshot } from "@/sim/SimulationSnapshot.js";

// The ack backpressure gate can hold one posted snapshot across multiple rAF
// frames; main-thread animation must advance once per snapshot, not once per
// rendered frame, or it outruns the simulation. The same signal gates effect
// spawns: addLightningEffect re-adds with a fresh seed per call, so a held
// snapshot must not re-spawn its bolts on repeated renders.
export function isNewSnapshotRendered(
  snapshot: SimulationSnapshot,
  lastRenderedFrameId: number | null,
  lastRenderedWorkerGeneration: number | null,
): boolean {
  return (
    snapshot.frameId !== lastRenderedFrameId ||
    (snapshot.meta.workerGeneration ?? null) !== lastRenderedWorkerGeneration
  );
}

export function snapshotAnimDt(
  snapshot: SimulationSnapshot,
  lastRenderedFrameId: number | null,
  lastRenderedWorkerGeneration: number | null,
): number {
  return isNewSnapshotRendered(snapshot, lastRenderedFrameId, lastRenderedWorkerGeneration)
    ? snapshot.meta.lastScaledDt
    : 0;
}
