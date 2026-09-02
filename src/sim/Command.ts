import type { ThemeBundle } from "./HostBindings.js";
import type { PersistState } from "./PersistState.js";

// Kinds accepted by the unified debug command (action:debug). The DebugPanel
// previously wrote these straight to the main-thread store, but under the worker
// architecture that store is a per-frame mirror of the simulation snapshot, so
// those writes were clobbered. Routing them through the command seam makes them
// actually reach the engine.
export type DebugKind =
  | "addGold"
  | "addBaseHealth"
  | "addGems"
  | "setWave"
  | "skipWave"
  | "killAll"
  | "setTimeScale"
  | "setDebugPhysics";

// Discriminated union. Every intent flowing into the simulation is one of
// these. The worker drains a queue of these at the start of each tick.
//
// The commandId is echoed back in the snapshot as lastAppliedCommandId so
// the host can detect confirmation or rejection. It is a monotonic number
// assigned by the host dispatcher.
export type Command =
  // ---- Input events (low-level, from Input.ts and SvgGameRoot click handlers) ----
  | { commandId: number; type: "input:click"; worldX: number; worldY: number }
  | { commandId: number; type: "input:key"; key: string; direction: "down" | "up" }
  // NOTE: hover is NOT a command — it's main-thread-only UI state (see §6.2 of ArchitecturePlan.md).
  // NOTE: selectBuildType IS a command (action:selectBuildType) — the main thread sets
  //   gameStore.selectedTowerType for the local build preview AND dispatches this command so the
  //   worker learns the active build type (the worker needs it to place towers on input:click).
  //   The worker is authoritative for runState.selectedTowerType; the snapshot mirrors it back
  //   into gameStore so build mode clears on off-grid / existing-tower clicks. See fix #1.

  // ---- High-level actions (wrapping GameEngine public methods) ----
  | { commandId: number; type: "action:togglePause" }
  | { commandId: number; type: "action:cycleSpeed"; direction: 1 | -1 }
  | { commandId: number; type: "action:upgradeSelected" }
  | { commandId: number; type: "action:sellSelected" } // triggers confirm via host
  | { commandId: number; type: "action:executeSell"; towerId: string; creditAmount?: number } // post-confirm
  | { commandId: number; type: "action:endRun" } // quit / end-run finalize (non-victory)
  | { commandId: number; type: "action:downgradeSelected" }
  | { commandId: number; type: "action:specialize"; variant: "A" | "B" }
  | { commandId: number; type: "action:cancelSelected" }
  | { commandId: number; type: "action:setTargeting"; mode: string }
  | { commandId: number; type: "action:setFixedAimDir"; dir: "N" | "E" | "S" | "W" | null }
  | { commandId: number; type: "action:cancelBuildMode" }
  | { commandId: number; type: "action:selectBuildType"; towerType: string | null }
  // action:syncPersist carries the main-thread-owned persist slices (unlocked +
  // generalAddons) into the worker. The skill tree mutates these on the main
  // thread (persistStore), but the worker runs off a snapshot taken at init and
  // has no other way to learn mid-run unlocks/addon changes. See the specialize
  // desync fix: without this, Tower.specialize fails its unlocked guard while the
  // UI shows the variant as available, silently deducting gold with no effect.
  | {
      commandId: number;
      type: "action:syncPersist";
      unlocked: PersistState["unlocked"];
      generalAddons: PersistState["generalAddons"];
    }
  // action:debug is the unified debug-injection command used by the DebugPanel
  // (gold/lives/gems/wave/speed injection + skip-wave/kill-all). It replaces the
  // old direct main-thread store writes that the worker snapshot mirror clobbered.
  | { commandId: number; type: "action:debug"; kind: DebugKind; amount?: number }
  // action:selectTower is implemented (Phase 7) via engine.selectTowerById; it is dispatched
  // by Input.ts / SvgGameRoot.vue for keyboard and click tower selection.
  | { commandId: number; type: "action:selectTower"; towerId: string | null }
  // action:debugEndRun is a test-only hook used by worker-roundtrip tests to
  // drive the engine to a terminal state deterministically (there is no
  // production path to force VICTORY/GAME_OVER). It transitions runState and
  // returns true so the worker's terminal branch posts exactly one final snapshot.
  | { commandId: number; type: "action:debugEndRun"; victory?: boolean }

  // ---- Lifecycle ----
  | {
      commandId: number;
      type: "lifecycle:init";
      persistState: PersistState;
      themeBundle: ThemeBundle;
      mapIndex: number;
      randomMapParams?: unknown;
    }
  | { commandId: number; type: "lifecycle:dispose" }

  // ---- Enemy-commander commands (issued by the LLM-shaped commander worker) ----
  // Enemies are addressed by id — EnemySnapshot.id is number (SimulationSnapshot.ts).
  | {
      commandId: number;
      type: "llm:routeGroup";
      enemyIds: number[];
      hold?: boolean;
      holdTile?: { x: number; y: number };
      waypoints: Array<{ x: number; y: number }>;
    }
  | { commandId: number; type: "llm:siegeTower"; enemyIds: number[]; towerTile: { x: number; y: number } }
  | { commandId: number; type: "llm:setTargeting"; enemyIds: number[]; mode: string }
  | { commandId: number; type: "llm:gridLayoutToggle" };
