import {
  CUSTOM_PROGRESSIVE_MAP_INDEX,
  CUSTOM_RANDOM_MAP_INDEX,
  FIXED_DT,
  GameState,
  MAX_ACCUM,
} from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import type { ProgressiveConfig } from "@/sim/grid/ProgressiveMap.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { WorkerParticleSpawner } from "@/sim/ParticleSystem.js";
import { cloneThemeProgress } from "@/sim/PersistState.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";
import type { Command } from "./Command.js";
import { drainCommandQueue } from "./commandDrain.js";
import type { PersistStateSlice } from "./HostBindings.js";
import { buildSnapshot } from "./SnapshotSerializer.js";
import { decideSnapshotPost } from "./snapshotGate.js";
import { computeStepBudget, type StepBudget } from "./stepBudget.js";
import { WorkerHostBindings } from "./WorkerHostBindings.js";
import type { MainToWorkerMessage, WorkerToMainMessage } from "./WorkerProtocol.js";

// Inside the worker, `self` is the global DedicatedWorkerGlobalScope.
// We declare a minimal worker-scope shape to avoid pulling in the WebWorker
// lib (which conflicts with the DOM lib used for the main thread).
interface WorkerGlobalScope {
  postMessage(message: WorkerToMainMessage): void;
  onmessage: ((event: MessageEvent<MainToWorkerMessage>) => void) | null;
}
declare const self: WorkerGlobalScope;

let engine: GameEngine | null = null;
const host = new WorkerHostBindings();

// Worker generation (epoch): bumped on every init/dispose boundary. Incoming commands
// are tagged with the arrival generation; the drain drops entries from a stale
// generation with a warn instead of delivering a dead run's commands into the fresh
// engine. Snapshots are stamped with the generation (meta.workerGeneration) so the
// main thread can correlate. This is the worker-side half of the stale-command guard;
// the main-thread half is the commandBus epoch (see commandBus.ts).
let workerGeneration = 0;

export interface QueuedCommandEntry {
  command: Command;
  arrivalGeneration: number;
}

// Command queue — drained at the start of each tick. This eliminates the
// input/sim race condition: messages arriving mid-tick wait for the next
// drain boundary.
const commandQueue: QueuedCommandEntry[] = [];
let lastAppliedCommandId = 0;
let lastFailedCommandId = 0;
let lastAppliedCount = 0;
let lastSkippedCount = 0;

// Fixed-timestep accumulator — same structure as the current GameEngine.loop,
// but driven by setTimeout instead of requestAnimationFrame.
let lastTime = 0;
let accumulator = 0;
let tickTimeoutId: ReturnType<typeof setTimeout> | null = null;
let running = false;
// Ensures the worker posts at least one snapshot after (re)start so the main
// thread establishes a baseline (initial map/grid, first paths) even if the run
// begins in PAUSED with no applied command yet. Reset on every startLoop.
let hasPostedSnapshot = false;
// Backpressure gate (P2-1): the worker simulates at 60 Hz unconditionally, but
// buildSnapshot()+postMessage() are gated on the main thread having consumed
// (acked) the previous snapshot. Set true when a snapshot is posted so the next
// running-idle tick is dropped unless an ack (or a forced post) arrives.
let awaitingAck = false;
// True after a posted snapshot has included an active placement hold. The next
// hold (a snapshot where the hold is clear) forces again. Reset with the ack gate.
let placementHoldPosted = false;
// FrameId of the most recently posted snapshot. An ack only releases the gate
// when it carries a frameId >= this value, so a stale ack (a duplicate render of
// an older snapshot, or an ack delivered across an init boundary) cannot unblock
// the wrong generation.
let lastPostedFrameId = 0;

// Persist-flush throttling state: the worker tracks the last snapshot's wave,
// state, and milestone-claim key count so it can flush to the host only on
// significant events (wave change / game end / milestone claim) plus a 5s
// fallback. This avoids a persist-store write on every persist mutation.
let lastFlushWave = 0;
let lastFlushMilestoneKeys = 0;
let lastFlushBossesKilled = 0;
let lastFlushTime = 0;

const TARGET_FRAME_MS = 1000 / 60; // 16.67ms
const PERSIST_FLUSH_FALLBACK_MS = 5000;

function postMessage(msg: WorkerToMainMessage): void {
  self.postMessage(msg);
}

