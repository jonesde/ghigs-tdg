// Dev-only spans for `?perf=1`. The worker and the render loop both call these.
// A null sink or `enabled === false` does not call performance.now().

export interface WorkerPerfSink {
  crowdMs: number;
  physicsMs: number;
  projectilesMs: number;
  // Subsets of projectilesMs.
  projectileAimMs: number;
  projectileCastMs: number;
  projectileContactMs: number;
  towersMs: number;
  // Subsets of towersMs. lightningSearchMs is the enemy queries inside towerLightningMs.
  towerAuraMs: number;
  towerTargetMs: number;
  towerLightningMs: number;
  lightningSearchMs: number;
  baseDefenseMs: number;
  towerTargetScans: number;
  lightningShots: number;
  lightningChains: number;
  shapeCasts: number;
}

export type WorkerPerfCount = "towerTargetScans" | "lightningShots" | "lightningChains" | "shapeCasts";

// Last tick in a one-second window, plus the counters for that window.
// `ticks` / `postsSkipped` / `droppedSecondsWindow` cover the second.
// The millisecond fields and `steps` describe only the tick that closed the window.
export interface WorkerPerfSample {
  tickMs: number;
  steps: number;
  droppedSeconds: number;
  crowdMs: number;
  physicsMs: number;
  projectilesMs: number;
  projectileAimMs: number;
  projectileCastMs: number;
  projectileContactMs: number;
  towersMs: number;
  towerAuraMs: number;
  towerTargetMs: number;
  towerLightningMs: number;
  lightningSearchMs: number;
  baseDefenseMs: number;
  towerTargetScans: number;
  lightningShots: number;
  lightningChains: number;
  shapeCasts: number;
  snapshotMs: number;
  postMs: number;
  postSkipped: boolean;
  ticks: number;
  postsSkipped: number;
  droppedSecondsWindow: number;
}

export interface RenderPerfSample {
  frameMs: number;
  frameIntervalMs: number;
  frameAdvanced: boolean;
  enemiesMs: number;
  towersMs: number;
  projectilesMs: number;
  particlesMs: number;
  effectsMs: number;
  overlayMs: number;
}

export interface GhigsPerfReadout {
  atMs: number;
  worker: WorkerPerfSample | null;
  render: RenderPerfSample;
  counts: {
    enemies: number;
    towers: number;
    projectiles: number;
    lightningEffects: number;
    stunEffects: number;
    droppedSimSeconds: number;
    droppedSecondsDelta: number;
    frames: number;
  };
}

export function createWorkerPerfSink(): WorkerPerfSink {
  return {
    crowdMs: 0,
    physicsMs: 0,
    projectilesMs: 0,
    projectileAimMs: 0,
    projectileCastMs: 0,
    projectileContactMs: 0,
    towersMs: 0,
    towerAuraMs: 0,
    towerTargetMs: 0,
    towerLightningMs: 0,
    lightningSearchMs: 0,
    baseDefenseMs: 0,
    towerTargetScans: 0,
    lightningShots: 0,
    lightningChains: 0,
    shapeCasts: 0,
  };
}

export function resetWorkerPerfSink(sink: WorkerPerfSink): void {
  Object.assign(sink, createWorkerPerfSink());
}

// Installed by WorkerEntry for one traced tick. Tower and ProjectileManager read
// it so shot and cast timing does not need a sink argument on every call. Null
// outside that tick, and the callers then skip performance.now().
let activeSink: WorkerPerfSink | null = null;

export function setActivePerfSink(sink: WorkerPerfSink | null): void {
  activeSink = sink;
}

export function activePerfSink(): WorkerPerfSink | null {
  return activeSink;
}

export function spanStart(enabled: boolean): number {
  return enabled ? performance.now() : 0;
}

export function spanEnd(
  enabled: boolean,
  name: string,
  startedAt: number,
  detail?: Record<string, number | boolean>,
): number {
  if (!enabled) return 0;
  const endedAt = performance.now();
  measureSpan(name, startedAt, endedAt, detail);
  return endedAt - startedAt;
}

export function phaseStart(sink: WorkerPerfSink | null): number {
  return sink === null ? 0 : performance.now();
}

export function phaseEnd(
  sink: WorkerPerfSink | null,
  field: Exclude<keyof WorkerPerfSink, WorkerPerfCount>,
  startedAt: number,
): void {
  if (sink !== null) sink[field] += performance.now() - startedAt;
}

export function phaseCount(sink: WorkerPerfSink | null, field: WorkerPerfCount): void {
  if (sink !== null) sink[field] += 1;
}

export function measureSpan(
  name: string,
  startMs: number,
  endMs: number,
  detail?: Record<string, number | boolean>,
): void {
  performance.measure(name, { start: startMs, end: endMs, detail });
}

export function measureDuration(name: string, endMs: number, durationMs: number): void {
  if (durationMs <= 0) return;
  performance.measure(name, { start: endMs - durationMs, end: endMs });
}

export function publishGhigsPerf(readout: GhigsPerfReadout): void {
  // Crosses onto the page global so a CDP session can read the latest sample
  // with `globalThis.__ghigsPerf` instead of scraping the console.
  (globalThis as { __ghigsPerf?: GhigsPerfReadout }).__ghigsPerf = readout;
  console.info("[ghigs perf]", readout);
}
