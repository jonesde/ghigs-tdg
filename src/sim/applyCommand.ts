import { GameState } from "@/sim/Constants.js";
import type { TowerId } from "@/sim/ConstantsTower.js";
import type { GameEngine } from "@/sim/GameEngine.js";
import { setGameState } from "@/sim/GameRunState.js";
import type { Command } from "./Command.js";

// This is the single switch that maps Command → engine method. It is shared by
// the worker (WorkerEntry) and both command dispatchers (WorkerCommandDispatcher
// on the main thread, the legacy MainThreadCommandDispatcher) so the command→
// engine logic lives in exactly one place.
// Applies a command to the engine. Returns true if the command mutated visible
// runState/persistState (so the worker knows it must post a snapshot even while
// paused), false for pure no-ops. Every command that touches runState/persistState
// returns true; only reserved/forward-compat stubs return false.
export function applyCommand(engine: GameEngine, command: Command): boolean {
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      return true;
    case "input:key":
      // Raw key events are not serialized — Input.ts maps keys to action:*
      // commands locally. Reserved for the worker era if key intents move.
      return false;
    case "action:togglePause":
      engine.togglePause();
      return true;
    case "action:cycleSpeed":
      if (command.direction === 1) {
        engine.cycleSpeed();
      } else {
        engine.cycleSpeedReverse();
      }
      return true;
    case "action:upgradeSelected":
      engine.upgradeSelected();
      return true;
    case "action:sellSelected":
      void engine.sellSelected();
      return true;
    case "action:executeSell":
      engine.executeSellById(command.towerId, command.creditAmount);
      return true;
    case "action:endRun":
      if (!engine.gameEnded) {
        engine.endGame(false);
      }
      return true;
    case "action:downgradeSelected":
      engine.downgradeSelected();
      return true;
    case "action:specialize":
      engine.specializeSelected(command.variant);
      return true;
    case "action:cancelSelected":
      engine.cancelSelected();
      return true;
    case "action:setTargeting":
      engine.setTargeting(command.mode);
      return true;
    case "action:setFixedAimDir":
      engine.setFixedAimDir(command.dir);
      return true;
    case "action:cancelBuildMode":
      engine.cancelBuildMode();
      return true;
    case "action:selectBuildType":
      // The worker is authoritative for runState.selectedTowerType; the main thread
      // sets gameStore.selectedTowerType for the local build preview and dispatches
      // this command so the worker can place towers on input:click. Fix #1.
      engine.runState.selectedTowerType = command.towerType as TowerId | null;
      return true;
    case "action:syncPersist":
      // Main-thread-owned persist slices (unlocked + generalAddons) pushed into the
      // worker so mid-run skill-tree unlocks reach specialize/cost logic. No runState
      // mutation, but we return true anyway so the UI reflects updated costs.
      engine.syncPersist(command.unlocked, command.generalAddons);
      return true;
    case "action:debug":
      engine.debug(command.kind, command.amount);
      return true;
    case "action:selectTower":
      // Phase 7 implements selectTowerById (was tech debt in Phase 6).
      engine.selectTowerById(command.towerId);
      return true;
    case "action:debugEndRun":
      // Test-only hook: force a terminal state so worker-roundtrip tests can
      // assert the final-snapshot + stopLoop path deterministically.
      setGameState(engine.runState, command.victory === false ? GameState.GAME_OVER : GameState.VICTORY);
      return true;
    // NOTE: lifecycle:setTheme is intentionally absent — mid-run theme
    // switching is out of scope per README.md. The WorkerEntry message handler
    // retains a defensive no-op "setTheme" case for forward-compat.
    // LLM / enemy-commander commands (Phase 1 commander seam). These mutate enemy
    // routing state and so return true (force-post the snapshot) except the
    // gridLayoutToggle config flip, which returns false (no visible state change).
    case "llm:routeGroup": {
      const enemies = engine.getEnemiesByIds(command.enemyIds);
      for (const enemy of enemies) {
        if (command.hold) {
          const holdTile = command.holdTile ?? enemy.currentTile();
          enemy.applyRoute([holdTile], "hold");
          continue;
        }
        if (!engine.grid || command.waypoints.length === 0) {
          enemy.releaseToDefault();
          continue;
        }
        enemy.applyRoute([...command.waypoints, engine.grid.base], "route");
      }
      return true;
    }
    case "llm:siegeTower": {
      const enemies = engine.getEnemiesByIds(command.enemyIds);
      const tower = engine.towerManager?.towerAt(command.towerTile.x, command.towerTile.y) ?? null;
      for (const enemy of enemies) {
        if (tower && !tower.isGhost) {
          enemy.applySiege(tower);
          // Explicit tower cancels the engagement policy so the next intent does not replace it.
          enemy.targetingMode = null;
        } else enemy.releaseToDefault();
      }
      return true;
    }
    case "llm:setTargeting": {
      const enemies = engine.getEnemiesByIds(command.enemyIds);
      for (const enemy of enemies) {
        enemy.targetingMode = command.mode === "default" ? null : command.mode;
      }
      return true;
    }
    case "llm:gridLayoutToggle":
      if (engine.grid) engine.gridLayoutEnabled = !engine.gridLayoutEnabled;
      return false;
    // init and dispose are lifecycle messages handled by the worker entry
    // (not pushed onto the command queue), but they are part of the Command
    // union so we list them here as no-ops for exhaustiveness.
    case "lifecycle:init":
    case "lifecycle:dispose":
      return false;
    default: {
      const _exhaustive: never = command;
      void _exhaustive;
      return false;
    }
  }
}