// Splits queued entries into current-generation commands (drained in order) and a
// stale count (dropped with a warn by the caller). Pure: exported for tests.
export function splitGenerationCommands(
  entries: readonly QueuedCommandEntry[],
  currentGeneration: number,
): { current: Command[]; droppedStale: number } {
  const current: Command[] = [];
  let droppedStale = 0;
  for (const entry of entries) {
    if (entry.arrivalGeneration !== currentGeneration) droppedStale++;
    else current.push(entry.command);
  }
  return { current, droppedStale };
}

export type { StepBudget } from "./stepBudget.js";
// Fixed-step budget lives in stepBudget.ts (pure, node-importable for tests);
// re-exported here so worker-adjacent importers keep a single source.
export { computeStepBudget } from "./stepBudget.js";

// Stamps the worker generation onto a built snapshot so the main thread can tell
// which run produced it. Pure: exported for tests.
export function stampSnapshotGeneration(snapshot: { meta: { workerGeneration?: number } }, generation: number): void {
  snapshot.meta.workerGeneration = generation;
}

function takeCurrentGenerationCommands(): Command[] {
  const split = splitGenerationCommands(commandQueue, workerGeneration);
  commandQueue.length = 0;
  if (split.droppedStale > 0) {
    console.warn(
      `WorkerEntry dropped ${split.droppedStale} stale-generation commands ` +
        `(current generation ${workerGeneration})`,
    );
  }
  return split.current;
}

function startLoop(): void {
  if (running) return;
  running = true;
  hasPostedSnapshot = false;
  awaitingAck = false;
  placementHoldPosted = false;
  lastPostedFrameId = 0;
  lastTime = 0; // re-anchored on first tick
  accumulator = 0;
  scheduleTick();
}

// Crosses the snapshot buffer ownership boundary: a post is the point where the
// effects captured by that snapshot are considered delivered. Until this runs the
// buffers stay intact, so a built-but-not-posted snapshot (double build, forced
// re-post) re-ships the same effects instead of dropping them.
function consumeDeliveredEffects(engineRef: GameEngine): void {
  engineRef.particleSpawner?.consumeSpawns?.();
  engineRef.projectileManager?.consumeRenderVisualEffects?.();
}

function scheduleTick(): void {
  // setTimeout (not setInterval) — setTimeout reschedules after each tick,
  // so a slow tick doesn't cause pile-up. setInterval can drift under load.
  tickTimeoutId = setTimeout(tick, TARGET_FRAME_MS);
}

