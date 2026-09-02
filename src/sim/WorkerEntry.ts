import { FIXED_DT, GameState, MAX_ACCUM, MAX_STEPS_PER_FRAME } from "@/sim/Constants.js";
import { GameEngine } from "@/sim/GameEngine.js";
import { initNavMesh } from "@/sim/navmesh/recastContext.js";
import { WorkerParticleSpawner } from "@/sim/ParticleSystem.js";
import { initPhysics } from "@/sim/physics/rapierContext.js";
import { applyCommand } from "./applyCommand.js";
import type { Command } from "./Command.js";
import type { PersistStateSlice } from "./HostBindings.js";
import { buildSnapshot } from "./SnapshotSerializer.js";
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

// Command queue — drained at the start of each tick. This eliminates the
// input/sim race condition: messages arriving mid-tick wait for the next
// drain boundary.
const commandQueue: Command[] = [];
let lastAppliedCommandId = 0;

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

function startLoop(): void {
  if (running) return;
  running = true;
  hasPostedSnapshot = false;
  awaitingAck = false;
  lastTime = 0; // re-anchored on first tick
  accumulator = 0;
  scheduleTick();
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

  // Drain command queue before any simulation work.
  // Commands are applied in arrival order; each may mutate runState/persistState.
  // Track whether any command actually mutated visible state this tick — that is
  // the signal (NOT commandQueue.length, which is 0 by the time we decide) that
  // we must post a snapshot even while paused.
  let stateMutatedThisTick = false;
  while (commandQueue.length > 0) {
    const command = commandQueue.shift()!;
    if (command.commandId !== undefined) {
      lastAppliedCommandId = command.commandId;
    }
    try {
      if (applyCommand(engine, command)) {
        stateMutatedThisTick = true;
      }
    } catch (err) {
      const errorMessage = `Command ${command.type} failed: ${(err as Error).message}`;
      const errorStack = (err as Error).stack;
      postMessage(
        errorStack
          ? { type: "workerError", message: errorMessage, stack: errorStack }
          : { type: "workerError", message: errorMessage },
      );
    }
  }

  // Fixed-timestep accumulator. timeScale comes from runState, which input
  // commands may have updated. Step budget scales with timeScale so 8×/16× do
  // not permanently discard sim time under steady load; hard-capped to avoid
  // spiral-of-death freezes.
  try {
    const timeScale = engine.runState.state === GameState.PAUSED ? 0 : engine.runState.timeScale;
    const scaledDt = rawDt * timeScale;
    engine.lastScaledDt = scaledDt;
    accumulator += scaledDt;
    const maxSteps = Math.min(64, Math.ceil(MAX_STEPS_PER_FRAME * Math.max(1, timeScale)));
    accumulator = Math.min(accumulator, FIXED_DT * maxSteps);
    while (accumulator >= FIXED_DT) {
      engine.update(FIXED_DT);
      accumulator -= FIXED_DT;
    }

    const state = engine.runState.state;
    const terminal = state === GameState.VICTORY || state === GameState.GAME_OVER;

    // Skip the snapshot entirely when nothing can have changed. When paused
    // (scaledDt === 0) AND no command mutated visible state this tick, the
    // engine state is static — building + structured-cloning a full snapshot is
    // pure waste. We still post when a command applied (so build/select/pause
    // actions show up while paused) and we always post at least the first
    // snapshot so the main thread establishes a baseline.
    const idle = engine.lastScaledDt === 0 && !stateMutatedThisTick;

    if (terminal) {
      // Final frame: post exactly once, then stop the loop until the next init.
      const snapshot = buildSnapshot(engine, lastAppliedCommandId);
      postMessage({ type: "snapshot", snapshot });
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

    if (!idle || !hasPostedSnapshot) {
      const isBaseline = !hasPostedSnapshot;
      // Paused AND a command mutated visible state this tick (distinct from `idle`,
      // which is the non-mutated paused case). The only force path while paused.
      const pausedMutation = engine.lastScaledDt === 0 && stateMutatedThisTick;
      // Force-posts bypass backpressure: baseline, AND any tick where a command
      // applied (paused OR running) so player input is reflected promptly.
      const forced = isBaseline || stateMutatedThisTick;
      if (awaitingAck && !forced) {
        // Running (no command, not baseline) but main hasn't acked the last
        // snapshot → drop build+post. awaitingAck stays true; next tick re-checks.
        // Persist-flush is skipped too (still fires on forced posts / 5s fallback / dispose).
        // Drain particle + lightning/stun buffers so dropped ticks don't accumulate
        // effects that would all burst onto the screen on the next posted snapshot.
        engine.particleSpawner?.consumeSpawns?.();
        engine.projectileManager?.consumeRenderVisualEffects?.();
      } else {
        const snapshot = buildSnapshot(engine, lastAppliedCommandId);
        postMessage({ type: "snapshot", snapshot });
        hasPostedSnapshot = true;
        // baseline       → true  (establish gate from first frame)
        // pausedMutation → false (so a *next* forced post isn't swallowed)
        // running/normal → true  (resume throttle; next running tick waits for ack)
        awaitingAck = !pausedMutation;

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
    }
  } catch (err) {
    // A simulation or snapshot error must not kill the tick loop. Report it and
    // keep scheduling so the game stays alive (and the error is visible).
    const errorMessage = `Tick failed: ${(err as Error).message}`;
    const errorStack = (err as Error).stack;
    postMessage(
      errorStack
        ? { type: "workerError", message: errorMessage, stack: errorStack }
        : { type: "workerError", message: errorMessage },
    );
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

// Build the persist slice the host needs to persist. Covers
// every field the worker can mutate (Phase 9). After posting, callers clear
// engine.persistDirty so the next flush only happens on a fresh mutation.
function buildPersistSlice(engineRef: GameEngine): PersistStateSlice {
  const persistState = engineRef.persistState;
  return {
    gems: persistState.gems,
    highestUnlockedMap: persistState.highestUnlockedMap,
    bestWaves: { ...persistState.bestWaves },
    activeWaves: { ...persistState.activeWaves },
    firstTimeMilestones: { ...persistState.firstTimeMilestones },
    firstClears: { ...persistState.firstClears },
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
      // (during WASM init) remain queued for the new engine's first tick.
      stopLoop();
      if (engine) {
        engine.dispose();
        engine = null;
      }
      commandQueue.length = 0;
      awaitingAck = false;
      lastAppliedCommandId = 0;
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
        // For random maps, loadMap uses mapIndex -1; branch to loadRandomMap so
        // getMap(-1) is never hit. Normal maps use loadMap(mapIndex).
        if (msg.mapIndex === -1 && msg.randomMapParams) {
          const params = msg.randomMapParams as {
            width: number;
            height: number;
            level: number;
            style: string;
            regionId: number;
            seed: number;
          };
          engine.loadRandomMap(params.width, params.height, params.level, params.style, params.regionId, params.seed);
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
      commandQueue.push(msg.command);
      break;
    }
    case "confirmResult": {
      host.resolveConfirm(msg.requestId, msg.confirmed);
      break;
    }
    case "setTheme": {
      // Defensive no-op — mid-run theme switching is out of scope per README.md.
      // The MainToWorkerMessage type still includes setTheme for forward-compat.
      break;
    }
    case "snapshotAck": {
      // Main thread consumed the latest snapshot; clear the backpressure gate so
      // the next post-eligible tick may build+post the current state.
      awaitingAck = false;
      break;
    }
    case "dispose": {
      stopLoop();
      // Drain queued commands (e.g. action:endRun) before teardown so quit can
      // finalize gems/history even when dispose races the next tick.
      while (commandQueue.length > 0 && engine) {
        const command = commandQueue.shift()!;
        if (command.commandId !== undefined) {
          lastAppliedCommandId = command.commandId;
        }
        try {
          applyCommand(engine, command);
        } catch (err) {
          const errorMessage = `Command ${command.type} failed: ${(err as Error).message}`;
          const errorStack = (err as Error).stack;
          postMessage(
            errorStack
              ? { type: "workerError", message: errorMessage, stack: errorStack }
              : { type: "workerError", message: errorMessage },
          );
        }
      }
      commandQueue.length = 0;
      awaitingAck = false;
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
