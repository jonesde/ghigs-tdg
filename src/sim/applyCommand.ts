import { GameState } from "@/sim/Constants.js";
import type { TowerId } from "@/sim/ConstantsTower.js";
import type { Enemy } from "@/sim/enemies/Enemy.js";
import type { GameEngine } from "@/sim/GameEngine.js";
import { setGameState } from "@/sim/GameRunState.js";
import type { Command } from "./Command.js";
import type { SpawnOrder } from "./enemies/EnemyManager.js";
import { validateCommand } from "./validateCommand.js";

// This is the single switch that maps Command → engine method. It is shared by
// the worker (WorkerEntry) and both command dispatchers (WorkerCommandDispatcher
// on the main thread, the legacy MainThreadCommandDispatcher) so the command→
// engine logic lives in exactly one place.
// Applies a command to the engine. Returns true if the command mutated visible
// runState/persistState (so the worker knows it must post a snapshot even while
// paused), false for pure no-ops. Every command that touches runState/persistState
// returns true; only reserved/forward-compat stubs return false.
function spawnOrderFromCommand(command: Extract<Command, { type: "llm:setSpawnOrder" }>): SpawnOrder {
  const towerTile = command.towerTile ? { x: command.towerTile.x, y: command.towerTile.y } : null;
  const hold = command.hold === true && !towerTile;
  const waypoints =
    command.waypoints !== undefined && !hold && !towerTile
      ? command.waypoints.map((tile) => ({ x: tile.x, y: tile.y }))
      : null;
  const targetingMode =
    !towerTile && command.targetingMode && command.targetingMode !== "default" ? command.targetingMode : null;
  return {
    hold,
    holdTile: hold && command.holdTile ? { x: command.holdTile.x, y: command.holdTile.y } : null,
    waypoints,
    targetingMode,
    towerTile,
  };
}

// Resolves id-addressed enemies through a caller-supplied lookup when present so
// applyCommandWithStats can build the id map once and share it instead of
// rebuilding it for stats after the apply.
function resolveCommandEnemies(engine: GameEngine, enemyIds: number[], enemyLookup?: Map<number, Enemy>): Enemy[] {
  if (enemyLookup) {
    const matchedEnemies: Enemy[] = [];
    for (const enemyId of enemyIds) {
      const enemy = enemyLookup.get(enemyId);
      if (enemy) matchedEnemies.push(enemy);
    }
    return matchedEnemies;
  }
  return engine.getEnemiesByIds(enemyIds);
}

export function applyCommand(engine: GameEngine, command: Command, enemyLookup?: Map<number, Enemy>): boolean {
  // Intake validation: reject without mutating so a malformed command can never
  // crash the tick (unknown tower meta asserts, NaN propagation). The worker drain
  // pre-validates for receipt accounting; this guard protects direct callers.
  const rejection = validateCommand(command, engine.grid ?? null);
  if (rejection !== null) {
    engine.host.notifyUi({ type: "showNotification", message: `Command rejected: ${rejection}` });
    return false;
  }
  switch (command.type) {
    case "input:click":
      engine.handleClick(command.worldX, command.worldY);
      return true;
    case "action:togglePause":
      engine.togglePause();
      return true;
    case "action:commanderHold":
      engine.runState.commanderHold = command.hold;
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
      // Returns the sale result (false for benign no-ops like a missing tower);
      // guard/mismatch rejections throw and propagate to the drain for receipt.
      return engine.executeSellById(command.towerId, command.creditAmount);
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
      // Main-thread skill-tree edits (unlocks, add-ons, and the gem delta) pushed
      // into the worker. The gem delta lands on the copy the persist flush writes,
      // so a mid-run purchase is not restored to the pre-purchase total.
      engine.syncPersist(command.unlocked, command.generalAddons, command.gemDelta, command.baseUnlocks);
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
    case "action:placeProgressiveBlock":
      return engine.placeProgressiveBlock(command.templateIndex, command.rotation, command.blockX, command.blockY);
    case "action:rerollProgressiveOffer":
      return engine.rerollProgressiveOffer();
    case "action:undoProgressivePlacement":
      return engine.undoProgressivePlacement();
    // NOTE: lifecycle:setTheme is intentionally absent — mid-run theme
    // switching is out of scope per README.md.
    // LLM / enemy-commander commands (Phase 1 commander seam). These mutate enemy
    // routing state and so return true (force-post the snapshot) except the
    // gridLayout feed config flips, which return false (no visible state change).
    case "llm:routeGroup": {
      const enemies = resolveCommandEnemies(engine, command.enemyIds, enemyLookup);
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
      const enemies = resolveCommandEnemies(engine, command.enemyIds, enemyLookup);
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
      const enemies = resolveCommandEnemies(engine, command.enemyIds, enemyLookup);
      for (const enemy of enemies) {
        enemy.targetingMode = command.mode === "default" ? null : command.mode;
      }
      return true;
    }
    case "llm:setSpawnOrder": {
      const manager = engine.enemyManager;
      if (!manager) return false;
      if (command.clear) {
        manager.clearSpawnOrders(command.spawnIndex);
        return true;
      }
      manager.setSpawnOrder(command.spawnIndex, spawnOrderFromCommand(command));
      return true;
    }
    case "llm:releaseHeld": {
      const enemies = engine.enemyManager?.enemies ?? [];
      for (const enemy of enemies) {
        if (enemy.routingMode !== "hold") continue;
        if (command.wave !== undefined && enemy.wave !== command.wave) continue;
        if (command.spawnIndex !== undefined && enemy.spawnIndex !== command.spawnIndex) continue;
        enemy.releaseToDefault();
      }
      return true;
    }
    case "llm:gridLayoutToggle":
      if (engine.grid) engine.gridLayoutEnabled = !engine.gridLayoutEnabled;
      return false;
    case "llm:setGridLayoutFeed":
      if (engine.grid) engine.gridLayoutEnabled = command.enabled;
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