function tick(): void {
  if (!engine || !running) return;

  const now = performance.now(); // available in workers, no self. prefix needed
  if (lastTime === 0) lastTime = now;
  const rawDt = Math.min(MAX_ACCUM, (now - lastTime) / 1000);
  lastTime = now;

  // Drain command queue before any simulation work. Commands are applied in arrival
  // order; rejected commands (validation failure or apply throw) mutate nothing,
  // never advance lastAppliedCommandId, and record lastFailedCommandId instead.
  // Stale-generation entries (queued for a previous run) are dropped with a warn
  // before the drain so they never reach the fresh engine.
  // Track whether any command actually mutated visible state this tick — that is
  // the signal (NOT commandQueue.length, which is 0 by the time we decide) that
  // we must post a snapshot even while paused.
  const receipt = { lastAppliedCommandId, lastFailedCommandId, applied: lastAppliedCount, skipped: lastSkippedCount };
  const tickCommands = takeCurrentGenerationCommands();
  const stateMutatedThisTick = drainCommandQueue(engine, tickCommands, receipt, (message, stack) => {
    postMessage(stack ? { type: "workerError", message, stack } : { type: "workerError", message });
  });
  lastAppliedCommandId = receipt.lastAppliedCommandId;
  lastFailedCommandId = receipt.lastFailedCommandId;
  lastAppliedCount = receipt.applied;
  lastSkippedCount = receipt.skipped;

  // Fixed-timestep accumulator. timeScale comes from runState, which input
  // commands may have updated. Step budget scales with timeScale so 8×/16× do
  // not permanently discard sim time under steady load; hard-capped to avoid
  // spiral-of-death freezes.
  // Error-path accounting locals: how many of this tick's budgeted steps actually
  // ran. Declared outside try so the catch can count the skipped ones.
  let stepBudget: StepBudget | null = null;
  let stepsExecuted = 0;
  try {
    // commanderHold is not GameState.PAUSED. PAUSED makes the commander worker skip
    // decide, which would cancel the request this hold exists to wait for.
    const timeScale =
      engine.runState.state === GameState.PAUSED || engine.runState.commanderHold ? 0 : engine.runState.timeScale;
    const scaledDt = rawDt * timeScale;
    engine.lastScaledDt = scaledDt;
    // Step budget scales with timeScale so 8×/16× do not permanently discard sim
    // time under steady load; hard-capped to avoid spiral-of-death freezes. The
    // capped-away remainder is counted (not silently dropped) in droppedSimSeconds.
    stepBudget = computeStepBudget(accumulator, scaledDt, timeScale);
    accumulator = stepBudget.accumulator;
    engine.droppedSimSeconds += stepBudget.droppedSeconds;
    for (let stepIndex = 0; stepIndex < stepBudget.steps; stepIndex++) {
      engine.update(FIXED_DT);
      stepsExecuted++;
    }

    const state = engine.runState.state;
    const terminal = state === GameState.VICTORY || state === GameState.GAME_OVER;

    // Skip the snapshot entirely when nothing can have changed. When paused
    // (scaledDt === 0) AND no command mutated visible state this tick, the
    // engine state is static — building + structured-cloning a full snapshot is
    // pure waste. We still post when a command applied (so build/select/pause
    // actions show up while paused), when the first snapshot establishes a
    // baseline, and when a placement hold has not been posted yet. That hold is
    // armed inside update and pauses the run, so a dropped arming frame would
    // otherwise never be retried.
    const snapshotGate = decideSnapshotPost({
      hasPostedSnapshot,
      awaitingAck,
      lastScaledDt: engine.lastScaledDt,
      stateMutatedThisTick,
      placementHoldActive: engine.progressivePlacementHold,
      placementHoldPosted,
    });

    if (terminal) {
      // Final frame: post exactly once, then stop the loop until the next init.
      const snapshot = buildSnapshot(
        engine,
        lastAppliedCommandId,
        {
          commandId: lastAppliedCommandId,
          applied: lastAppliedCount,
          skipped: lastSkippedCount,
          failedCommandId: lastFailedCommandId,
        },
        lastFailedCommandId,
      );
      stampSnapshotGeneration(snapshot, workerGeneration);
      postMessage({ type: "snapshot", snapshot });
      lastPostedFrameId = snapshot.frameId;
      consumeDeliveredEffects(engine);
      hasPostedSnapshot = true;
      // Persist any pending dirty state now (the loop is stopping, and the
      // dispose flush may be delayed if the route is not unmounted promptly).
      if (engine.persistDirty) {
        host.schedulePersistSave(buildPersistSlice(engine));
        engine.persistDirty = false;
      }
      stopLoop();
      return;
    }

    // post is false for a paused-idle tick and for a running tick still waiting
    // on snapshotAck. Effects stay buffered until a real post.
    if (snapshotGate.post) {
      const snapshot = buildSnapshot(
        engine,
        lastAppliedCommandId,
        {
          commandId: lastAppliedCommandId,
          applied: lastAppliedCount,
          skipped: lastSkippedCount,
          failedCommandId: lastFailedCommandId,
        },
        lastFailedCommandId,
      );
      stampSnapshotGeneration(snapshot, workerGeneration);
      postMessage({ type: "snapshot", snapshot });
      lastPostedFrameId = snapshot.frameId;
      consumeDeliveredEffects(engine);
      hasPostedSnapshot = true;
      // Running and baseline posts close the gate. A paused command leaves it open
      // so the next forced post is not swallowed. A hold announcement on a playing
      // tick follows the running rule; the latch records that this post carried it.
      awaitingAck = snapshotGate.awaitingAck;
      placementHoldPosted = snapshotGate.placementHoldPosted;

      // Phase 9 persist batching: flush to the host only on significant events so
      // we do not hit the persist store on every dirty mutation. Reads live
      // runState directly (the snapshot may not exist when idle). Triggers: wave
      // increased, a new milestone claim appeared, boss kill gem award, or a 5s
      // fallback elapsed while dirty.
      const milestoneKeyCount = Object.keys(engine.runState.milestoneRewardsClaimed).length;
      const waveChanged = engine.runState.currentWave !== lastFlushWave;
      const milestoneGained = milestoneKeyCount > lastFlushMilestoneKeys;
      const bossesKilledChanged = engine.runState.bossesKilledThisRun !== lastFlushBossesKilled;
      const fallbackElapsed = now - lastFlushTime >= PERSIST_FLUSH_FALLBACK_MS;
      if (engine.persistDirty && (waveChanged || milestoneGained || bossesKilledChanged || fallbackElapsed)) {
        host.schedulePersistSave(buildPersistSlice(engine));
        engine.persistDirty = false;
        lastFlushTime = now;
      }
      lastFlushWave = engine.runState.currentWave;
      lastFlushMilestoneKeys = milestoneKeyCount;
      lastFlushBossesKilled = engine.runState.bossesKilledThisRun;
    }
  } catch (err) {
    // A simulation or snapshot error must not kill the tick loop. Report it and
    // keep scheduling so the game stays alive (and the error is visible).
    // The accumulator is deliberately DISCARDED here rather than preserved: the
    // failure came from stepping this exact sim state, so preserving would re-run
    // the same throwing step every tick (error spam + frozen sim, never progress).
    // The discarded remainder plus any budgeted steps the throw skipped is counted
    // in droppedSimSeconds like a cap discard, so error-induced time loss is
    // visible in the snapshot rather than silent.
    const errorMessage = `Tick failed: ${(err as Error).message}`;
    const errorStack = (err as Error).stack;
    postMessage(
      errorStack
        ? { type: "workerError", message: errorMessage, stack: errorStack }
        : { type: "workerError", message: errorMessage },
    );
    if (engine) {
      const unsimulatedSteps = stepBudget ? stepBudget.steps - stepsExecuted : 0;
      engine.droppedSimSeconds += unsimulatedSteps * FIXED_DT + accumulator;
    }
    accumulator = 0;
  } finally {
    // Schedule next tick only while the loop is still running. stopLoop() (terminal
    // path above) sets running=false, so we must NOT reschedule here or we'd spin
    // a no-op 60Hz tick forever after the run ends.
    if (running) scheduleTick();
  }
}

function stopLoop(): void {
  running = false;
  if (tickTimeoutId !== null) {
    clearTimeout(tickTimeoutId);
    tickTimeoutId = null;
  }
}

// Build the persist slice the host needs to persist. PersistStateSlice is a
// Pick<PersistState, ...> (see HostBindings), so this literal must cover exactly
// those fields — adding a picked field without copying it here is a compile
// error instead of silent drift. Copied collections are shallow-cloned so the
// postMessage structured clone is independent of live engine mutation. After
// posting, callers clear engine.persistDirty so the next flush only happens on
// a fresh mutation.
function buildPersistSlice(engineRef: GameEngine): PersistStateSlice {
  const persistState = engineRef.persistState;
  return {
    gems: persistState.gems,
    // Deep-cloned per-world buckets: the structured clone must be independent of
    // live engine mutation, and the host replaces its whole record with this.
    themeProgress: cloneThemeProgress(persistState),
    activeWaves: { ...persistState.activeWaves },
    // NOTE: unlocked + generalAddons are intentionally omitted — they are
    // main-thread-owned (skill tree) and would otherwise clobber mid-run
    // unlocks/addon changes with the worker's stale init-time copy. They reach
    // the worker via action:syncPersist.
    runHistory: [...persistState.runHistory],
  };
}

// Message handler — runs synchronously between ticks. Commands queue;
// lifecycle messages act immediately.
self.onmessage = async (event: MessageEvent<MainToWorkerMessage>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init": {
      // Harden re-entry before any await so stale loop/engine/commands from a
      // prior run are cleared synchronously. Commands posted after this message
      // (during WASM init) remain queued for the new engine's first tick. The
      // generation bump retires any command that arrived for the previous run.
      workerGeneration++;
      stopLoop();
      if (engine) {
        engine.dispose();
        engine = null;
      }
      commandQueue.length = 0;
      awaitingAck = false;
      placementHoldPosted = false;
      lastPostedFrameId = 0;
      lastAppliedCommandId = 0;
      lastFailedCommandId = 0;
      lastAppliedCount = 0;
      lastSkippedCount = 0;
      // Cached async init of the Rapier WASM module (plans/rapier2d.md Phase 0).
      // Required before any getRapier().
      await initPhysics();
      // Cached async init of the recast-navigation WASM module (plans/recast.md
      // Phase 0). Required before any getRecast() / NavMeshBuilder / CrowdManager.
      await initNavMesh();
      try {
        // Construct the engine with plain state and the worker host bindings.
        // The engine no longer takes Pinia stores — Phase 1 made runState/persistState
        // authoritative. We pass them in directly.
        engine = new GameEngine(
          msg.persistState,
          msg.themeBundle,
          host,
          msg.mapIndex,
          msg.randomMapParams,
          new WorkerParticleSpawner(),
        );
        // Reset persist-flush tracking for the new run.
        lastFlushWave = 0;
        lastFlushMilestoneKeys = 0;
        lastFlushBossesKilled = 0;
        lastFlushTime = performance.now();
        // For custom generated maps, loadMap uses CUSTOM_RANDOM_MAP_INDEX; branch to
        // loadRandomMap so getMap(-1) is never hit. Custom progressive maps branch the
        // same way with their config. Catalog maps use loadMap(mapIndex).
        if (msg.mapIndex === CUSTOM_RANDOM_MAP_INDEX && msg.randomMapParams) {
          const params = msg.randomMapParams as {
            width: number;
            height: number;
            level: number;
            style: string;
            regionId: number;
            seed: number;
          };
          engine.loadRandomMap(params.width, params.height, params.level, params.style, params.regionId, params.seed);
        } else if (msg.mapIndex === CUSTOM_PROGRESSIVE_MAP_INDEX && msg.progressiveMapParams) {
          engine.loadProgressiveMap(msg.progressiveMapParams as ProgressiveConfig);
        } else {
          engine.loadMap(msg.mapIndex);
        }
      } catch (err) {
        engine?.dispose();
        engine = null;
        const errorMessage = `lifecycle:init failed: ${(err as Error).message}`;
        const errorStack = (err as Error).stack;
        postMessage(
          errorStack
            ? { type: "workerError", message: errorMessage, stack: errorStack }
            : { type: "workerError", message: errorMessage },
        );
        break;
      }
      postMessage({ type: "workerReady" });
      startLoop();
      break;
    }
    case "command": {
      commandQueue.push({ command: msg.command, arrivalGeneration: workerGeneration });
      break;
    }
    case "confirmResult": {
      host.resolveConfirm(msg.requestId, msg.confirmed);
      break;
    }
    case "snapshotAck": {
      // Main thread consumed the snapshot with this frameId; release the gate only
      // when the ack is for the last posted frame (or newer). A stale ack — a
      // duplicate render of an older snapshot, or an ack in flight across an init
      // boundary — must not unblock the wrong generation.
      if (msg.frameId >= lastPostedFrameId) {
        awaitingAck = false;
      }
      break;
    }
    case "dispose": {
      stopLoop();
      // Drain queued commands (e.g. action:endRun) before teardown so quit can
      // finalize gems/history even when dispose races the next tick. Rejections
      // are receipted, never applied. Stale-generation entries are dropped first
      // via the same take path the tick uses.
      const receipt = {
        lastAppliedCommandId,
        lastFailedCommandId,
        applied: lastAppliedCount,
        skipped: lastSkippedCount,
      };
      if (engine) {
        drainCommandQueue(engine, takeCurrentGenerationCommands(), receipt, (message, stack) => {
          postMessage(stack ? { type: "workerError", message, stack } : { type: "workerError", message });
        });
      }
      lastAppliedCommandId = receipt.lastAppliedCommandId;
      lastFailedCommandId = receipt.lastFailedCommandId;
      commandQueue.length = 0;
      awaitingAck = false;
      placementHoldPosted = false;
      lastPostedFrameId = 0;
      // Retire this run's generation so any command still in flight after teardown
      // can never be mistaken for the next run's.
      workerGeneration++;
      if (engine) {
        // Safety net: bare navigation away without action:endRun still awards
        // wave-completion gems / history / endScreenData (guarded by gameEnded).
        if (!engine.gameEnded) {
          engine.endGame(false);
        }
        if (engine.runState.endScreenData) {
          host.notifyUi({ type: "endGame", payload: engine.runState.endScreenData });
        }
        // Flush any dirty persist state before termination.
        if (engine.persistDirty) {
          host.schedulePersistSave(buildPersistSlice(engine));
          engine.persistDirty = false;
        }
        engine.dispose();
        engine = null;
      }
      // Resolve any in-flight requestConfirm promises so a dispose (or worker
      // termination) never leaves a dangling unresolved confirm.
      host.clearPendingConfirms();
      // Signal the main thread that it is safe to terminate — the final persist
      // flush (if any) has been posted. Fix #3.
      postMessage({ type: "disposed" });
      break;
    }
  }
};
